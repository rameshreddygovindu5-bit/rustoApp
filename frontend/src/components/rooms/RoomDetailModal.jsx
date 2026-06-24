import { useState, useEffect } from "react";
import { X, User, Phone, MapPin, CreditCard, Calendar, Clock, LogOut, FileText, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "../../services/api";
import { toast } from "react-toastify";
import { formatDateTime, nightsBetween } from "../../utils/datetime";

export default function RoomDetailModal({ room, onClose, onCheckout }) {
  const [checkin, setCheckin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkoutData, setCheckoutData] = useState({
    additional_charges: 0,
    discount: 0,
    payment_mode: "cash",
    deposit_refunded: 0
  });

  useEffect(() => {
    fetchCheckinDetails();
  }, [room]);

  // ESC closes the modal (unless we're mid-checkout, to prevent data loss).
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && !checkingOut) {
        e.stopPropagation();
        if (showConfirm) setShowConfirm(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [checkingOut, showConfirm, onClose]);

  const fetchCheckinDetails = async () => {
    try {
      const data = await api.get(`/checkins/room/${room.room_id}/active`);
      setCheckin(data);
    } catch (err) {
      if (err.status !== 404) {
        toast.error("Failed to load guest details");
      }
      setCheckin(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      const invoice = await api.put(`/checkins/${checkin.checkin_id}/checkout`, checkoutData);
      toast.success(`Checkout successful! Invoice: ${invoice.invoice_number}`);
      onCheckout(invoice);
      onClose();
    } catch (err) {
      toast.error(err.message || "Checkout failed");
    } finally {
      setCheckingOut(false);
      setShowConfirm(false);
    }
  };

  // Lodge stays are billed on a 24-hour basis (see utils/datetime.nightsBetween).
  const nights = checkin
    ? nightsBetween(checkin.checkin_datetime, new Date())
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && !checkingOut && onClose()}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Room {room.room_number}</h2>
            <p className="text-sm text-white/70">{room.room_type?.replace('_', ' ').toUpperCase()} · Floor {room.floor}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={checkingOut}
            aria-label="Close"
            title="Close (Esc)"
            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-1.5 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          {/* Room Info (Always shown) */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-ink-50 rounded-xl">
              <p className="text-[10px] text-ink-500 uppercase font-bold">Base Tariff</p>
              <p className="text-lg font-bold text-navy">₹{room.base_tariff?.toLocaleString('en-IN')}</p>
            </div>
            <div className="p-3 bg-ink-50 rounded-xl">
              <p className="text-[10px] text-ink-500 uppercase font-bold">Status</p>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold mt-1 ${
                room.status === 'available' ? 'bg-green-100 text-green-700' : 
                room.status === 'occupied' ? 'bg-red-100 text-red-700' : 'bg-ink-100 text-ink-600'
              }`}>
                {room.status?.toUpperCase()}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-ink-400">
              <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
              Loading details...
            </div>
          ) : checkin ? (
            <>
              {/* Guest Info */}
              <div className="bg-ink-50 rounded-xl p-4 space-y-3 border border-ink-100">
                <h3 className="font-semibold text-navy text-xs uppercase tracking-wider">Guest Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow icon={<User size={14} />} label="Name" value={`${checkin.customer?.first_name} ${checkin.customer?.last_name}`} />
                  <InfoRow icon={<Phone size={14} />} label="Phone" value={checkin.customer?.phone} />
                  <InfoRow icon={<MapPin size={14} />} label="Nationality" value={checkin.customer?.nationality || "Indian"} />
                  <InfoRow icon={<CreditCard size={14} />} label="ID Proof" value={`${checkin.customer?.id_type?.toUpperCase()} - ${checkin.customer?.id_number}`} />
                </div>
              </div>

              {/* Stay Info */}
              <div className="bg-ink-50 rounded-xl p-4 space-y-3 border border-ink-100">
                <h3 className="font-semibold text-navy text-xs uppercase tracking-wider">Stay Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow icon={<Calendar size={14} />} label="Check-in" value={formatDateTime(checkin.checkin_datetime)} />
                  <InfoRow icon={<Calendar size={14} />} label="Expected Out" value={checkin.expected_checkout ? formatDateTime(checkin.expected_checkout) : "Open"} />
                  <InfoRow icon={<Clock size={14} />} label="Stay Duration" value={`${nights} night${nights > 1 ? "s" : ""}`} />
                  <InfoRow icon={<FileText size={14} />} label="Active Tariff" value={`₹${checkin.tariff_per_night?.toLocaleString("en-IN")}`} />
                </div>
              </div>

              {/* R8c: Running tab — clear breakdown so reception can quote
                  the guest the right number BEFORE clicking Process Checkout.
                  When the confirmation box is open and admin types in
                  additional charges/discount, the live total updates here. */}
              {(() => {
                const roomCharges = nights * Number(checkin.tariff_per_night || 0)
                const addl = Number(checkoutData.additional_charges || 0)
                const disc = Number(checkoutData.discount || 0)
                const deposit = Number(checkin.deposit_amount || 0)
                const advance = Number(checkin.advance_paid || 0)
                // Tab = charges + extras − discount − deposit − advance.
                const tab = roomCharges + addl - disc - deposit - advance
                const dueLabel = tab >= 0 ? 'Amount due from guest' : 'Refund to guest'
                return (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-700">Room charges</span>
                      <span className="font-semibold text-amber-900">
                        ₹{roomCharges.toLocaleString("en-IN")}
                        <span className="text-amber-600 font-normal ml-1">
                          ({nights} × ₹{Number(checkin.tariff_per_night || 0).toLocaleString("en-IN")})
                        </span>
                      </span>
                    </div>
                    {addl > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-amber-700">+ Additional charges</span>
                        <span className="font-semibold text-amber-900">₹{addl.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {disc > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-green-700">− Discount</span>
                        <span className="font-semibold text-green-700">−₹{disc.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {advance > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-green-700">− Advance paid (at booking)</span>
                        <span className="font-semibold text-green-700">−₹{advance.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-700">− Deposit on file</span>
                      <span className="font-semibold text-green-700">−₹{deposit.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-amber-300">
                      <span className="text-[10px] text-amber-700 font-bold uppercase">{dueLabel}</span>
                      <span className={`text-2xl font-bold ${tab >= 0 ? 'text-amber-900' : 'text-green-700'}`}>
                        ₹{Math.abs(tab).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Actions */}
              {!showConfirm ? (
                <button
                  onClick={() => setShowConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-red-200"
                >
                  <LogOut size={18} />
                  Process Checkout
                </button>
              ) : (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-5">
                  <div className="text-center mb-4">
                    <p className="text-red-800 font-bold">Confirm Checkout?</p>
                    <p className="text-xs text-red-600 mt-1">This will generate the final invoice and free the room.</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-[10px] font-bold text-ink-500 uppercase">Additional Charges (₹)</label>
                      <input
                        type="number"
                        className="w-full mt-1 px-3 py-2 border border-red-200 rounded-xl focus:outline-none focus:border-red-500 text-sm"
                        value={checkoutData.additional_charges}
                        onChange={e => setCheckoutData({ ...checkoutData, additional_charges: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-ink-500 uppercase">Discount (₹)</label>
                      <input
                        type="number"
                        className="w-full mt-1 px-3 py-2 border border-red-200 rounded-xl focus:outline-none focus:border-red-500 text-sm"
                        value={checkoutData.discount}
                        onChange={e => setCheckoutData({ ...checkoutData, discount: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="text-[10px] font-bold text-ink-500 uppercase">Payment Method</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border border-red-200 rounded-xl focus:outline-none focus:border-red-500 text-sm"
                      value={checkoutData.payment_mode}
                      onChange={e => setCheckoutData({ ...checkoutData, payment_mode: e.target.value })}
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="upi">UPI / PhonePe</option>
                      <option value="online">Online Transfer</option>
                    </select>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => setShowConfirm(false)} className="flex-1 py-2.5 bg-white border border-ink-200 text-ink-700 rounded-xl font-medium hover:bg-ink-50 transition-colors">Cancel</button>
                    <button onClick={handleCheckout} disabled={checkingOut} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 disabled:opacity-50 transition-all">
                      {checkingOut ? "Processing..." : "Confirm Checkout"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Available Room Actions */}
              <div className="space-y-6 pt-4">
                <div className="flex gap-4">
                  <button 
                    onClick={() => { onClose(); window.location.href = `/checkins?room=${room.room_number}`; }}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-green-100"
                  >
                    <Clock size={20} /> New Check-in
                  </button>
                </div>

                <div className="border-t border-ink-100 pt-6">
                  <h3 className="font-semibold text-navy text-xs uppercase tracking-wider mb-4">Quick Status Update</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {['available', 'maintenance', 'blocked'].map(st => (
                      <button
                        key={st}
                        disabled={room.status === st}
                        onClick={async () => {
                          try {
                            await api.put(`/rooms/${room.room_id}/status`, { status: st });
                            toast.success(`Room ${room.room_number} is now ${st}`);
                            onCheckout(); // Re-use onCheckout to refresh room list
                            onClose();
                          } catch (err) {
                            toast.error(err.message || "Update failed");
                          }
                        }}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all border-2 ${
                          room.status === st 
                            ? "bg-ink-50 border-ink-200 text-ink-400 cursor-default" 
                            : "border-ink-100 text-ink-600 hover:border-navy hover:bg-navy/5"
                        }`}
                      >
                        {st.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gold mt-0.5">{icon}</span>
      <div>
        <p className="text-xs text-ink-500">{label}</p>
        <p className="text-sm font-medium text-ink-800">{value || "—"}</p>
      </div>
    </div>
  );
}
