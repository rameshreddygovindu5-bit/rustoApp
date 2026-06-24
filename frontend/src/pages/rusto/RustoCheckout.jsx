import React, { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { CreditCard, CheckCircle2, AlertCircle, Loader2,
         Shield, MapPin, Users, Sparkles,
         ArrowLeft, Lock, Mail, Phone,
         ArrowRight, Wallet, FileText , MessageSquare, Tag, X} from "lucide-react";
import { toast } from "react-toastify";
import { rustoBookingsAPI, promosAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";

/**
 * Checkout page — payment-conversion surface.
 *
 * Design intent: minimize friction, maximize trust.
 *   - Big animated step indicator at top (Review → Pay → Confirmed)
 *   - Booking summary card on the right (sticky), payment area on left
 *   - Multiple payment-method visual indicators (Razorpay logo strip)
 *   - Confirmation screen feels celebratory with cinematic reveal
 *
 * Two arrival paths:
 *   1. From the lodge detail "Reserve" — booking + razorpay payload arrive
 *      via location.state, no extra fetch needed
 *   2. Direct URL hit — we fetch the booking; if no razorpay payload
 *      available we treat it as a status view
 */

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(window.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
    document.body.appendChild(s);
  });
}

export default function RustoCheckout() {
  const { bookingId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { customer, updateProfile } = useCustomerAuth();

  const initial = loc.state || null;
  const [booking, setBooking] = useState(initial?.booking || null);
  const [razorpay, setRazorpay] = useState(initial?.razorpay || null);
  // Bundle add-ons passed from lodge detail page
  const passedBundles = initial?.bundles || [];
  const passedSelected = initial?.selectedBundles || {};
  const [selectedBundles] = useState(passedSelected);
  const [loading, setLoading] = useState(!initial?.booking);
  // Track if user arrived via direct URL (no state) — show status only
  const isDirectAccess = !initial?.booking;
  const [paying, setPaying] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoResult, setPromoResult] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [editingContact, setEditingContact] = useState(false);
  const [specialRequests, setSpecialRequests] = useState(booking?.special_requests || "");
  const [contactForm, setContactForm] = useState({
    full_name: customer?.full_name || booking?.contact_name || "",
    phone:     customer?.phone     || booking?.contact_phone || "",
    email:     customer?.email     || booking?.contact_email || "",
  });
  const [savingContact, setSavingContact] = useState(false);

  // Initialize form when customer or booking data arrives
  useEffect(() => {
    setContactForm({
      full_name: customer?.full_name || booking?.contact_name || "",
      phone:     customer?.phone     || booking?.contact_phone || "",
      email:     customer?.email     || booking?.contact_email || "",
    });
  }, [customer, booking]);

  const saveContact = async () => {
    if (!contactForm.full_name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSavingContact(true);
    try {
      await updateProfile(contactForm);
      toast.success("Guest details updated successfully");
      setEditingContact(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update details");
    } finally {
      setSavingContact(false);
    }
  };

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    rustoBookingsAPI.get(bookingId)
      .then(r => { if (!cancelled) setBooking(r.data); })
      .catch(() => { if (!cancelled) toast.error("Couldn't load booking"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId, initial]);

  const handlePay = async () => {
    if (!razorpay) {
      // Direct URL access without payment session — show helpful message
      toast.error("Payment session expired. Please re-book from the lodge page.");
      if (booking?.lodge?.code) nav(`/lodges/${booking.lodge.code}`);
      return;
    }
    setPaying(true);
    try {
      if (razorpay.is_mock) {
        // Mock mode — skip Razorpay popup
        const r = await rustoBookingsAPI.verifyPayment(bookingId, {
          razorpay_order_id: razorpay.order_id,
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
        key: razorpay.key_id, order_id: razorpay.order_id,
        amount: razorpay.amount, currency: razorpay.currency,
        name: razorpay.name, description: razorpay.description,
        prefill: razorpay.prefill,
        theme: { color: "var(--gold-DEFAULT, #C9A84C)" },
        handler: async (resp) => {
          try {
            const r = await rustoBookingsAPI.verifyPayment(bookingId, {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
            setBooking(r.data.booking); setDone(true);
            toast.success("Payment successful! Booking confirmed.");
          } catch (e) {
            toast.error(e.response?.data?.detail || "Payment verification failed");
          } finally { setPaying(false); }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (e) {
      toast.error(e.message || "Payment failed to start");
      setPaying(false);
    }
  };

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    try {
      const r = await rustoBookingsAPI.applyPromo(bookingId, {
        promo_code: promoCode.trim().toUpperCase()
      });
      setBooking(r.data.booking);
      setRazorpay(r.data.razorpay);
      setPromoResult({
        code: r.data.booking.promo_code,
        discount_amount: r.data.booking.promo_discount,
      });
      toast.success(`Promo applied! You save ₹${r.data.booking.promo_discount.toLocaleString("en-IN")}`);
    } catch (e) {
      setPromoResult(null);
      toast.error(e.response?.data?.detail || "Invalid promo code — please check and try again");
    } finally { setPromoLoading(false); }
  };

  const removePromo = async () => {
    setPromoLoading(true);
    try {
      const r = await rustoBookingsAPI.applyPromo(bookingId, { promo_code: "" });
      setBooking(r.data.booking);
      setRazorpay(r.data.razorpay);
      setPromoResult(null);
      setPromoCode("");
      toast.info("Promo code removed");
    } catch (e) {
      toast.error("Could not remove promo code");
    } finally { setPromoLoading(false); }
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto p-12 text-center">
      <Loader2 size={32} className="mx-auto animate-spin text-gold mb-3"/>
      <p className="text-ink-500">Loading your booking…</p>
    </div>
  );

  if (!booking) return (
    <div className="max-w-2xl mx-auto p-12 text-center">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-red-50 ring-1 ring-red-200
                        items-center justify-center mb-5">
        <AlertCircle size={28} className="text-red-500"/>
      </div>
      <h2 className="font-display text-2xl font-bold text-navy mb-2">Booking not found</h2>
      <p className="text-ink-500 mb-6">It may have been cancelled or the link is wrong.</p>
      <Link to="/account/bookings" className="btn-cta">My bookings</Link>
    </div>
  );

  // Confirmation screen
  if (done || booking.status === "confirmed") {
    return <ConfirmationScreen booking={booking}/>;
  }

  // Determine which step
  const step = paying ? 2 : 1; // 1 = review, 2 = pay (in progress), 3 = done

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in rusto-page-light" style={{background:"var(--page-bg,#F8FAFC)"}}>
      <button onClick={() => nav(-1)}
              className="flex items-center gap-1.5 text-sm text-ink-600 hover:text-navy transition-colors mb-6 font-medium">
        <ArrowLeft size={14}/> Back
      </button>

      {/* Step indicator */}
      <StepIndicator currentStep={step}/>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
        {/* Left: payment area */}
        <div className="animate-rise-up checkout-light-col">
          <h1 className="font-display text-2xl font-bold text-navy mb-1">Confirm your booking</h1>
          <p className="text-ink-600 mb-8">Review the details below and complete your booking with a secure payment.</p>

          {/* Guest details card */}
          <SectionCard 
            title="Guest details" 
            icon={Users}
            action={
              !editingContact ? (
                <button
                  onClick={() => {
                    setContactForm({
                      full_name: customer?.full_name || "",
                      phone: customer?.phone || "",
                      email: customer?.email || ""
                    });
                    setEditingContact(true);
                  }}
                  className="text-xs font-semibold text-orange-600 hover:text-orange-700"
                >
                  Edit contact
                </button>
              ) : (
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setEditingContact(false)} className="text-ink-500 hover:text-ink-700 font-medium">
                    Cancel
                  </button>
                  <span className="text-ink-300">|</span>
                  <button onClick={saveContact} disabled={savingContact} className="text-gold-700 font-bold hover:text-gold-600">
                    {savingContact ? "Saving..." : "Save"}
                  </button>
                </div>
              )
            }
          >
            {!editingContact ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DetailField label="Full name" value={customer?.full_name || "Guest"} Icon={Users}/>
                <DetailField label="Phone" value={customer?.phone || "—"} Icon={Phone}/>
                <DetailField label="Email" value={customer?.email || "—"} Icon={Mail}/>
                <DetailField label="Guests" value={`${booking.adults} adult${booking.adults > 1 ? "s" : ""}`}
                              Icon={Users}/>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-600 block mb-1">Full Name</label>
                  <input
                    type="text"
                    value={contactForm.full_name}
                    onChange={(e) => setContactForm((f) => ({ ...f, full_name: e.target.value }))}
                    className="w-full border border-ink-300 rounded-xl px-3 py-2.5 text-sm text-ink-800
                               focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-600 block mb-1">Phone</label>
                  <input
                    type="text"
                    value={contactForm.phone}
                    onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-ink-300 rounded-xl px-3 py-2.5 text-sm text-ink-800 font-mono
                               focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-600 block mb-1">Email</label>
                  <input
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full border border-ink-300 rounded-xl px-3 py-2.5 text-sm text-ink-800
                               focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-transparent bg-white"
                  />
                </div>
                <div className="flex flex-col justify-center bg-ivory-50 rounded-xl px-3 py-2.5 border border-ivory-200">
                  <span className="text-xs text-ink-500">Guests</span>
                  <span className="text-sm font-semibold text-ink-800 mt-0.5">{booking.adults} Adult{booking.adults > 1 ? "s" : ""}</span>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Special Requests */}
          <SectionCard title="Special Requests" icon={MessageSquare}>
            <p className="text-xs text-ink-500 mb-3 leading-relaxed">
              Optional: let the property know about dietary needs, room preferences, arrival time, or any special occasion.
            </p>
            <textarea
              rows={3}
              value={specialRequests}
              onChange={e => setSpecialRequests(e.target.value)}
              placeholder="e.g. We're celebrating an anniversary, please arrange flowers. Vegetarian meals only. Late check-in at 10pm."
              className="w-full rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gold/30"
                          style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}
              maxLength={500}
            />
            <p className="text-2xs text-ink-400 mt-1 text-right">{specialRequests.length}/500</p>
          </SectionCard>

          {/* Promo Code */}
          <SectionCard title="Promo Code" icon={Tag}>
            <div className="flex gap-2">
              <input
                value={promoCode}
                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && applyPromo()}
                placeholder="Enter promo code (e.g. RUSTO10)"
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-gold/30"
                           style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}
                maxLength={30}
              />
              <button onClick={applyPromo} disabled={promoLoading || !promoCode.trim()}
                      className="px-4 py-2.5 bg-gold hover:bg-gold/90 text-navy-dark font-bold text-sm rounded-xl
                                 transition-colors disabled:opacity-50 shrink-0 flex items-center gap-1.5">
                {promoLoading ? <Loader2 size={14} className="animate-spin"/> : null}
                Apply
              </button>
            </div>
            {promoResult && (
              <div className="mt-3 flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
                <CheckCircle2 size={16} className="text-green-600 shrink-0"/>
                <div>
                  <span className="font-bold">{promoResult.code}</span> applied —{" "}
                  <span className="font-bold">₹{promoResult.discount_amount} off</span>
                  {promoResult.discount_pct > 0 && <span className="text-green-600 text-xs ml-1">({promoResult.discount_pct}%)</span>}
                </div>
                <button onClick={removePromo}
                        className="ml-auto text-green-500 hover:text-green-700">
                  <X size={14}/>
                </button>
              </div>
            )}
          </SectionCard>

          {/* Payment method */}
          <SectionCard title="Payment method" icon={CreditCard} className="mt-4">
            <div className="rounded-2xl border-2 border-gold bg-gold-50 p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold to-gold-dark
                                  flex items-center justify-center shadow-gold flex-shrink-0">
                  <Wallet size={20} className="text-navy-dark"/>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-navy">
                    Razorpay Secure Checkout
                    {razorpay?.is_mock && (
                      <span className="ml-2 text-2xs uppercase tracking-eyebrow font-bold
                                          bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        Test mode
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-600 mt-0.5">
                    Cards, UPI, NetBanking, Wallets — all securely processed by Razorpay
                  </p>
                </div>
                <CheckCircle2 size={20} className="text-gold-700 flex-shrink-0"/>
              </div>
              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gold/30">
                {["VISA", "MASTERCARD", "UPI", "RUPAY", "NETBANKING"].map(brand => (
                  <span key={brand}
                        className="text-2xs font-bold text-ink-500 px-2 py-1 bg-white rounded
                                    ring-1 ring-ink-200 tracking-wider">
                    {brand}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-ivory-50 flex items-start gap-2.5">
              <Shield size={16} className="text-green-600 flex-shrink-0 mt-0.5"/>
              <p className="text-xs text-ink-600 leading-relaxed">
                Your payment is secured with bank-grade 256-bit SSL encryption.
                Rusto never sees or stores your card details.
              </p>
            </div>
          </SectionCard>

          {/* Cancellation policy */}
          <SectionCard title="Cancellation policy" icon={FileText} className="mt-4">
            <p className="text-sm text-ink-700 leading-relaxed">
              <strong className="text-green-700">Free cancellation</strong> until 24 hours before your check-in date.
              After that, cancellations may incur a one-night charge per booking. Refunds typically take 5-7 business days.
            </p>
          </SectionCard>

          {/* Pay button */}
          <div className="mt-8">
            <button onClick={handlePay} disabled={paying}
                    className="w-full px-6 py-4 rounded-2xl font-bold text-base text-white
                                transition-all duration-200
                                disabled:opacity-60 disabled:cursor-wait
                                flex items-center justify-center gap-3"
                    style={{background: paying ? '#4b5563' : '#16a34a'}}>
              {paying ? (
                <>
                  <Loader2 size={18} className="animate-spin"/>
                  Processing payment…
                </>
              ) : (
                <>
                  <Lock size={16}/>
                  Pay ₹{Math.max(0, booking.total_amount - (promoResult?.discount_amount || 0)).toLocaleString("en-IN")} securely
                  <ArrowRight size={16}/>
                </>
              )}
            </button>
            <p className="text-2xs text-center text-ink-500 mt-3 flex items-center justify-center gap-1.5">
              <Shield size={11}/> By proceeding, you agree to Rusto's Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>

        {/* Right: booking summary */}
        <div className="lg:sticky lg:top-24 lg:self-start animate-rise-scale rusto-page-light">
          <BookingSummary booking={booking} bundles={passedBundles} selectedBundles={selectedBundles} promoResult={promoResult}/>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function StepIndicator({ currentStep }) {
  const steps = [
    { num: 1, label: "Review",   sublabel: "Verify your booking" },
    { num: 2, label: "Pay",      sublabel: "Secure payment" },
    { num: 3, label: "Confirmed",sublabel: "You're all set" },
  ];
  return (
    <div className="flex items-center max-w-2xl mx-auto px-4">
      {steps.map((s, i) => (
        <React.Fragment key={s.num}>
          <div className="checkout-step flex flex-col items-center text-center">
            <div className={`checkout-step-bubble ${
              currentStep === s.num ? "checkout-step-bubble-active" :
              currentStep > s.num ? "checkout-step-bubble-done" : ""
            }`}>
              {currentStep > s.num ? <CheckCircle2 size={16}/> : s.num}
            </div>
            <div className="mt-2 hidden sm:block">
              <p className={`text-sm font-semibold ${
                currentStep === s.num ? "text-white font-bold" : "text-white/60"
              }`}>
                {s.label}
              </p>
              <p className="text-2xs text-white/50 mt-0.5">{s.sublabel}</p>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className={`checkout-step-connector mx-2 ${
              currentStep > s.num ? "checkout-step-connector-active" : ""
            }`}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, className = "", action }) {
  return (
    <div className={`bg-white border border-ivory-200 rounded-2xl p-6 mb-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-ink-800 text-base flex items-center gap-2">
          <Icon size={16} className="text-gold-600"/> {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function DetailField({ label, value, Icon }) {
  return (
    <div className="rounded-xl bg-ivory-50 border border-ivory-100 p-3">
      <p className="text-2xs uppercase tracking-wider font-bold text-ink-500 flex items-center gap-1">
        <Icon size={10}/> {label}
      </p>
      <p className="font-semibold text-ink-800 mt-1 text-sm">{value}</p>
    </div>
  );
}

function BookingSummary({ booking, bundles = [], selectedBundles = {}, promoResult = null }) {
  const bundleTotal = Object.entries(selectedBundles).reduce((sum, [id, qty]) => {
    const b = bundles.find(x => x.bundle_id === +id);
    return sum + (b ? b.price * qty : 0);
  }, 0);
  const nights = Math.round(
    (new Date(booking.checkout_date) - new Date(booking.checkin_date)) / 86400000
  );
  const subtotal = booking.subtotal || booking.total_amount * 0.88;
  const tax = booking.tax_amount || (booking.total_amount * 0.12);
  return (
    <div className="card !bg-white border border-ivory-200 overflow-hidden p-0 text-navy">
      {/* Lodge image header */}
      <div className="relative h-32 bg-gradient-to-br from-navy via-navy-light to-navy-dark
                        overflow-hidden">
        <div className="hero-stars opacity-50"/>
        <div className="absolute inset-0 p-5 flex flex-col justify-end">
          <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-1">
            You're booking
          </p>
          <p className="font-display text-xl font-bold text-white leading-tight">
            {booking.lodge?.name || "Your stay"}
          </p>
          <p className="text-xs text-white/70 mt-0.5 flex items-center gap-1">
            <MapPin size={11}/>
            {booking.lodge?.city || booking.lodge?.address || "India"}
          </p>
        </div>
      </div>
      {/* Body */}
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl bg-ivory-50 p-3">
            <p className="text-2xs uppercase tracking-wider font-bold text-ink-500">Check in</p>
            <p className="font-display text-lg font-bold text-navy mt-1 leading-none">
              {new Date(booking.checkin_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </p>
            <p className="text-2xs text-ink-500 mt-1">After {booking.lodge?.checkin_time || booking.checkin_time || "12:00"} PM</p>
          </div>
          <div className="rounded-xl bg-ivory-50 p-3">
            <p className="text-2xs uppercase tracking-wider font-bold text-ink-500">Check out</p>
            <p className="font-display text-lg font-bold text-navy mt-1 leading-none">
              {new Date(booking.checkout_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </p>
            <p className="text-2xs text-ink-500 mt-1">Before {booking.lodge?.checkout_time || booking.checkout_time || "11:00"} AM</p>
          </div>
        </div>

        <div className="text-sm space-y-1 mb-4 p-3 rounded-xl bg-gold-50 border border-gold/20">
          <SummaryRow label="Room type" value={booking.room_type_label || booking.room_type || "Standard"}/>
          <SummaryRow label="Rooms" value={`${booking.rooms_count} × ${nights} nights`}/>
          <SummaryRow label="Guests" value={`${booking.adults} adult${booking.adults > 1 ? "s" : ""}`}/>
        </div>

        {/* Cost */}
        <div className="space-y-2 pb-4 border-b border-ivory-100">
          <SummaryRow label="Subtotal" value={`₹${subtotal.toLocaleString("en-IN")}`}/>
          {/* Bundle add-ons */}
          {Object.entries(selectedBundles).map(([id, qty]) => {
            const b = bundles.find(x => x.bundle_id === +id);
            if (!b) return null;
            return <SummaryRow key={id} label={`${b.title} ×${qty}`} value={`₹${(b.price*qty).toLocaleString("en-IN")}`}/>;
          })}
          {bundleTotal > 0 && <SummaryRow label="Add-ons total" value={`₹${bundleTotal.toLocaleString("en-IN")}`}/>}
          <SummaryRow label="Taxes & fees" value={`₹${tax.toLocaleString("en-IN")}`}/>
          {promoResult && promoResult.discount_amount > 0 && (
            <div className="flex items-center justify-between py-1.5 text-sm font-semibold text-green-600">
              <span>🏷️ Promo: {promoResult.code}</span>
              <span>−₹{promoResult.discount_amount.toLocaleString("en-IN")}</span>
            </div>
          )}
        </div>
        <div className="flex items-baseline justify-between pt-4">
          <span className="font-display text-lg font-bold text-navy">
            {promoResult ? "You Pay" : "Total"}
          </span>
          <div className="text-right">
            {promoResult && promoResult.discount_amount > 0 && (
              <p className="text-sm text-ink-400 line-through">
                ₹{booking.total_amount.toLocaleString("en-IN")}
              </p>
            )}
            <p className="font-display text-2xl font-bold text-navy leading-none">
              ₹{Math.max(0, booking.total_amount - (promoResult?.discount_amount || 0)).toLocaleString("en-IN")}
            </p>
            <p className="text-2xs text-ink-500 mt-1">INR · all-inclusive</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-2xs text-ink-500">
          <span>Booking ref:</span>
          <code className="font-mono font-semibold text-navy">{booking.booking_ref}</code>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-600">{label}</span>
      <span className="font-semibold text-navy">{value}</span>
    </div>
  );
}

function ConfirmationScreen({ booking }) {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4 animate-fade-in">
      <div className="max-w-2xl w-full text-center">
        {/* Sparkle burst */}
        <div className="relative inline-block mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-green-600
                            flex items-center justify-center shadow-lifted animate-scale-in-bounce">
            <CheckCircle2 size={50} className="text-white"/>
          </div>
          {/* Decorative sparkles around the badge */}
          {[0, 60, 120, 180, 240, 300].map((angle, i) => (
            <Sparkles key={i} size={14}
                        className="absolute text-gold animate-pulse-soft"
                        style={{
                          top: `${50 + 60 * Math.sin(angle * Math.PI / 180)}%`,
                          left: `${50 + 60 * Math.cos(angle * Math.PI / 180)}%`,
                          transform: "translate(-50%, -50%)",
                          animationDelay: `${i * 200}ms`,
                        }}/>
          ))}
        </div>

        <p className="text-2xs uppercase tracking-eyebrow font-bold text-green-700 mb-2 animate-rise-up"
            style={{ animationDelay: "200ms" }}>
          Booking confirmed
        </p>
        <h1 className="font-display text-4xl md:text-5xl font-bold text-navy mb-3
                          animate-rise-up" style={{ animationDelay: "300ms" }}>
          You're all set!
        </h1>
        <p className="text-base md:text-lg text-ink-600 max-w-md mx-auto leading-relaxed
                        animate-rise-up" style={{ animationDelay: "400ms" }}>
          Your stay at <strong className="text-navy">{booking.lodge?.name || booking.lodge?.display_name}</strong> is confirmed.
          We've sent the details to <strong>{booking.contact_email || booking.email || "your registered contact"}</strong>.
        </p>

        {/* Points earned */}
        {booking.total_amount > 0 && (
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-gold/10 border border-gold/30 rounded-full animate-rise-up"
               style={{ animationDelay: "500ms" }}>
            <span className="text-lg">⭐</span>
            <span className="text-sm font-semibold text-gold-800">
              +{Math.floor(booking.total_amount / 100)} Rusto Points earned!
            </span>
          </div>
        )}

        {/* Welcome / Wi-Fi Digital Card */}
        <div className="mt-6 bg-gradient-to-br from-navy to-[#0F1B33] border border-white/10 rounded-2xl p-6 text-left max-w-md mx-auto animate-rise-up shadow-lux text-white"
             style={{ animationDelay: "550ms" }}>
          <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-amber-glow">Digital Key Card</span>
            <span className="text-sm">📶</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-white/50">Guest Wi-Fi Network</p>
              <p className="font-mono text-base font-bold text-white mt-0.5">
                {(booking.lodge?.name || "Rusto").replace(/\s+/g, '')}_Guest
              </p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest text-white/50">Password (Passcode)</p>
              <p className="font-mono text-base font-bold text-amber-glow mt-0.5">REST_EVERYWHERE</p>
            </div>
            <div className="pt-2 border-t border-white/5 flex items-center justify-between text-2xs text-white/60">
              <span>🔑 Code: {booking.booking_ref}</span>
              <span>🕒 Check-in: 12:00 PM</span>
            </div>
          </div>
        </div>

        {/* Booking card */}
        <div className="mt-8 bg-white border border-ivory-200 rounded-2xl p-6 text-left max-w-md mx-auto animate-rise-up shadow-sm"
              style={{ animationDelay: "600ms" }}>
          <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-ivory-200">
            <div>
              <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check in</p>
              <p className="font-display text-xl font-bold text-navy mt-1">
                {new Date(booking.checkin_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>
            <div>
              <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check out</p>
              <p className="font-display text-xl font-bold text-navy mt-1">
                {new Date(booking.checkout_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>
          </div>
          <ConfirmRow label="Booking reference" value={<code className="font-mono">{booking.booking_ref}</code>}/>
          <ConfirmRow label="Room" value={`${booking.room_type_label || booking.room_type} × ${booking.rooms_count}`}/>
          <ConfirmRow label="Total paid" value={
            <span className="text-gold-700 font-bold text-base">
              ₹{booking.total_amount.toLocaleString("en-IN")}
            </span>
          }/>
        </div>

        <div className="flex flex-wrap gap-3 justify-center mt-8 animate-rise-up"
              style={{ animationDelay: "600ms" }}>
          <Link to="/membership"
                className="px-6 py-3 rounded-xl border-2 border-ink-300 text-ink-700 font-semibold hover:bg-ivory-50 flex items-center justify-center gap-1.5">
              <span>⭐</span> View Membership
            </Link>
          <Link to="/account"
                className="px-6 py-3 rounded-xl font-bold text-white flex items-center gap-2"
                style={{background:"var(--brand-cta,#1E3A8A)"}}>
            View my bookings
          </Link>
          <Link to="/search"
                className="px-6 py-3 rounded-xl border-2 border-navy text-navy bg-white
                            font-semibold hover:bg-navy hover:text-white transition-all">
            Book another stay
          </Link>
        </div>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-ink-600">{label}</span>
      <span className="font-semibold text-navy text-right">{value}</span>
    </div>
  );
}
