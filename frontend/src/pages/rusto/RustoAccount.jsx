import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { User, BookOpen, Mail, Phone,
         MapPin, Calendar, CheckCircle2, AlertCircle,
         Clock, XCircle, Loader2, Edit2,
         Save, X, Star, Heart,
         Award, CreditCard, ChevronRight, Gift,
         BadgeCheck, Compass } from "lucide-react";
import { toast } from "react-toastify";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { rustoBookingsAPI, reviewsAPI } from "../../services/api";
import StarRating from "../../components/StarRating";

/**
 * Customer account dashboard.
 *
 * Design intent: feel like a premium loyalty membership area, not a
 * data table. Two views, same shell:
 *   - Profile (default at /account) — hero header with avatar + stats,
 *     editable details card, membership perks card
 *   - My bookings (at /account/bookings) — chronological timeline of
 *     stays with status pills, action buttons, and review prompts
 */
export default function RustoAccount() {
  const { customer, loading } = useCustomerAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const tab = loc.pathname.endsWith("/bookings") ? "bookings" : "profile";

  useEffect(() => {
    if (!loading && !customer) nav("/signin?next=/account");
  }, [customer, loading, nav]);

  if (loading || !customer) return (
    <div className="max-w-2xl mx-auto p-12 text-center">
      <Loader2 size={32} className="mx-auto animate-spin text-gold mb-3"/>
      <p className="text-ink-500">Loading your account…</p>
    </div>
  );

  const initials = (customer.full_name || "Guest").split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  const memberSince = customer.created_at
    ? new Date(customer.created_at).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : "Recently";

  return (
    <div className="animate-fade-in pb-12">
      {/* ═════════ HERO HEADER ═════════ */}
      <section className="relative bg-gradient-to-br from-navy via-navy-light to-navy-dark text-white
                            pt-12 pb-24 overflow-hidden">
        <div className="hero-stars opacity-50"/>
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full bg-gold/15 blur-3xl
                          animate-parallax-slow pointer-events-none"/>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6 animate-rise-up">
            {/* Avatar */}
            <div className="relative">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-gold to-gold-dark
                                flex items-center justify-center shadow-gold-glow">
                <span className="font-display text-4xl font-bold text-navy-dark">{initials}</span>
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-green-500 ring-4 ring-navy
                                flex items-center justify-center">
                <BadgeCheck size={14} className="text-white"/>
              </div>
            </div>

            <div className="flex-1">
              <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-1">My Rusto</p>
              <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">
                Welcome back, {customer.full_name?.split(" ")[0] || "Traveller"}
              </h1>
              <p className="text-white/70 mt-2 flex items-center gap-2 flex-wrap text-sm">
                <span className="flex items-center gap-1">
                  <Calendar size={13}/> Member since {memberSince}
                </span>
                {customer.email && (
                  <>
                    <span className="text-white/30">·</span>
                    <span className="flex items-center gap-1">
                      <Mail size={13}/> {customer.email}
                    </span>
                  </>
                )}
              </p>
            </div>

            <div className="hidden md:flex">
              <Link to="/search" className="btn-gold inline-flex items-center gap-2 px-5">
                <Compass size={15}/> Plan next trip
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════ TABS + CONTENT ═════════ */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 relative z-10">
        {/* Tabs (premium pill style) */}
        <div className="inline-flex p-1 rounded-2xl bg-white shadow-lifted border border-ink-100 mb-8
                          animate-rise-scale">
          <Link to="/account"
                className={`px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 rounded-xl ${
                  tab === "profile"
                    ? "bg-gradient-to-br from-navy to-navy-light text-white shadow-soft"
                    : "text-ink-600 hover:text-navy hover:bg-ink-50"
                }`}>
            <User size={15}/> Profile
          </Link>
          <Link to="/account/bookings"
                className={`px-5 py-2.5 text-sm font-semibold transition-all flex items-center gap-2 rounded-xl ${
                  tab === "bookings"
                    ? "bg-gradient-to-br from-navy to-navy-light text-white shadow-soft"
                    : "text-ink-600 hover:text-navy hover:bg-ink-50"
                }`}>
            <BookOpen size={15}/> My bookings
          </Link>
        </div>

        {tab === "profile" ? <ProfilePanel/> : <BookingsPanel/>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function ProfilePanel() {
  const { customer, updateProfile } = useCustomerAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) setForm({
      full_name: customer.full_name || "",
      email: customer.email || "",
      address_line: customer.address_line || "",
      city: customer.city || "",
      state: customer.state || "",
      pincode: customer.pincode || "",
    });
  }, [customer]);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success("Profile updated");
      setEditing(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Update failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-rise-up">
      {/* Profile details — spans 2 columns */}
      <div className="lg:col-span-2 card bg-white border border-ink-100">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl font-bold text-navy flex items-center gap-2">
            <User size={18} className="text-gold"/> Account details
          </h2>
          {!editing ? (
            <button onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 border-ink-200
                                bg-white text-ink-700 hover:border-gold hover:text-gold-700 transition-all text-sm font-semibold">
              <Edit2 size={13}/> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)}
                      className="btn-ghost text-sm">Cancel</button>
              <button onClick={save} disabled={saving}
                      className="btn-gold text-sm flex items-center gap-1.5">
                {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
                Save changes
              </button>
            </div>
          )}
        </div>

        {!editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReadField label="Full name" Icon={User} value={customer.full_name}/>
            <ReadField label="Phone" Icon={Phone} value={customer.phone || "—"}/>
            <ReadField label="Email" Icon={Mail} value={customer.email || "Not set"}/>
            <ReadField label="City" Icon={MapPin}
                        value={customer.city ? `${customer.city}${customer.state ? `, ${customer.state}` : ""}` : "Not set"}/>
            {(customer.address_line || customer.pincode) && (
              <ReadField label="Address" Icon={MapPin}
                          value={[customer.address_line, customer.pincode].filter(Boolean).join(" · ")}
                          wide/>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <EditField label="Full name"
                        value={form.full_name}
                        onChange={v => setForm(f => ({...f, full_name: v}))}/>
            <EditField label="Email" type="email"
                        value={form.email}
                        onChange={v => setForm(f => ({...f, email: v}))}/>
            <EditField label="Address" wide
                        value={form.address_line}
                        onChange={v => setForm(f => ({...f, address_line: v}))}/>
            <EditField label="City"
                        value={form.city}
                        onChange={v => setForm(f => ({...f, city: v}))}/>
            <EditField label="State"
                        value={form.state}
                        onChange={v => setForm(f => ({...f, state: v}))}/>
            <EditField label="Pincode"
                        value={form.pincode}
                        onChange={v => setForm(f => ({...f, pincode: v}))}/>
          </div>
        )}
      </div>

      {/* Sidebar: perks card */}
      <div className="space-y-6">
        <PerksCard/>
        <QuickLinksCard/>
      </div>
    </div>
  );
}

