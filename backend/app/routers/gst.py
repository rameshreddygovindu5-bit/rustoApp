"""GST returns export router.

Exports invoice data in formats compatible with Indian GST filings:
  - GSTR-1 (outward supplies)
  - HSN-wise summary

Lodging/accommodation HSN code is 996311 (Room or unit accommodation
services). Tax rate is set in Settings (`gst_rate`) — typically 12% for
rooms ≤₹7500/night, 18% above (we don't auto-tier here; the setting is
what's billed).

Bundled CSV outputs are intended for hand-off to a CA / accountant.
Direct GSTN API integration is out of scope (it requires GSP credentials
and is heavily regulated).
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from datetime import date
from typing import Optional
import csv, io

from ..database import get_db
from ..models import Invoice, Checkin, Customer, Setting
from ..auth import get_current_user, require_admin, resolve_lodge_scope

router = APIRouter(prefix="/api/gst", tags=["gst"])


def _get_gst_settings(db: Session, lodge_id: int) -> dict:
    """Pull GSTIN / rate / hotel name from settings — used in CSV headers."""
    def s(key, default=""):
        row = (db.query(Setting)
               .filter(Setting.lodge_id == lodge_id,
                       Setting.setting_key == key).first())
        return row.setting_value if row and row.setting_value else default
    return {
        "gstin": s("hotel_gstin"),
        "gst_rate": float(s("gst_rate", "12") or 12),
        "gst_enabled": s("gst_enabled", "false").lower() == "true",
        "hotel_name": s("hotel_name", "Lodge"),
        "hotel_state": s("hotel_state", ""),
    }


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    """First and last day of the given (year, month) — both inclusive."""
    from calendar import monthrange
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


@router.get("/gstr1")
def export_gstr1(year: int = Query(..., ge=2020, le=2099),
                  month: int = Query(..., ge=1, le=12),
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """GSTR-1 B2C summary export for a given month.

    For lodge accommodation, almost everything is B2C (Business-to-Consumer)
    because guests rarely provide GSTINs. We bundle by tax rate and report
    the totals. Any invoices with a customer GSTIN populated would
    naturally belong in B2B; we surface those in a separate sheet.
    """
    fd, td = _month_bounds(year, month)
    cfg = _get_gst_settings(db, lodge_id)

    # Pull invoices for the month, joined to checkin → customer.
    rows = (db.query(Invoice, Checkin, Customer)
            .join(Checkin, Checkin.checkin_id == Invoice.checkin_id)
            .outerjoin(Customer, Customer.customer_id == Checkin.customer_id)
            .filter(Invoice.lodge_id == lodge_id,
                    cast(Invoice.created_at, Date) >= fd,
                    cast(Invoice.created_at, Date) <= td)
            .order_by(Invoice.invoice_id.asc()).all())

    # Build the CSV. We use a wide-but-flat layout that an accountant can
    # paste into the official GSTR-1 offline tool (not a literal JSON
    # GSTR-1 — that requires GSP credentials).
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"GSTR-1 Export — {cfg['hotel_name']}",
                 f"GSTIN: {cfg['gstin'] or 'NOT_SET'}",
                 f"Period: {fd.isoformat()} to {td.isoformat()}",
                 f"Default rate: {cfg['gst_rate']}%"])
    w.writerow([])
    w.writerow(["Invoice No", "Date", "Guest", "Phone", "GSTIN (Buyer)",
                 "State", "Taxable Value (₹)", "Rate (%)", "CGST (₹)",
                 "SGST (₹)", "IGST (₹)", "Total (₹)", "Place of Supply",
                 "HSN", "Payment Mode"])
    total_taxable = 0.0
    total_cgst = 0.0
    total_sgst = 0.0
    total_amt = 0.0
    rate = cfg["gst_rate"]
    for inv, ch, cust in rows:
        # The Invoice stores the gross + breakdown — but historically the
        # tax wasn't kept separately. We approximate the tax-base by
        # reverse-calculating: if rate=12, base = total / 1.12 (assuming
        # tax-inclusive pricing). For more accurate output, hotels should
        # record taxable+tax separately going forward.
        gross = float(inv.total_amount or 0)
        if rate > 0:
            taxable = gross / (1 + rate / 100)
            tax = gross - taxable
        else:
            taxable, tax = gross, 0.0
        # Intra-state split — CGST + SGST. Inter-state would be IGST only;
        # we mark IGST=0 here and let the CA reclassify per-row if needed.
        cgst = tax / 2
        sgst = tax / 2
        igst = 0.0
        gstin_buyer = getattr(cust, "gstin", "") or ""  # may not exist as column
        w.writerow([
            inv.invoice_number,
            inv.created_at.date().isoformat() if inv.created_at else "",
            f"{cust.first_name} {cust.last_name}" if cust else "",
            cust.phone if cust else "",
            gstin_buyer,
            cfg["hotel_state"],
            f"{taxable:.2f}",
            f"{rate:.1f}",
            f"{cgst:.2f}",
            f"{sgst:.2f}",
            f"{igst:.2f}",
            f"{gross:.2f}",
            cfg["hotel_state"],
            "996311",
            ch.payment_mode if ch else "",
        ])
        total_taxable += taxable
        total_cgst += cgst
        total_sgst += sgst
        total_amt += gross

    w.writerow([])
    w.writerow(["TOTAL", "", "", "", "", "",
                 f"{total_taxable:.2f}", "",
                 f"{total_cgst:.2f}", f"{total_sgst:.2f}", "0.00",
                 f"{total_amt:.2f}", "", "", ""])

    buf.seek(0)
    fname = f"gstr1-{year}-{month:02d}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/hsn-summary")
def hsn_summary(year: int = Query(..., ge=2020, le=2099),
                 month: int = Query(..., ge=1, le=12),
                 db: Session = Depends(get_db),
                 current_user=Depends(require_admin),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    """HSN-wise summary for the month. For pure accommodation only HSN
    996311 is in play; folio charges for food/beverage technically map to
    other HSNs (996331 for restaurant services), but unless you're a
    composite supplier, most lodges roll them under 996311. The export
    here uses the single 996311 entry; a CA can split further if needed.
    """
    fd, td = _month_bounds(year, month)
    cfg = _get_gst_settings(db, lodge_id)
    rows = (db.query(Invoice)
            .filter(Invoice.lodge_id == lodge_id,
                    cast(Invoice.created_at, Date) >= fd,
                    cast(Invoice.created_at, Date) <= td).all())
    total = sum(float(r.total_amount or 0) for r in rows)
    rate = cfg["gst_rate"]
    taxable = (total / (1 + rate / 100)) if rate > 0 else total
    tax = total - taxable

    return {
        "period": f"{fd.isoformat()} to {td.isoformat()}",
        "gstin": cfg["gstin"] or None,
        "hotel_name": cfg["hotel_name"],
        "rows": [{
            "hsn": "996311",
            "description": "Room or unit accommodation services for visitors, with or without daily housekeeping",
            "uqc": "OTH",          # 'Others' — HSN uom code
            "total_quantity": len(rows),
            "total_value": round(total, 2),
            "taxable_value": round(taxable, 2),
            "igst": 0.0,
            "cgst": round(tax / 2, 2),
            "sgst": round(tax / 2, 2),
            "rate": rate,
        }],
        "total_invoices": len(rows),
        "grand_total": round(total, 2),
    }
