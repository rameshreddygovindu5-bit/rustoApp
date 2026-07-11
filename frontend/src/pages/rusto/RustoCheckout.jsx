/**
 * RustoCheckout — clean redesign (warm terracotta / cream)
 * Single screen: guest details + price breakdown + one Pay button.
 * Preserves: booking fetch, Razorpay flow (mock + live), verifyPayment,
 * promo apply, contact update, confirmed state.
 */
import React, { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, Lock, Loader2, MapPin, Calendar, Users, Tag,
         ChevronLeft, ShieldCheck } from "lucide-react";
import { toast } from "react-toastify";
import { rustoBookingsAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import "./rusto-booking.css";

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(window.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error("Failed to load payment SDK"));
    document.body.appendChild(s);
  });
}

const money = n => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function RustoCheckout() {
  const { bookingId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { customer } = useCustomerAuth();

  const initial = loc.state;
  const [booking, setBooking]   = useState(initial?.booking || null);
  const [razorpay, setRazorpay] = useState(initial?.razorpay || null);
  const [loading, setLoading]   = useState(!initial?.booking);
  const [paying, setPaying]     = useState(false);
  const [done, setDone]         = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [contact, setContact] = useState({
    full_name: customer?.full_name || initial?.booking?.contact_name || "",
    phone:     customer?.phone     || initial?.booking?.contact_phone || "",
    email:     customer?.email     || initial?.booking?.contact_email || "",
  });
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    if (initial?.booking) return;
    let cancelled = false;
    rustoBookingsAPI.get(bookingId)
      .then(r => { if (!cancelled) setBooking(r.data); })
      .catch(() => { if (!cancelled) toast.error("Couldn't load your booking"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId, initial]);

  // The Razorpay session originally only travels via router state, so a
  // page refresh used to dead-end with "payment session expired". Restore
  // it from the backend whenever it's missing and the booking is unpaid.
  useEffect(() => {
    if (razorpay || !booking) return;
    if (!["payment_pending", "initiated"].includes(booking.status)) return;
    let cancelled = false;
    rustoBookingsAPI.paymentSession(bookingId)
      .then(r => {
        if (cancelled) return;
        if (r.data?.booking) setBooking(r.data.booking);
        if (r.data?.razorpay) setRazorpay(r.data.razorpay);
        if (r.data?.already_confirmed) setDone(true);
      })
      .catch(() => { /* handlePay retries; user gets a clear error there */ });
    return () => { cancelled = true; };
  }, [razorpay, booking, bookingId]);

  useEffect(() => {
    if (booking) setContact(c => ({
      full_name: c.full_name || booking.contact_name || "",
      phone: c.phone || booking.contact_phone || "",
      email: c.email || booking.contact_email || "",
    }));
  }, [booking]);

  const saveContact = async () => {
    if (!contact.full_name.trim()) { toast.error("Name is required"); return; }
    if (!contact.phone.trim()) { toast.error("Phone is required"); return; }
    setSavingContact(true);
    // Persist onto the BOOKING itself (not just the profile) so the
    // confirmation email / SMS / WhatsApp reach the corrected details.
    try {
      const r = await rustoBookingsAPI.updateContact(bookingId, {
        contact_name: contact.full_name.trim(),
        contact_phone: contact.phone.trim(),
        contact_email: contact.email.trim(),
      });
      if (r.data?.booking_id) setBooking(r.data);
    } catch { /* non-blocking — the original snapshot stays on the booking */ }
    finally { setSavingContact(false); }
  };

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    try {
      const r = await rustoBookingsAPI.applyPromo(bookingId, { promo_code: promoCode.trim().toUpperCase() });
      setBooking(r.data.booking);
      if (r.data.razorpay) setRazorpay(r.data.razorpay);
      toast.success(`Promo applied — you save ${money(r.data.booking.promo_discount)}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "That code isn't valid");
    } finally { setPromoLoading(false); }
  };

  const handlePay = async () => {
    await saveContact();
    let session = razorpay;
    if (!session) {
      // Session missing (e.g. refresh landed before the restore effect
      // finished) — re-create it on demand instead of dead-ending.
      try {
        const r = await rustoBookingsAPI.paymentSession(bookingId);
        if (r.data?.already_confirmed) { setBooking(r.data.booking); setDone(true); return; }
        if (r.data?.booking) setBooking(r.data.booking);
        session = r.data?.razorpay || null;
        if (session) setRazorpay(session);
      } catch { /* fall through to the error below */ }
    }
    if (!session) {
      toast.error("Couldn't start the payment session. Please try again.");
      return;
    }
    setPaying(true);
    try {
      if (session.is_mock) {
        const r = await rustoBookingsAPI.verifyPayment(bookingId, {
          razorpay_order_id: session.order_id,
          razorpay_payment_id: `pay_mock_${Date.now()}`,
          razorpay_signature: "mock_signature",
        });
        setBooking(r.data.booking); setDone(true);
        toast.success("Booking confirmed (test mode)");
        setPaying(false);
        return;
      }
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: session.key_id, order_id: session.order_id,
        amount: session.amount, currency: session.currency,
        name: session.name, description: session.description,
        prefill: session.prefill || { name: contact.full_name, contact: contact.phone, email: contact.email },
        theme: { color: "#B45A38" },
        handler: async (resp) => {
          try {
            const r = await rustoBookingsAPI.verifyPayment(bookingId, {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            setBooking(r.data.booking); setDone(true);
            toast.success("Payment successful — booking confirmed");
          } catch (e) {
            toast.error(e.response?.data?.detail || "Payment verification failed");
          } finally { setPaying(false); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e) {
      toast.error(e.message || "Payment couldn't start");
      setPaying(false);
    }
  };

  if (loading) return (
    <div className="rb"><div className="rb-container-narrow" style={{ padding: "40px 20px" }}>
      <div className="rb-skel" style={{ height: 200, borderRadius: 14 }} />
    </div></div>
  );

  if (!booking) return (
    <div className="rb"><div className="rb-container-narrow rb-empty" style={{ marginTop: 40 }}>
      <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Booking not found</p>
      <button className="rb-btn rb-btn-primary" style={{ marginTop: 16 }} onClick={() => nav("/")}>Back to home</button>
    </div></div>
  );

  const nights = Math.round((new Date(booking.checkout_date) - new Date(booking.checkin_date)) / 864e5) || 1;

  // ── Confirmed ─────────────────────────────────────────
  if (done || booking.status === "confirmed") {
    const paidAmount = booking.payment && ["paid", "refunded"].includes(booking.payment.status)
      ? booking.payment.amount : booking.total_amount;
    const balanceDue = Math.max(0, Number(booking.total_amount || 0) - Number(paidAmount || 0));
    const policy = booking.lodge?.cancellation_policy;
    const policyLine = policy
      ? `Cancellation policy: ${String(policy).replace(/_/g, " ")}${booking.lodge?.cancellation_hours ? ` — free cancellation up to ${booking.lodge.cancellation_hours}h before check-in` : ""}.`
      : "Cancellation policy: contact the lodge or cancel from My Bookings before check-in.";
    return (
    <div className="rb"><div className="rb-container-narrow" style={{ padding: "48px 20px" }}>
      <div className="rb-confirm rb-rise">
        <div className="rb-confirm-check"><CheckCircle2 size={48} /></div>
        <h1 className="rb-confirm-title">Booking confirmed</h1>
        <p className="rb-sub" style={{ textAlign: "center" }}>Your stay at {booking.lodge?.name} is booked.</p>
        <div className="rb-confirm-ref">Reference · <strong>{booking.booking_ref}</strong></div>

        <div className="rb-confirm-details">
          <div className="rb-confirm-row"><MapPin size={16} /><span>{booking.lodge?.name}{booking.lodge?.public_city ? `, ${booking.lodge.public_city}` : ""}</span></div>
          {booking.lodge?.address && (
            <div className="rb-confirm-row"><span style={{ width: 16 }} /><span>{booking.lodge.address}{booking.lodge?.phone ? ` · ${booking.lodge.phone}` : ""}</span></div>
          )}
          <div className="rb-confirm-row"><Calendar size={16} /><span>{booking.checkin_date} → {booking.checkout_date} · {nights} night{nights > 1 ? "s" : ""}</span></div>
          <div className="rb-confirm-row"><Users size={16} /><span>{booking.room_type_label || booking.room_type} · {booking.rooms_count} room{booking.rooms_count > 1 ? "s" : ""} · {booking.adults} guest{booking.adults > 1 ? "s" : ""}</span></div>
        </div>
        <div className="rb-confirm-total"><span>Paid</span><strong>{money(paidAmount)}</strong></div>
        {balanceDue > 0 && (
          <div className="rb-confirm-total" style={{ color: "var(--rb-clay, #B45A38)" }}>
            <span>Balance due at lodge</span><strong>{money(balanceDue)}</strong>
          </div>
        )}
        <p className="rb-sub" style={{ textAlign: "center", fontSize: 12, marginTop: 12 }}>{policyLine}</p>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="rb-btn rb-btn-ghost rb-btn-block" onClick={() => nav("/account/bookings")}>View my bookings</button>
          <button className="rb-btn rb-btn-primary rb-btn-block" onClick={() => nav("/")}>Done</button>
        </div>
      </div>
    </div></div>
    );
  }

  // ── Checkout ──────────────────────────────────────────
  // Backend emits `gst_amount` (not `tax_amount`). Total is persisted
  // server-side as subtotal + tax − discount, matching the Razorpay charge.
  const subtotal = booking.subtotal ?? booking.total_amount;
  const tax = booking.gst_amount ?? booking.tax_amount ?? 0;
  const discount = booking.promo_discount || 0;
  const grandTotal = booking.total_amount ?? Math.max(0, Number(subtotal) + Number(tax) - Number(discount));

  return (
    <div className="rb"><div className="rb-container-narrow" style={{ padding: "24px 20px 60px" }}>
      <button className="rb-btn rb-btn-ghost" style={{ padding: "8px 14px", marginBottom: 18 }} onClick={() => nav(-1)}>
        <ChevronLeft size={16} /> Back
      </button>

      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 20px" }}>Complete your booking</h1>

      <div className="rb-checkout-grid">
        {/* Left — details */}
        <div>
          <section className="rb-co-card">
            <h2 className="rb-co-title"><span className="rb-co-step">1</span> Your details</h2>
            <div className="rb-co-field">
              <label className="rb-label">Full name</label>
              <input className="rb-input" value={contact.full_name} placeholder="As per your ID"
                onChange={e => setContact(c => ({ ...c, full_name: e.target.value }))} />
            </div>
            <div className="rb-co-field">
              <label className="rb-label">Phone number</label>
              <input className="rb-input" value={contact.phone} placeholder="10-digit mobile"
                onChange={e => setContact(c => ({ ...c, phone: e.target.value }))} />
            </div>
            <div className="rb-co-field">
              <label className="rb-label">Email <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
              <input className="rb-input" value={contact.email} placeholder="name@email.com"
                onChange={e => setContact(c => ({ ...c, email: e.target.value }))} />
            </div>
          </section>

          <section className="rb-co-card">
            <h2 className="rb-co-title"><span className="rb-co-step">2</span> Have a promo code?</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="rb-input" placeholder="Enter code" value={promoCode}
                onChange={e => setPromoCode(e.target.value)} style={{ textTransform: "uppercase" }} />
              <button className="rb-btn rb-btn-ghost" onClick={applyPromo} disabled={promoLoading} style={{ flexShrink: 0 }}>
                {promoLoading ? <Loader2 size={16} className="rb-spin" /> : "Apply"}
              </button>
            </div>
            {discount > 0 && <p style={{ color: "var(--rb-green)", fontSize: 13, fontWeight: 600, margin: "10px 0 0" }}>
              <Tag size={13} style={{ verticalAlign: -2 }} /> {booking.promo_code} applied — you save {money(discount)}</p>}
          </section>
        </div>

        {/* Right — summary */}
        <aside className="rb-co-summary-rail">
          <div className="rb-co-summary">
            <div className="rb-co-lodge">
              <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>{booking.lodge?.name}</p>
              {booking.lodge?.public_city && <p className="rb-lodge-city"><MapPin size={12} /> {booking.lodge.public_city}</p>}
            </div>
            <div className="rb-co-facts">
              <div className="rb-co-fact"><Calendar size={15} /><span>{booking.checkin_date} → {booking.checkout_date}</span></div>
              <div className="rb-co-fact"><Users size={15} /><span>{booking.rooms_count} room{booking.rooms_count > 1 ? "s" : ""} · {booking.adults} guest{booking.adults > 1 ? "s" : ""}</span></div>
              <div className="rb-co-fact"><span style={{ width: 15 }} /><span>{booking.room_type_label || booking.room_type} · {nights} night{nights > 1 ? "s" : ""}</span></div>
            </div>

            <div className="rb-co-lines">
              <div className="rb-co-line"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {discount > 0 && <div className="rb-co-line" style={{ color: "var(--rb-green)" }}><span>Discount{booking.promo_code ? ` (${booking.promo_code})` : ""}</span><span>−{money(discount)}</span></div>}
              {tax > 0 && <div className="rb-co-line"><span>Taxes & fees (GST)</span><span>{money(tax)}</span></div>}
              <div className="rb-co-grand"><span>Total</span><span>{money(grandTotal)}</span></div>
            </div>

            <button className="rb-btn rb-btn-primary rb-btn-block rb-btn-lg" onClick={handlePay} disabled={paying} style={{ marginTop: 16, opacity: paying ? .7 : 1 }}>
              {paying ? <><Loader2 size={18} className="rb-spin" /> Processing…</> : <><Lock size={16} /> Pay {money(grandTotal)}</>}
            </button>
            <p className="rb-co-secure"><ShieldCheck size={13} /> Secure payment · Razorpay</p>
          </div>
        </aside>
      </div>
    </div></div>
  );
}