function ReadField({ label, value, Icon, wide }) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 flex items-center gap-1.5 mb-1">
        <Icon size={11}/> {label}
      </p>
      <p className="font-semibold text-navy">{value}</p>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text", wide }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="label">{label}</span>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
              className="input-field"/>
    </label>
  );
}

function PerksCard() {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-navy via-navy-light to-navy-dark
                      text-white p-6 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-gold/20 blur-3xl"/>
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                          bg-gold/20 text-gold text-2xs uppercase tracking-eyebrow font-bold mb-3">
          <Award size={11}/> Rusto Member
        </div>
        <h3 className="font-display text-xl font-bold mb-2">Your perks</h3>
        <ul className="space-y-2.5 mt-4 text-sm">
          {[
            "Member-only rates on every booking",
            "Priority concierge via WhatsApp",
            "Free cancellation on most stays",
            "Early access to new properties",
          ].map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-white/85">
              <CheckCircle2 size={15} className="text-gold flex-shrink-0 mt-0.5"/>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuickLinksCard() {
  const links = [
    { to: "/search",           Icon: Compass,     label: "Find your next stay" },
    { to: "/account/bookings", Icon: BookOpen,    label: "My bookings" },
    { to: "/wishlist",         Icon: Heart,       label: "Saved lodges" },
    { to: "#",                 Icon: Gift,        label: "Refer & earn" },
  ];
  return (
    <div className="card bg-white border border-ink-100 p-2">
      {links.map((l, i) => (
        <Link key={i} to={l.to}
              onClick={(e) => l.to === "#" && (e.preventDefault(), toast.info("Elite RUSTO Concierge: Share your private invite link to earn ₹1,000 in direct booking credits! Details are active in your WhatsApp portal."))}
              className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-gold-50 transition-all group">
          <div className="w-9 h-9 rounded-xl bg-ink-100 group-hover:bg-gold group-hover:text-navy-dark
                            flex items-center justify-center text-ink-500 transition-all">
            <l.Icon size={16}/>
          </div>
          <span className="text-sm font-semibold text-navy flex-1">{l.label}</span>
          <ChevronRight size={14} className="text-ink-400 group-hover:text-navy
                                                group-hover:translate-x-0.5 transition-all"/>
        </Link>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function BookingsPanel() {
  const [bookings, setBookings] = useState([]);
  const [myReviews, setMyReviews] = useState({});
  const [loading, setLoading] = useState(true);
  const [reviewingFor, setReviewingFor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      rustoBookingsAPI.list({ limit: 50 }),
      reviewsAPI.mine(),
    ]).then(([bk, rv]) => {
      if (cancelled) return;
      if (bk.status === "fulfilled") setBookings(bk.value.data);
      else toast.error("Failed to load bookings");
      if (rv.status === "fulfilled") {
        const m = {};
        rv.value.data.forEach(r => { m[r.booking_id] = r; });
        setMyReviews(m);
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const onReviewSaved = (review) => {
    if (review?.booking_id) {
      setMyReviews(m => ({ ...m, [review.booking_id]: review }));
    }
  };

  const cancel = async (b) => {
    if (!window.confirm(`Cancel booking ${b.booking_ref}?`)) return;
    try {
      const r = await rustoBookingsAPI.cancel(b.booking_id, { reason: "Cancelled by customer" });
      setBookings(bs => bs.map(x => x.booking_id === b.booking_id ? r.data : x));
      toast.success("Booking cancelled");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cancellation failed");
    }
  };

  if (loading) return (
    <div className="text-center py-16">
      <Loader2 size={28} className="mx-auto animate-spin text-gold mb-2"/>
      <p className="text-ink-500 text-sm">Loading your bookings…</p>
    </div>
  );

  if (bookings.length === 0) return (
    <div className="card bg-white border border-ink-100 text-center py-16 animate-rise-up">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-50 to-gold-100
                        ring-1 ring-gold/20 items-center justify-center mb-5">
        <BookOpen size={28} className="text-gold-700"/>
      </div>
      <h3 className="font-display text-xl font-bold text-navy mb-2">No bookings yet</h3>
      <p className="text-ink-500 mt-1 mb-6 max-w-md mx-auto">
        Start exploring handpicked lodges across India — your next escape is just a few clicks away.
      </p>
      <Link to="/search" className="btn-gold inline-flex items-center gap-2">
        <Compass size={15}/> Browse lodges
      </Link>
    </div>
  );

  // Group bookings into Upcoming + Past for a timeline-style layout
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter(b =>
    !["cancelled", "checked_out"].includes(b.status) && b.checkout_date >= today
  );
  const past = bookings.filter(b => !upcoming.includes(b));

  return (
    <div className="animate-rise-up">
      {upcoming.length > 0 && (
        <div className="mb-10">
          <BookingsGroupHeader title="Upcoming stays" count={upcoming.length} accent="gold"/>
          <div className="space-y-4">
            {upcoming.map((b, i) => (
              <BookingCard key={b.booking_id} b={b} onCancel={cancel}
                            existingReview={myReviews[b.booking_id]}
                            onReview={() => setReviewingFor(b)}
                            index={i}/>
            ))}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <BookingsGroupHeader title="Past stays" count={past.length}/>
          <div className="space-y-4">
            {past.map((b, i) => (
              <BookingCard key={b.booking_id} b={b} onCancel={cancel}
                            existingReview={myReviews[b.booking_id]}
                            onReview={() => setReviewingFor(b)}
                            index={i + upcoming.length}/>
            ))}
          </div>
        </div>
      )}
      {reviewingFor && (
        <ReviewModal booking={reviewingFor}
                      existing={myReviews[reviewingFor.booking_id]}
                      onClose={() => setReviewingFor(null)}
                      onSaved={r => { onReviewSaved(r); setReviewingFor(null); }}/>
      )}
    </div>
  );
}

function BookingsGroupHeader({ title, count, accent }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <h3 className="font-display text-xl font-bold text-navy">{title}</h3>
      <span className={`text-2xs uppercase tracking-eyebrow font-bold px-2 py-0.5 rounded ${
        accent === "gold" ? "bg-gold-50 text-gold-700" : "bg-ink-100 text-ink-600"
      }`}>
        {count}
      </span>
    </div>
  );
}

function BookingCard({ b, onCancel, existingReview, onReview, index }) {
  const STATUS = {
    initiated:       { label: "Started",         cls: "bg-ink-100   text-ink-700",    Icon: Clock },
    payment_pending: { label: "Payment Pending", cls: "bg-amber-50  text-amber-800",  Icon: Clock },
    confirmed:       { label: "Confirmed",       cls: "bg-green-50  text-green-800",  Icon: CheckCircle2 },
    checked_in:      { label: "Checked In",      cls: "bg-blue-50   text-blue-800",   Icon: CheckCircle2 },
    checked_out:     { label: "Completed",       cls: "bg-ink-100   text-ink-700",    Icon: CheckCircle2 },
    cancelled:       { label: "Cancelled",       cls: "bg-red-50    text-red-700",    Icon: XCircle },
    payment_failed:  { label: "Payment Failed",  cls: "bg-red-50    text-red-700",    Icon: AlertCircle },
  }[b.status] || { label: b.status, cls: "bg-ink-100 text-ink-700", Icon: AlertCircle };

  const canCancel = ["confirmed", "payment_pending", "initiated"].includes(b.status);
  const canPay = b.status === "payment_pending";
  const canReview = ["checked_in", "checked_out"].includes(b.status);

  return (
    <div className="card bg-white border border-ink-100 p-0 overflow-hidden
                      hover:shadow-lifted hover:border-gold/30 transition-all duration-300
                      animate-rise-up"
          style={{ animationDelay: `${Math.min(index * 80, 600)}ms` }}>
      {/* Top accent strip — colored by status */}
      <div className={`h-1 ${
        b.status === "confirmed" || b.status === "checked_in" ? "bg-gradient-to-r from-green-400 to-green-600" :
        b.status === "payment_pending" ? "bg-gradient-to-r from-amber-400 to-amber-600" :
        b.status === "cancelled" ? "bg-gradient-to-r from-red-400 to-red-600" :
        "bg-gradient-to-r from-ink-300 to-ink-400"
      }`}/>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <code className="text-2xs font-mono text-ink-400">{b.booking_ref}</code>
              <span className={`badge ${STATUS.cls} ring-1 ring-inset ring-current/20`}>
                <STATUS.Icon size={11}/> {STATUS.label}
              </span>
            </div>
            <h3 className="font-display text-xl font-bold text-navy">{b.lodge?.name || "Lodge"}</h3>
            <p className="text-xs text-ink-500 flex items-center gap-1 mt-0.5">
              <MapPin size={11}/>
              {b.lodge?.city}{b.lodge?.state ? `, ${b.lodge?.state}` : ""}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
          <Stat label="Check-in" value={formatDate(b.checkin_date)}/>
          <Stat label="Check-out" value={formatDate(b.checkout_date)}/>
          <Stat label="Room" value={`${b.room_type_label || b.room_type} × ${b.rooms_count}`}/>
          <Stat label="Total"
                value={<span className="text-gold-700 font-bold">₹{b.total_amount.toLocaleString("en-IN")}</span>}/>
        </div>

        {/* Review summary line */}
        {canReview && existingReview && (
          <div className="flex items-center justify-between gap-3 mb-3 p-3 rounded-xl bg-gold-50 border border-gold/20">
            <div className="flex items-center gap-2 min-w-0">
              <Star size={14} className="fill-gold-700 text-gold-700"/>
              <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600">
                Your review
              </span>
              <StarRating value={existingReview.rating} size="sm"/>
              {existingReview.status === "hidden" && (
                <span className="badge bg-ink-100 text-ink-600 text-2xs">Hidden</span>
              )}
              {existingReview.status === "flagged" && (
                <span className="badge bg-red-50 text-red-700 text-2xs">Removed</span>
              )}
            </div>
            {existingReview.status !== "flagged" && (
              <button onClick={onReview}
                      className="text-2xs font-bold text-gold-700 hover:text-gold-800 uppercase tracking-eyebrow">
                Edit
              </button>
            )}
          </div>
        )}

        {(canCancel || canPay || (canReview && !existingReview)) && (
          <div className="flex gap-2 pt-3 border-t border-ink-100">
            {canPay && (
              <Link to={`/checkout/${b.booking_id}`}
                    className="btn-gold flex-1 text-center text-sm flex items-center justify-center gap-2">
                <CreditCard size={14}/> Complete payment
              </Link>
            )}
            {canReview && !existingReview && (
              <button onClick={onReview}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-br from-gold to-gold-dark
                                  text-navy-dark font-semibold text-sm shadow-soft
                                  hover:shadow-gold-glow hover:-translate-y-0.5 transition-all
                                  flex items-center justify-center gap-2">
                <Star size={14}/> Write a review
              </button>
            )}
            {canCancel && (
              <button onClick={() => onCancel(b)}
                      className="px-4 py-2.5 rounded-xl border-2 border-red-200 text-red-600
                                  bg-white hover:bg-red-50 hover:border-red-400 transition-all text-sm font-semibold">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</div>
      <div className="text-navy font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ────────────────────────────────────────────────────────────────────
// Review modal (unchanged logic, refreshed visuals)
// ────────────────────────────────────────────────────────────────────
function ReviewModal({ booking, existing, onClose, onSaved }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [title,  setTitle]  = useState(existing?.title  || "");
  const [body,   setBody]   = useState(existing?.body   || "");
  const [busy,   setBusy]   = useState(false);
  const [removing, setRemoving] = useState(false);

  const isEdit = !!existing;

  const submit = async (e) => {
    e.preventDefault();
    if (rating < 1) { toast.error("Tap to pick a rating"); return; }
    setBusy(true);
    try {
      const payload = {
        rating,
        title: title.trim() || null,
        body:  body.trim()  || null,
      };
      const r = isEdit
        ? await reviewsAPI.edit(existing.review_id, payload)
        : await reviewsAPI.submit({ booking_id: booking.booking_id, ...payload });
      toast.success(isEdit ? "Review updated" : "Thanks for your review!");
      onSaved(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't save review");
    } finally { setBusy(false); }
  };

  const hide = async () => {
    if (!isEdit) return;
    if (!window.confirm("Hide this review? It will be removed from public view but you can re-publish later.")) return;
    setRemoving(true);
    try {
      await reviewsAPI.hide(existing.review_id);
      toast.success("Review hidden");
      onSaved({ ...existing, status: "hidden" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't hide review");
    } finally { setRemoving(false); }
  };

  const republish = async () => {
    if (!isEdit) return;
    setRemoving(true);
    try {
      const r = await reviewsAPI.edit(existing.review_id, { status: "published" });
      toast.success("Review re-published");
      onSaved(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't re-publish review");
    } finally { setRemoving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="modal-box max-w-lg">
        <div className="p-5 border-b border-ink-100 flex justify-between items-start
                          bg-gradient-to-br from-navy to-navy-light text-white rounded-t-2xl">
          <div>
            <h2 className="font-display text-xl font-bold">
              {isEdit ? "Edit your review" : "Share your experience"}
            </h2>
            <p className="text-xs text-white/70 mt-0.5">
              {booking.lodge?.name} · {booking.checkin_date}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="p-2 rounded-xl hover:bg-white/10 transition-colors">
            <X size={18}/>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Your rating</label>
            <div className="flex items-center gap-3">
              <StarRating value={rating} onChange={setRating} input size="lg"/>
              {rating > 0 && (
                <span className="text-sm font-semibold text-navy animate-fade-in">
                  {["Terrible","Poor","Okay","Good","Excellent"][rating-1]}
                </span>
              )}
            </div>
          </div>
          <label className="block">
            <span className="label">Title <span className="text-ink-400 font-normal">(optional)</span></span>
            <input value={title} maxLength={120}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="Sum up your stay in a few words"
                    className="input-field"/>
          </label>
          <label className="block">
            <span className="label">Details <span className="text-ink-400 font-normal">(optional)</span></span>
            <textarea value={body} maxLength={4000} rows={5}
                      onChange={e => setBody(e.target.value)}
                      placeholder="What stood out — good and bad? Other guests will thank you."
                      className="input-field"/>
            <div className="text-2xs text-ink-400 text-right mt-1">{body.length}/4000</div>
          </label>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2">
          {isEdit ? (
            existing.status === "hidden"
              ? <button type="button" onClick={republish} disabled={removing}
                        className="btn-outline text-sm">Re-publish</button>
              : <button type="button" onClick={hide} disabled={removing}
                        className="btn-outline text-sm border-red-300 text-red-600 hover:bg-red-50">
                  Hide review
                </button>
          ) : <span/>}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy}
                    className="btn-gold flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
              {isEdit ? "Save changes" : "Submit review"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
