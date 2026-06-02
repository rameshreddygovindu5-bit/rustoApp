import React, { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";
import { CreditCard, CheckCircle2, AlertCircle, Loader2,
         Shield, MapPin, Users, Sparkles,
         ArrowLeft, Lock, Mail, Phone,
         ArrowRight, Wallet, FileText } from "lucide-react";
import { toast } from "react-toastify";
import { rustoBookingsAPI } from "../../services/api";
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
  const { customer } = useCustomerAuth();

  const initial = loc.state || null;
  const [booking, setBooking] = useState(initial?.booking || null);
  const [razorpay, setRazorpay] = useState(initial?.razorpay || null);
  const [loading, setLoading] = useState(!initial);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);

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
      toast.error("Payment session unavailable. Please re-create the booking.");
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
        theme: { color: "#C9A84C" },
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
      <Link to="/account/bookings" className="btn-gold">My bookings</Link>
    </div>
  );

  // Confirmation screen
  if (done || booking.status === "confirmed") {
    return <ConfirmationScreen booking={booking}/>;
  }

  // Determine which step
  const step = paying ? 2 : 1; // 1 = review, 2 = pay (in progress), 3 = done

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <button onClick={() => nav(-1)}
              className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-navy transition-colors mb-6">
        <ArrowLeft size={14}/> Back
      </button>

      {/* Step indicator */}
      <StepIndicator currentStep={step}/>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
        {/* Left: payment area */}
        <div className="animate-rise-up">
          <h1 className="font-display text-3xl font-bold text-navy mb-2">Confirm and pay</h1>
          <p className="text-ink-500 mb-8">Review the details below and complete your booking with a secure payment.</p>

          {/* Guest details card */}
          <SectionCard title="Guest details" icon={Users}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailField label="Full name" value={customer?.full_name || "Guest"} Icon={Users}/>
              <DetailField label="Phone" value={customer?.phone || "—"} Icon={Phone}/>
              <DetailField label="Email" value={customer?.email || "—"} Icon={Mail}/>
              <DetailField label="Guests" value={`${booking.adults} adult${booking.adults > 1 ? "s" : ""}`}
                            Icon={Users}/>
            </div>
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

            <div className="mt-4 p-3 rounded-xl bg-ink-50 flex items-start gap-2.5">
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
                    className="w-full px-6 py-4 rounded-2xl bg-gradient-to-br from-gold to-gold-dark
                                text-navy-dark font-bold text-base uppercase tracking-eyebrow
                                shadow-gold-glow hover:shadow-gold hover:-translate-y-0.5
                                active:translate-y-0 transition-all duration-200
                                disabled:opacity-60 disabled:cursor-wait
                                flex items-center justify-center gap-3">
              {paying ? (
                <>
                  <Loader2 size={18} className="animate-spin"/>
                  Processing payment…
                </>
              ) : (
                <>
                  <Lock size={16}/>
                  Pay ₹{booking.total_amount.toLocaleString("en-IN")} securely
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
        <div className="lg:sticky lg:top-24 lg:self-start animate-rise-scale">
          <BookingSummary booking={booking}/>
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
                currentStep === s.num ? "text-navy" : "text-ink-500"
              }`}>
                {s.label}
              </p>
              <p className="text-2xs text-ink-400 mt-0.5">{s.sublabel}</p>
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

function SectionCard({ title, icon: Icon, children, className = "" }) {
  return (
    <div className={`card border border-ink-100 ${className}`}>
      <h3 className="font-display text-lg font-bold text-navy flex items-center gap-2 mb-4">
        <Icon size={16} className="text-gold"/> {title}
      </h3>
      {children}
    </div>
  );
}

function DetailField({ label, value, Icon }) {
  return (
    <div className="rounded-xl bg-ink-50 p-3">
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 flex items-center gap-1">
        <Icon size={10}/> {label}
      </p>
      <p className="font-semibold text-navy mt-1 text-sm">{value}</p>
    </div>
  );
}

function BookingSummary({ booking }) {
  const nights = Math.round(
    (new Date(booking.checkout_date) - new Date(booking.checkin_date)) / 86400000
  );
  const subtotal = booking.subtotal || booking.total_amount * 0.88;
  const tax = booking.tax_amount || (booking.total_amount * 0.12);
  return (
    <div className="card bg-white border border-ink-100 overflow-hidden p-0">
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
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check in</p>
            <p className="font-display text-lg font-bold text-navy mt-1 leading-none">
              {new Date(booking.checkin_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </p>
            <p className="text-2xs text-ink-500 mt-1">After 2:00 PM</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check out</p>
            <p className="font-display text-lg font-bold text-navy mt-1 leading-none">
              {new Date(booking.checkout_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </p>
            <p className="text-2xs text-ink-500 mt-1">Before 11:00 AM</p>
          </div>
        </div>

        <div className="text-sm space-y-1 mb-4 p-3 rounded-xl bg-gold-50 border border-gold/20">
          <SummaryRow label="Room type" value={booking.room_type_label || booking.room_type || "Standard"}/>
          <SummaryRow label="Rooms" value={`${booking.rooms_count} × ${nights} nights`}/>
          <SummaryRow label="Guests" value={`${booking.adults} adult${booking.adults > 1 ? "s" : ""}`}/>
        </div>

        {/* Cost */}
        <div className="space-y-2 pb-4 border-b border-ink-100">
          <SummaryRow label="Subtotal" value={`₹${subtotal.toLocaleString("en-IN")}`}/>
          <SummaryRow label="Taxes & fees" value={`₹${tax.toLocaleString("en-IN")}`}/>
        </div>
        <div className="flex items-baseline justify-between pt-4">
          <span className="font-display text-lg font-bold text-navy">Total</span>
          <div className="text-right">
            <p className="font-display text-2xl font-bold text-navy leading-none">
              ₹{booking.total_amount.toLocaleString("en-IN")}
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
          Your stay at <strong className="text-navy">{booking.lodge?.name}</strong> is confirmed.
          We've sent the details to <strong>{booking.email || "your registered contact"}</strong>.
        </p>

        {/* Booking card */}
        <div className="mt-8 card-lux text-left max-w-md mx-auto animate-rise-up"
              style={{ animationDelay: "500ms" }}>
          <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-ink-100">
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
          <Link to="/account/bookings" className="btn-gold px-6 py-3">
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
