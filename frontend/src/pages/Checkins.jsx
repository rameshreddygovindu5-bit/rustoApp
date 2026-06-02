import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, LogOut, Calendar, Clock, User, RefreshCw, Filter, Eye, AlertCircle, X, Download, Tag, Award, Receipt, Plus, Trash2 } from "lucide-react";
import { api, promosAPI, loyaltyAPI, folioAPI } from "../services/api";
import { toast } from "react-toastify";
import CheckinModal from "../components/checkins/CheckinModal";
import { formatDateTime } from "../utils/datetime";
import GuestSearchInput from "../components/GuestSearchInput";

export default function Checkins() {
  const navigate = useNavigate();
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("active"); // active, all, overdue
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedCheckin, setSelectedCheckin] = useState(null);
  const [checkoutTarget, setCheckoutTarget] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [checkoutData, setCheckoutData] = useState({
    additional_charges: 0,
    discount: 0,
    payment_mode: "cash",
    deposit_refunded: 0,
    promo_code: "",
    loyalty_points_redeem: 0,
  });
  // Live preview state for promo validation + loyalty balance lookup.
  const [promoPreview, setPromoPreview] = useState(null);  // {discount_amount, code} or {error}
  const [loyaltyBalance, setLoyaltyBalance] = useState(null);
  // Folio drawer state — staff opens this to add line-item charges
  // (food/laundry/etc.) during the stay or right at checkout.
  const [folioFor, setFolioFor] = useState(null);
  const pageSize = 15;

  const fetchCheckins = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: pageSize, search, status: tab });
      const data = await api.get(`/checkins?${params}`);
      setCheckins(data.data || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load check-ins");
    } finally {
      setLoading(false);
    }
  }, [page, search, tab]);

  useEffect(() => {
    fetchCheckins();
    const interval = setInterval(fetchCheckins, 60000);
    // Refetch when the AI agent creates a check-in / checks someone out.
    const onAgentChange = () => fetchCheckins();
    window.addEventListener('lms:agent:data_changed', onAgentChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('lms:agent:data_changed', onAgentChange);
    };
  }, [fetchCheckins]);

  const location = useLocation();
  const [initialRoom, setInitialRoom] = useState(null);
  const [initialCustomer, setInitialCustomer] = useState(null);
  const [initialBooking, setInitialBooking] = useState(null);

  // Honour ?status=... in the URL (used by the Dashboard "Overdue" tile).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlStatus = params.get("status");
    if (urlStatus && ["active", "overdue", "all", "checked_out", "cancelled"].includes(urlStatus)) {
      setTab(urlStatus);
    }
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const roomNum = params.get("room");
    if (roomNum && !showCheckinModal) {
      api.get("/rooms/available").then(res => {
        const roomsArray = Array.isArray(res) ? res : res?.data;
        const r = (roomsArray || []).find(x => String(x.room_number) === String(roomNum));
        if (r) {
          setInitialRoom(r);
          setShowCheckinModal(true);
          navigate(window.location.pathname, { replace: true });
        } else {
          toast.info(`Room ${roomNum} is not currently available for check-in.`);
        }
      }).catch(err => {
        console.error("Failed to fetch room for auto-checkin", err);
      });
    }
  }, [location.search, showCheckinModal]);

  // R8d: ?customer=ID loads the guest and opens CheckinModal pre-filled.
  // Used by the "Check In" button on the Customers page.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const cid = params.get("customer");
    if (cid && !showCheckinModal) {
      api.get(`/customers/${cid}`).then(c => {
        if (c.blacklisted) {
          toast.error(`⛔ ${c.first_name} ${c.last_name} is blacklisted. Cannot check in.`);
          navigate(window.location.pathname, { replace: true });
          return;
        }
        setInitialCustomer(c);
        setShowCheckinModal(true);
        navigate(window.location.pathname, { replace: true });
      }).catch(err => {
        console.error("Failed to load customer for auto-checkin", err);
        toast.error("Customer not found");
      });
    }
  }, [location.search, showCheckinModal]);

  // ?booking=ID — "Check In Guest" from the Bookings page. Loads the booking
  // prefill payload (booking details + available rooms of the booked type)
  // and opens the CheckinModal pre-filled from the reservation.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const bid = params.get("booking");
    if (bid && !showCheckinModal) {
      api.get(`/bookings/${bid}/checkin-prefill`).then(prefill => {
        setInitialBooking(prefill);
        setShowCheckinModal(true);
        navigate(window.location.pathname, { replace: true });
      }).catch(err => {
        const msg = err?.data?.detail || err?.message || "Could not load booking";
        toast.error(msg);
        navigate(window.location.pathname, { replace: true });
      });
    }
  }, [location.search, showCheckinModal]);

  const handleCheckout = async () => {
    if (!checkoutTarget) return;
    setCheckingOut(true);
    try {
      // Strip empty promo/zero loyalty before sending — the backend's
      // promo validator throws on empty strings.
      const payload = { ...checkoutData };
      if (!payload.promo_code?.trim()) delete payload.promo_code;
      if (!payload.loyalty_points_redeem) delete payload.loyalty_points_redeem;
      const invoice = await api.put(`/checkins/${checkoutTarget.checkin_id}/checkout`, payload);
      setInvoiceData(invoice);
      toast.success(`Checkout successful! Invoice: ${invoice.invoice_number}`);
      setCheckoutTarget(null);
      setPromoPreview(null);
      setLoyaltyBalance(null);
      setCheckoutData({ additional_charges: 0, discount: 0, payment_mode: "cash",
                        deposit_refunded: 0, promo_code: "", loyalty_points_redeem: 0 });
      fetchCheckins();
    } catch (err) {
      toast.error(err.message || "Checkout failed");
    } finally {
      setCheckingOut(false);
    }
  };

  // Validate a promo code against the running tariff. Called from the
  // promo input's "Apply" button. Returns nothing — updates promoPreview.
  const handleValidatePromo = async () => {
    if (!checkoutTarget || !checkoutData.promo_code?.trim()) {
      setPromoPreview(null);
      return;
    }
    try {
      // Subtotal estimate for validation only — actual subtotal is computed
      // server-side at checkout time using folio + additional_charges.
      const estimate = (checkoutTarget.tariff_per_night || 0) * (checkoutTarget.nights || 1)
                       + (checkoutData.additional_charges || 0);
      const res = await promosAPI.validate({ code: checkoutData.promo_code.trim(), subtotal: estimate });
      setPromoPreview({ ok: true, ...res.data });
      toast.success(`Promo "${res.data.code}" valid — ₹${res.data.discount_amount} off`);
    } catch (e) {
      setPromoPreview({ ok: false, error: e.response?.data?.detail || "Invalid code" });
    }
  };

  // Look up the guest's loyalty balance when the checkout dialog opens
  // so the redemption input can show available points.
  useEffect(() => {
    if (checkoutTarget?.customer?.customer_id) {
      loyaltyAPI.getAccount(checkoutTarget.customer.customer_id)
        .then(r => setLoyaltyBalance(r.data?.account?.current_balance ?? 0))
        .catch(() => setLoyaltyBalance(0));
    } else {
      setLoyaltyBalance(null);
    }
  }, [checkoutTarget]);

  const handleDownloadPDF = async (checkinId, invoiceNo) => {
    try {
      const blob = await api.get(`/checkins/${checkinId}/invoice/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `INV-${invoiceNo || checkinId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Failed to download PDF");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-playfair text-xl sm:text-2xl font-bold text-navy">Check-ins</h1>
          <p className="text-xs text-gray-500 mt-0.5">{total} records found</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={fetchCheckins} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowCheckinModal(true)} className="flex-1 sm:flex-none btn-gold flex items-center justify-center gap-2">
            + New Check-in
          </button>
        </div>
      </div>

      {/* Invoice Cards & Modals */}
      {invoiceData && <InvoiceCard invoice={invoiceData} onClose={() => setInvoiceData(null)} onViewDetails={() => setShowInvoiceModal(true)} onDownload={handleDownloadPDF} />}
      {showInvoiceModal && invoiceData && <InvoiceModal invoice={invoiceData} onClose={() => setShowInvoiceModal(false)} onDownload={handleDownloadPDF} />}

      {/* Tabs + Search */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto no-scrollbar">
            {[
              { key: "active", label: "Active" },
              { key: "overdue", label: "Overdue" },
              { key: "checked_out", label: "Checked Out" },
              { key: "cancelled", label: "Cancelled" },
              { key: "all", label: "All Records" }
            ].map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${tab === t.key ? "bg-white text-navy shadow-sm" : "text-gray-600 hover:text-gray-800"}`}>
                {t.label} {t.key === "overdue" && <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">!</span>}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-72">
            <GuestSearchInput
              value={search}
              onChange={v => { setSearch(v); setPage(1); }}
              onSelect={(customer) => { setSearch(customer.phone); setPage(1); }}
              placeholder="Search guest, room..."
            />
          </div>
        </div>
      </div>

      {/* Table / Card View */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Mobile View */}
        <div className="md:hidden divide-y divide-gray-100">
          {loading ? Array(3).fill(0).map((_, i) => <div key={i} className="p-4 animate-pulse space-y-3"><div className="h-4 bg-gray-100 w-1/3" /><div className="h-3 bg-gray-50 w-1/2" /></div>)
            : checkins.length === 0 ? <div className="p-8 text-center text-gray-400"><AlertCircle size={32} className="mx-auto mb-2 opacity-40" /><p className="text-sm">No check-ins found</p></div>
            : checkins.map((c, i) => {
              const isOverdue = c.expected_checkout && new Date(c.expected_checkout) < new Date() && c.status === "active";
              return (
                <div key={c.checkin_id}
                     style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
                     className={`p-4 space-y-3 animate-slide-up transition-all hover:bg-gold/5 ${isOverdue ? 'lantern-glow' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-navy/10 rounded-full flex items-center justify-center text-navy text-xs font-bold">{c.customer?.first_name?.[0]}{c.customer?.last_name?.[0]}</div>
                      <div>
                        <p className="text-sm font-bold text-gray-900 line-clamp-1">{c.customer?.first_name} {c.customer?.last_name}</p>
                        <p className="text-xs text-gray-500">{c.customer?.phone}</p>
                      </div>
                    </div>
                    <span className="bg-navy/10 text-navy text-xs font-bold px-2 py-1 rounded-lg">Rm {c.room_number}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div><p className="text-gray-400">In</p><p className="font-medium">{formatDateTime(c.checkin_datetime)}</p></div>
                    <div><p className="text-gray-400">Tariff</p><p className="font-medium">₹{c.tariff_per_night?.toLocaleString("en-IN")}</p></div>
                    {c.expected_checkout && (
                      <div className="col-span-2"><p className="text-gray-400">Expected Out</p><p className="font-medium">{formatDateTime(c.expected_checkout)}</p></div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <StatusBadge status={c.status} isOverdue={isOverdue} />
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedCheckin(c)} className="p-2 text-navy border border-gray-100 rounded-lg"><Eye size={14} /></button>
                      {c.status === "active" && (
                        <button onClick={() => setFolioFor(c)} title="Folio" className="p-2 text-gold border border-gold/30 bg-gold/5 rounded-lg">
                          <Receipt size={14}/>
                        </button>
                      )}
                      {c.status === "active" && <button onClick={() => setCheckoutTarget(c)} className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold flex items-center gap-1"><LogOut size={12} /> Checkout</button>}
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>

        {/* Desktop View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Guest</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Room</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Dates</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {checkins.map(c => (
                <tr key={c.checkin_id} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-navy/10 rounded-full flex items-center justify-center text-navy text-xs font-bold">{c.customer?.first_name?.[0]}{c.customer?.last_name?.[0]}</div>
                      <div><p className="text-sm font-medium">{c.customer?.first_name} {c.customer?.last_name}</p><p className="text-xs text-gray-400">{c.customer?.phone}</p></div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className="bg-navy/10 text-navy text-sm font-bold px-2.5 py-1 rounded-lg">{c.room_number}</span></td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    <div>In: {formatDateTime(c.checkin_datetime)}</div>
                    <div>Out: {c.expected_checkout ? formatDateTime(c.expected_checkout) : "—"}</div>
                  </td>
                  <td className="px-6 py-4"><StatusBadge status={c.status} isOverdue={c.expected_checkout && new Date(c.expected_checkout) < new Date() && c.status === "active"} /></td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedCheckin(c)} className="p-1.5 text-gray-400 hover:text-navy hover:bg-navy/10 rounded-lg"><Eye size={14} /></button>
                      {c.status === "active" && (
                        <button onClick={() => setFolioFor(c)} title="Folio"
                                className="p-1.5 text-gold hover:bg-gold/10 rounded-lg">
                          <Receipt size={14}/>
                        </button>
                      )}
                      {c.status === "active" && <button onClick={() => setCheckoutTarget(c)} className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-medium"><LogOut size={12} /> Checkout</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-[10px] sm:text-xs text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-1 sm:gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 sm:px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-2 sm:px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Checkout Modal */}
      {checkoutTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="text-center mb-5">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3"><LogOut size={24} className="text-red-600" /></div>
              <h3 className="text-lg font-bold">Confirm Checkout</h3>
              <p className="text-sm text-gray-500 mt-1">Room {checkoutTarget.room_number}: {checkoutTarget.customer?.first_name} {checkoutTarget.customer?.last_name}</p>
            </div>
            <div className="space-y-3 mb-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Extra Charges</label>
                  <input type="number" className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                         value={checkoutData.additional_charges}
                         onChange={e => setCheckoutData({ ...checkoutData, additional_charges: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Manual Discount</label>
                  <input type="number" className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                         value={checkoutData.discount}
                         onChange={e => setCheckoutData({ ...checkoutData, discount: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Promo code with validation preview */}
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1">
                  <Tag size={10}/> Promo Code
                </label>
                <div className="flex gap-1 mt-1">
                  <input type="text" placeholder="Optional"
                         className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono uppercase"
                         value={checkoutData.promo_code}
                         onChange={e => {
                           setCheckoutData({ ...checkoutData, promo_code: e.target.value.toUpperCase() });
                           setPromoPreview(null);
                         }} />
                  <button type="button" onClick={handleValidatePromo}
                          disabled={!checkoutData.promo_code?.trim()}
                          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold disabled:opacity-40">
                    Apply
                  </button>
                </div>
                {promoPreview?.ok && (
                  <p className="text-[11px] text-green-600 mt-1">
                    ✓ ₹{promoPreview.discount_amount} discount will apply at checkout
                  </p>
                )}
                {promoPreview && !promoPreview.ok && (
                  <p className="text-[11px] text-red-600 mt-1">✗ {promoPreview.error}</p>
                )}
              </div>

              {/* Loyalty points redemption */}
              {loyaltyBalance !== null && loyaltyBalance > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1">
                    <Award size={10}/> Redeem Points
                    <span className="text-gray-400 normal-case">
                      ({loyaltyBalance.toLocaleString('en-IN')} available)
                    </span>
                  </label>
                  <input type="number" min="0" max={loyaltyBalance}
                         className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                         value={checkoutData.loyalty_points_redeem}
                         onChange={e => {
                           const v = Math.min(parseInt(e.target.value, 10) || 0, loyaltyBalance);
                           setCheckoutData({ ...checkoutData, loyalty_points_redeem: v });
                         }} />
                  {checkoutData.loyalty_points_redeem > 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      ≈ ₹{checkoutData.loyalty_points_redeem} off (1 point = ₹1)
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase">Payment Mode</label>
                <select className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                        value={checkoutData.payment_mode}
                        onChange={e => setCheckoutData({ ...checkoutData, payment_mode: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="upi">UPI / PhonePe</option>
                </select>
              </div>

              {/* Folio shortcut — opens the folio drawer for this checkin
                  so staff can add itemized charges (food, laundry, etc.)
                  without leaving the checkout flow. */}
              <button type="button"
                      onClick={() => { setFolioFor(checkoutTarget); }}
                      className="w-full px-3 py-2 border border-dashed border-gold/40 text-gold hover:bg-gold/5 rounded-lg text-xs flex items-center justify-center gap-1">
                <Receipt size={12}/> Add itemized folio charge
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setCheckoutTarget(null); setPromoPreview(null); }}
                      className="flex-1 py-2.5 border rounded-xl text-gray-700 text-sm">Cancel</button>
              <button onClick={handleCheckout} disabled={checkingOut}
                      className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-60">
                {checkingOut ? "..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folio drawer — itemized charge management for a check-in */}
      {folioFor && (
        <FolioDrawer checkin={folioFor} onClose={() => setFolioFor(null)} />
      )}

      {/* Detail Modal */}
      {selectedCheckin && <CheckinDetailModal checkin={selectedCheckin} onClose={() => setSelectedCheckin(null)} />}
      
      {/* New Checkin Modal */}
      {showCheckinModal && <CheckinModal
        room={initialRoom}
        customer={initialCustomer}
        bookingPrefill={initialBooking}
        onClose={() => { setShowCheckinModal(false); setInitialRoom(null); setInitialCustomer(null); setInitialBooking(null); }}
        onSuccess={() => { setShowCheckinModal(false); setInitialRoom(null); setInitialCustomer(null); setInitialBooking(null); fetchCheckins(); }}
      />}
    </div>
  );
}

function StatusBadge({ status, isOverdue }) {
  const map = { active: "bg-green-100 text-green-700", checked_out: "bg-gray-100 text-gray-600", cancelled: "bg-red-100 text-red-600" };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isOverdue ? "bg-red-100 text-red-700" : map[status] || "bg-gray-100 text-gray-600"}`}>
      {isOverdue ? "Overdue" : status?.replace('_', ' ').toUpperCase()}
    </span>
  );
}

function CheckinDetailModal({ checkin, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">Check-in Details</h3>
          <button onClick={onClose} className="hover:text-white/70"><X size={18} /></button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <Info label="Guest" value={`${checkin.customer?.first_name} ${checkin.customer?.last_name}`} />
          <Info label="Phone" value={checkin.customer?.phone} />
          <Info label="Room" value={checkin.room_number} />
          <Info label="Tariff" value={`₹${checkin.tariff_per_night}`} />
          <Info label="Check-in" value={formatDateTime(checkin.checkin_datetime)} />
          <Info label="Expected Out" value={checkin.expected_checkout ? formatDateTime(checkin.expected_checkout) : "Open"} />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (<div><p className="text-[10px] text-gray-400 uppercase font-bold">{label}</p><p className="text-sm font-medium text-gray-800">{value || "—"}</p></div>);
}

function InvoiceCard({ invoice, onClose, onViewDetails, onDownload }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 animate-in slide-in-from-top duration-500">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0"><Download size={20} className="text-white" /></div>
        <div><p className="font-semibold text-green-800 text-sm">Checkout Complete</p><p className="text-xs text-green-600">Inv: {invoice.invoice_number} · Total: ₹{invoice.total_amount}</p></div>
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <button onClick={onViewDetails} className="flex-1 sm:flex-none px-4 py-2 bg-white text-green-700 border border-green-200 text-xs rounded-xl">View</button>
        <button onClick={() => onDownload(invoice.checkin_id || invoice.invoice_id, invoice.invoice_number)} className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white text-xs rounded-xl flex items-center justify-center gap-2"><Download size={12} /> PDF</button>
        <button onClick={onClose} className="text-green-600 p-2"><X size={18} /></button>
      </div>
    </div>
  );
}

function InvoiceModal({ invoice, onClose, onDownload }) {
  if (!invoice) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        <div className="bg-navy p-6 text-white flex justify-between items-center">
          <div><h3 className="text-xl font-bold font-playfair text-gold">Invoice</h3><p className="text-xs opacity-60 mt-1">#{invoice.invoice_number}</p></div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex justify-between text-sm"><span>Room Charges</span><span className="font-semibold">₹{Number(invoice.room_charges || 0).toLocaleString('en-IN')}</span></div>
          {Number(invoice.additional_charges) > 0 && (
            <div className="flex justify-between text-sm"><span>Additional Charges</span><span className="font-semibold">₹{Number(invoice.additional_charges).toLocaleString('en-IN')}</span></div>
          )}
          {Number(invoice.gst_amount) > 0 && (
            <div className="flex justify-between text-sm"><span>GST</span><span className="font-semibold">₹{Number(invoice.gst_amount).toLocaleString('en-IN')}</span></div>
          )}
          {Number(invoice.discount) > 0 && (
            <div className="flex justify-between text-sm text-green-700"><span>Discount</span><span className="font-semibold">− ₹{Number(invoice.discount).toLocaleString('en-IN')}</span></div>
          )}
          {Number(invoice.advance_adjusted) > 0 && (
            <div className="flex justify-between text-sm text-green-700"><span>Advance Adjusted</span><span className="font-semibold">− ₹{Number(invoice.advance_adjusted).toLocaleString('en-IN')}</span></div>
          )}
          <div className="border-t pt-3 flex justify-between"><span className="text-navy font-bold text-lg">Total Payable</span><span className="text-navy font-bold text-2xl">₹{Number(invoice.total_amount || 0).toLocaleString('en-IN')}</span></div>
          <div className="flex gap-3 pt-3">
            <button onClick={onClose} className="flex-1 py-3 border rounded-2xl text-gray-600 font-bold">Done</button>
            <button onClick={() => onDownload(invoice.checkin_id || invoice.invoice_id, invoice.invoice_number)} className="flex-1 py-3 bg-navy text-white rounded-2xl font-bold flex items-center justify-center gap-2"><Download size={18} /> PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceItem({ label, value, className = "" }) {
  return (<div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</p><p className={`text-base font-semibold text-navy ${className}`}>{value}</p></div>);
}


// ── Folio drawer ────────────────────────────────────────────────────────
// Itemized charges (food, laundry, mini-bar, etc.) added during a stay.
// At checkout the sum of non-voided rows flows into additional_charges
// automatically, so this UI is the canonical way to record extras.
const FOLIO_CATEGORIES = [
  ['food', 'Food'], ['beverage', 'Beverage'], ['laundry', 'Laundry'],
  ['mini_bar', 'Mini-bar'], ['telephone', 'Telephone'],
  ['late_checkout', 'Late Checkout'], ['damage', 'Damage'],
  ['transport', 'Transport'], ['extra_bed', 'Extra Bed'], ['other', 'Other'],
];

function FolioDrawer({ checkin, onClose }) {
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    category: 'food', description: '', quantity: 1, unit_price: '',
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await folioAPI.listForCheckin(checkin.checkin_id);
      setData(r.data || { items: [], total: 0 });
    } catch { toast.error('Failed to load folio'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [checkin.checkin_id]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity);
    const price = parseFloat(form.unit_price);
    if (!qty || qty <= 0 || isNaN(price) || price < 0) {
      toast.error('Quantity and price required'); return;
    }
    if (!form.description.trim()) { toast.error('Description required'); return; }
    setAdding(true);
    try {
      await folioAPI.addCharge(checkin.checkin_id, {
        category: form.category,
        description: form.description.trim(),
        quantity: qty, unit_price: price,
      });
      toast.success('Charge added');
      setForm({ category: 'food', description: '', quantity: 1, unit_price: '' });
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally { setAdding(false); }
  };

  const handleVoid = async (charge) => {
    const reason = window.prompt('Reason for voiding this charge?');
    if (!reason) return;
    try {
      await folioAPI.voidCharge(charge.charge_id, reason);
      toast.success('Voided');
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-display font-bold text-navy text-lg flex items-center gap-2">
              <Receipt size={18}/> Folio Charges
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Room {checkin.room_number} · {checkin.customer?.first_name} {checkin.customer?.last_name}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>

        {/* Total banner */}
        <div className="bg-gradient-to-br from-navy/5 to-gold/10 px-5 py-3 border-b border-gray-100 flex justify-between items-baseline">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Folio Total</span>
          <span className="text-xl font-bold text-navy">
            ₹{Number(data.total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Items list */}
        <div className="overflow-y-auto flex-1 px-5 py-3">
          {loading ? (
            <div className="text-gray-400 text-center py-6 text-sm">Loading…</div>
          ) : data.items.length === 0 ? (
            <div className="text-gray-400 text-center py-6 text-sm">No charges yet.</div>
          ) : (
            <div className="space-y-2">
              {data.items.map(it => (
                <div key={it.charge_id}
                     className={`flex items-start gap-3 p-2.5 rounded ${it.voided ? 'bg-gray-50 opacity-60 line-through' : 'bg-white border border-gray-100'}`}>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-navy">{it.description}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {it.quantity} × ₹{it.unit_price} · {it.category.replace(/_/g, ' ')}
                    </div>
                    {it.voided && it.voided_reason && (
                      <div className="text-[11px] text-red-500 mt-1 not-line-through">Void: {it.voided_reason}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-navy">₹{it.amount}</div>
                    {!it.voided && (
                      <button onClick={() => handleVoid(it)}
                              className="text-red-400 hover:text-red-600 text-[11px] mt-1">
                        Void
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="px-5 py-4 border-t border-gray-100 bg-gray-50 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={form.category}
                    onChange={e => setForm(s => ({ ...s, category: e.target.value }))}
                    className="px-2 py-1.5 border rounded text-sm">
              {FOLIO_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="text" placeholder="Description"
                   value={form.description}
                   onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
                   className="px-2 py-1.5 border rounded text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" min="0" step="0.01" placeholder="Qty"
                   value={form.quantity}
                   onChange={e => setForm(s => ({ ...s, quantity: e.target.value }))}
                   className="px-2 py-1.5 border rounded text-sm" />
            <input type="number" min="0" step="0.01" placeholder="Unit ₹"
                   value={form.unit_price}
                   onChange={e => setForm(s => ({ ...s, unit_price: e.target.value }))}
                   className="px-2 py-1.5 border rounded text-sm" />
            <button type="submit" disabled={adding}
                    className="px-3 py-1.5 bg-gold hover:bg-gold/90 text-white rounded text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50">
              <Plus size={12}/> Add
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
