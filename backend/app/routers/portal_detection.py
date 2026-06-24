"""
portal_detection.py — Real-time IP-based portal routing (v10.4)

GET /api/public/detect-portal

Checks the caller's IP against every lodge's lodge_ip_ranges setting.
On match → returns portal="pms" PLUS the matched lodge's full public
branding (name, logo, colours, address, tagline, contact) so the
login page can render completely lodge-branded without a second API call.

The lodge_ip_ranges setting is managed only by super_admin through the
Lodges admin page (not exposed to tenant admins).

Response shape:
  {
    "portal":             "pms" | "customer",
    "matched_lodge_id":   int | null,
    "client_ip":          str,
    "branding": {         // null when portal="customer"
      "lodge_id":         int,
      "lodge_code":       str,
      "lodge_name":       str,
      "hotel_name":       str,       // from settings, falls back to lodge.name
      "hotel_tagline":    str | null,
      "logo_url":         str | null,
      "banner_url":       str | null,
      "primary_color":    str,       // default "#07131C"
      "accent_color":     str,       // default "#E8A020"
      "hotel_phone":      str | null,
      "hotel_email":      str | null,
      "hotel_address":    str | null,
      "hotel_city":       str | null,
      "hotel_website":    str | null,
    } | null
  }
"""
import ipaddress
import logging
from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Lodge, Setting

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/public", tags=["public"])


# ── IP helpers ────────────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    """Extract real client IP, handling IPv6-wrapped IPv4 (::ffff:x.x.x.x)."""
    for header in ("X-Forwarded-For", "X-Real-IP", "CF-Connecting-IP"):
        val = request.headers.get(header, "")
        if val:
            ip = val.split(",")[0].strip()
            # Strip IPv6 wrapper around IPv4 addresses
            if ip.startswith("::ffff:"):
                ip = ip[7:]
            if ip and ip != "unknown":
                return ip
    raw = request.client.host if request.client else "127.0.0.1"
    # Strip IPv6 wrapper
    if raw.startswith("::ffff:"):
        raw = raw[7:]
    return raw


def _parse_ip_ranges(raw: str) -> dict:
    """Parse newline- or comma-separated IPs/CIDRs.
    
    Returns a dict:
      {
        "networks": [IPv4Network, ...],  # CIDR ranges
        "literals": {str, ...}           # exact string matches (for ::1, localhost etc.)
      }
    """
    networks = []
    literals = set()
    parts = [p.strip() for p in raw.replace("\n", ",").split(",") if p.strip()]
    for part in parts:
        # Handle IPv6 loopback and mapped addresses as literals
        if ":" in part or part.lower() == "localhost":
            literals.add(part.lower())
            # Also add the stripped version for ::ffff:x.x.x.x
            if part.startswith("::ffff:"):
                literals.add(part[7:])  # add the bare IPv4 part too
            continue
        try:
            if "/" not in part:
                networks.append(ipaddress.IPv4Network(f"{part}/32", strict=False))
            else:
                networks.append(ipaddress.IPv4Network(part, strict=False))
        except ValueError:
            # Store as literal string match fallback
            literals.add(part.lower())
    return {"networks": networks, "literals": literals}


def _ip_matches_ranges(ip_str: str, ranges: dict) -> bool:
    """Check if ip_str matches any configured range or literal."""
    if not isinstance(ranges, dict):
        return False
    
    ip_lower = ip_str.lower().strip()
    
    # 1. Literal string match (handles ::1, localhost, ::ffff:127.0.0.1)
    if ip_lower in ranges.get("literals", set()):
        return True
    
    # 2. Strip ::ffff: wrapper and check again
    clean_ip = ip_lower
    if clean_ip.startswith("::ffff:"):
        clean_ip = clean_ip[7:]
        if clean_ip in ranges.get("literals", set()):
            return True
    
    # 3. IPv4 CIDR match
    try:
        ip = ipaddress.IPv4Address(clean_ip)
        return any(ip in net for net in ranges.get("networks", []))
    except ValueError:
        pass
    
    return False


# ── Branding helper ───────────────────────────────────────────────────────────

def _get_setting(db: Session, lodge_id: int, key: str, default: str = "") -> str:
    row = db.query(Setting).filter(
        Setting.lodge_id == lodge_id,
        Setting.setting_key == key,
    ).first()
    return (row.setting_value or default) if row else default


def _lodge_branding(db: Session, lodge: Lodge) -> dict:
    """Return public branding fields for a lodge (safe to expose pre-auth)."""
    def g(k, d=""): return _get_setting(db, lodge.lodge_id, k, d)

    logo_path = g("logo_path")
    banner_path = g("banner_image_url")

    # Build absolute URL if path is relative (starts with /uploads/ or similar)
    def _url(path):
        if not path: return None
        if path.startswith("http"): return path
        # Strip leading slash for consistency
        return path if path.startswith("/") else f"/{path}"

    return {
        "lodge_id":      lodge.lodge_id,
        "lodge_code":    lodge.code,
        "lodge_name":    lodge.name,
        "hotel_name":    g("hotel_name") or lodge.name,
        "hotel_tagline": g("hotel_tagline") or None,
        "logo_url":      _url(logo_path),
        "banner_url":    _url(banner_path),
        "primary_color": g("primary_color", "#07131C"),
        "accent_color":  g("accent_color",  "#E8A020"),
        "hotel_phone":   g("hotel_phone")   or lodge.phone or None,
        "hotel_email":   g("hotel_email")   or lodge.email or None,
        "hotel_address": g("hotel_address") or lodge.address or None,
        "hotel_city":    g("hotel_city")    or None,
        "hotel_website": g("hotel_website") or None,
    }


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.get("/detect-portal")
def detect_portal(request: Request, db: Session = Depends(get_db)):
    """
    Detect which portal to show based on caller IP.
    Returns full lodge branding when IP matches so the login page
    can brand itself without a second round-trip.
    """
    client_ip = _client_ip(request)

    try:
        # Check every active lodge that has lodge_ip_ranges configured
        lodges = db.query(Lodge).filter(Lodge.is_active == True).all()

        for lodge in lodges:
            raw_ranges = _get_setting(db, lodge.lodge_id, "lodge_ip_ranges")
            if not raw_ranges:
                continue
            ranges = _parse_ip_ranges(raw_ranges)
            if not ranges or (not ranges.get("networks") and not ranges.get("literals")):
                continue
            if _ip_matches_ranges(client_ip, ranges):
                return {
                    "portal":           "pms",
                    "matched_lodge_id": lodge.lodge_id,
                    "client_ip":        client_ip,
                    "branding":         _lodge_branding(db, lodge),
                }

        return {
            "portal":           "customer",
            "matched_lodge_id": None,
            "client_ip":        client_ip,
            "branding":         None,
        }

    except Exception as e:
        logger.error("Portal detection error: %s", e)
        return {
            "portal":           "customer",
            "matched_lodge_id": None,
            "client_ip":        client_ip,
            "branding":         None,
        }
