import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { User, BookOpen, MapPin, Phone, Mail, Calendar, Star, Download, X,
         Edit3, Save, Heart, Award, ChevronRight, Loader2, BadgeCheck, LogOut,
         AlertCircle } from "lucide-react";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { rustoBookingsAPI, reviewsAPI, rustoMembershipAPI } from "../../services/api";
import { toast } from "react-toastify";

/* ── Status badge ─────────────────────────────────────────────────── */
const STATUS = {
  payment_pending:{ label:"Payment pending", bg:"var(--gold-50, #FFFBEB)", text:"#92400E", dot:"var(--c-star, #F59E0B)" },
  initiated:      { label:"Processing",      bg:"#FFF7ED", text:"#C2410C", dot:"#F97316" },
  confirmed:      { label:"Confirmed",       bg:"var(--brand-success-bg,#F0FDF4)", text:"var(--brand-success,#166534)", dot:"#22C55E" },
  checked_in:     { label:"Checked in",      bg:"var(--brand-cta-bg,#EFF6FF)", text:"var(--brand-cta,#1E3A8A)", dot:"#3B82F6" },
  checked_out:    { label:"Completed",       bg:"#F9FAFB", text:"var(--ink-600, #475569)", dot:"var(--text-muted,#94A3B8)" },
  cancelled:      { label:"Cancelled",       bg:"var(--brand-error-bg,#FEF2F2)", text:"var(--brand-error,#991B1B)", dot:"var(--c-heart, #EF4444)" },
};
function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.checked_out;
  const cls = {
    confirmed:       "status-confirmed",
    checked_in:      "status-info",
    checked_out:     "status-neutral",
    payment_pending: "status-pending",
    initiated:       "status-pending",
    cancelled:       "status-cancelled",
  }[status] || "status-neutral";
  return (
    <span className={`status-badge ${cls}`} style={{fontSize:11}}>
      {s.label}
    </span>
  );
}

/* ── Booking card ─────────────────────────────────────────────────── */
function BookingCard({ b, onCancel, onReview, myReviews }) {
  const [showKeyCard, setShowKeyCard] = useState(false);
  const canCancel  = ["payment_pending","confirmed"].includes(b.status);
  const canReview  = b.status === "checked_out" && !myReviews[b.booking_id];
  const hasReview  = !!myReviews[b.booking_id];
  const canReceipt = ["confirmed","checked_in","checked_out"].includes(b.status);

  const downloadReceipt = async () => {
    try {
      const r = await rustoBookingsAPI.receipt(b.booking_id);
      const d = r.data;
      const w = window.open("","_blank");
      w.document.write(`<!DOCTYPE html><html><head><title>Receipt ${d.booking_ref}</title>
        <style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#0F172A}
        h1{font-size:20px;font-weight:700}table{width:100%;border-collapse:collapse;margin:16px 0}
        td{padding:8px 0;border-bottom:1px solid var(--border-soft,#F1F5F9);font-size:14px}td:last-child{text-align:right;font-weight:600}
        .ref{font-family:monospace;font-weight:700;color:#1E40AF}.total{font-size:18px;font-weight:800}</style></head><body>
        <h1>${d.hotel_name || "Rusto"}</h1><p style="color:#64748B;font-size:13px">${d.hotel_address||""}</p>
        <hr style="border:1px solid var(--border,#E2E8F0);margin:16px 0"/>
        <p>Booking reference: <span class="ref">${d.booking_ref}</span></p>
        <table>
          <tr><td>Guest</td><td>${d.guest_name||""}</td></tr>
          <tr><td>Check-in</td><td>${d.checkin_date}</td></tr>
          <tr><td>Check-out</td><td>${d.checkout_date}</td></tr>
          <tr><td>Room type</td><td>${(d.room_type||"").replace(/_/g," ")}</td></tr>
          <tr><td>Nights</td><td>${d.nights}</td></tr>
          <tr><td>Subtotal</td><td>₹${Number(d.subtotal||0).toLocaleString("en-IN")}</td></tr>
          <tr><td class="total">Total paid</td><td class="total">₹${Number(d.total_amount||0).toLocaleString("en-IN")}</td></tr>
        </table></body></html>`);
    } catch { toast.error("Could not load receipt"); }
  };

  return (
    <div style={{background:"var(--surface,#FFFFFF)", borderRadius:16, border:"1px solid var(--border,#E2E8F0)",
      boxShadow:"0 1px 3px rgba(15,23,42,0.06)", overflow:"hidden"}}>
      <div style={{padding:"16px 20px"}}>
        <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:12}}>
          <div style={{flex:1, minWidth:0}}>
            <p style={{fontWeight:700, color:"var(--text-primary,#0F172A)", fontSize:15, marginBottom:4}}>
              {b.lodge?.name || "Property"}
            </p>
            {b.lodge?.public_city && (
              <p style={{display:"flex", alignItems:"center", gap:4, fontSize:13, color:"var(--text-body,#475569)"}}>
                <MapPin size={12}/>{b.lodge.public_city}
              </p>
            )}
          </div>
          <StatusBadge status={b.status}/>
        </div>

        {/* Date / price strip */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:0,
          background:"var(--page-bg,#F8FAFC)", borderRadius:10, overflow:"hidden",
          border:"1px solid var(--border-soft,#F1F5F9)", marginBottom:14}}>
          {[
            ["Check-in",  new Date(b.checkin_date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})],
            ["Check-out", new Date(b.checkout_date).toLocaleDateString("en-IN",{day:"numeric",month:"short"})],
            ["Total",     `₹${Number(b.total_amount||0).toLocaleString("en-IN")}`],
          ].map(([label, val], i) => (
            <div key={label} style={{padding:"10px 14px", borderRight: i < 2 ? "1px solid var(--border-soft,#F1F5F9)" : "none"}}>
              <p style={{fontSize:10, color:"var(--text-muted,#94A3B8)", fontWeight:700, textTransform:"uppercase",
                letterSpacing:"0.06em", marginBottom:3}}>{label}</p>
              <p style={{fontSize:14, fontWeight:700, color:"var(--text-primary,#0F172A)"}}>{val}</p>
            </div>
          ))}
        </div>

        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between",
          fontSize:12, color:"var(--text-muted,#94A3B8)", marginBottom:14}}>
          <span>Ref: <code style={{fontFamily:"monospace", color:"var(--text-secondary,#334155)", fontWeight:600}}>{b.booking_ref}</code></span>
          <span style={{textTransform:"capitalize"}}>{(b.room_type||"").replace(/_/g," ")} × {b.rooms_count||1}</span>
        </div>

        <div style={{display:"flex", flexWrap:"wrap", gap:8}}>
          {canReceipt && (
            <button onClick={downloadReceipt}
              style={{display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8,
                fontSize:12, fontWeight:600, color:"var(--text-secondary,#334155)", background:"var(--page-bg,#F8FAFC)",
                border:"1px solid var(--border,#E2E8F0)", cursor:"pointer"}}>
              <Download size={12}/>Receipt
            </button>
          )}
          {["confirmed", "checked_in"].includes(b.status) && (
            <button onClick={() => setShowKeyCard(!showKeyCard)}
              style={{display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8,
                fontSize:12, fontWeight:600, color:"var(--text-secondary,#334155)", background:"var(--surface-2,#F1F5F9)",
                border:"1px solid var(--border,#E2E8F0)", cursor:"pointer"}}>
              📶 {showKeyCard ? "Hide Wi-Fi" : "Show Wi-Fi"}
            </button>
          )}
          {canReview && (
            <button onClick={() => onReview(b)}
              style={{display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8,
                fontSize:12, fontWeight:700, color:"white", background:"var(--brand-cta,#1E3A8A)",
                border:"none", cursor:"pointer"}}>
              <Star size={12}/>Write a review
            </button>
          )}
          {hasReview && (
            <span style={{display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8,
              fontSize:12, fontWeight:600, color:"var(--brand-success,#166534)", background:"var(--brand-success-bg,#F0FDF4)", border:"1px solid #BBF7D0"}}>
              <BadgeCheck size={12}/>Reviewed
            </span>
          )}
          {canCancel && (
            <button onClick={() => onCancel(b)}
              style={{display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:8,
                fontSize:12, fontWeight:600, color:"var(--brand-error,#991B1B)", background:"var(--brand-error-bg,#FEF2F2)",
                border:"1px solid var(--brand-error,#991B1B)", cursor:"pointer", marginLeft:"auto"}}>
              <X size={12}/>Cancel
            </button>
          )}
        </div>

        {/* Welcome / Wi-Fi Digital Card */}
        {showKeyCard && (
          <div className="mt-4 bg-gradient-to-br from-[#1E293B] to-[#0F1B33] border border-white/10 rounded-xl p-4 text-white animate-fade-in">
            <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
              <span className="text-[9px] uppercase tracking-widest text-[#F59E0B] font-bold">Digital Key Card</span>
              <span className="text-xs">📶</span>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <p className="text-[8px] uppercase tracking-widest text-white/50">Guest Wi-Fi Network</p>
                <p className="font-mono font-bold text-white mt-0.5">
                  {(b.lodge?.name || "Rusto").replace(/\s+/g, '')}_Guest
                </p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-widest text-white/50">Password</p>
                <p className="font-mono font-bold text-[#F59E0B] mt-0.5">REST_EVERYWHERE</p>
              </div>
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[8px] text-white/40">
                <span>🔑 Ref: {b.booking_ref}</span>
                <span>🕒 Check-in: 12:00 PM</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Review modal ─────────────────────────────────────────────────── */
function ReviewModal({ booking, onClose, onSaved }) {
  const [rating,  setRating]  = useState(5);
  const [hovered, setHovered] = useState(0);
  const [title,   setTitle]   = useState("");
  const [body,    setBody]    = useState("");
  const [saving,  setSaving]  = useState(false);

  const save = async () => {
    if (!body.trim()) { toast.error("Please write something"); return; }
    setSaving(true);
    try {
      const r = await reviewsAPI.submit({ booking_id:booking.booking_id, rating, title, body });
      toast.success("Review submitted — thank you!");
      onSaved(r.data); onClose();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{position:"fixed", inset:0, zIndex:50, background:"rgba(0,0,0,0.45)",
      display:"flex", alignItems:"center", justifyContent:"center", padding:16}}>
      <div onClick={e => e.stopPropagation()}
        style={{background:"var(--surface,#FFFFFF)", borderRadius:20, padding:28, maxWidth:440, width:"100%",
          boxShadow:"0 24px 64px rgba(0,0,0,0.2)"}}>
        <h3 style={{fontFamily:"Outfit,sans-serif", fontWeight:700, color:"var(--text-primary,#0F172A)", fontSize:20, marginBottom:4}}>
          How was your stay?
        </h3>
        <p style={{fontSize:13, color:"var(--text-body,#475569)", marginBottom:20}}>{booking.lodge?.name || "Your stay"}</p>

        <div style={{display:"flex", gap:6, alignItems:"center", marginBottom:20}}>
          {[1,2,3,4,5].map(n => (
            <button key={n} type="button"
              onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(n)}
              style={{background:"none", border:"none", cursor:"pointer", padding:2, lineHeight:0}}>
              <Star size={28} style={{
                fill:(hovered||rating) >= n ? "var(--star-color,#F59E0B)" : "var(--border,#E2E8F0)",
                color:(hovered||rating) >= n ? "var(--star-color,#F59E0B)" : "var(--border,#E2E8F0)",
                transition:"fill 0.1s"}}/>
            </button>
          ))}
          <span style={{fontSize:13, color:"var(--text-body,#475569)", marginLeft:8}}>
            {["","Terrible","Poor","Okay","Good","Excellent!"][hovered||rating]}
          </span>
        </div>

        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Review title (optional)"
          style={{display:"block", width:"100%", padding:"10px 14px", borderRadius:10, fontSize:14,
            border:"1.5px solid var(--border,#E2E8F0)", outline:"none", marginBottom:10, boxSizing:"border-box"}}/>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
          placeholder="Tell us about your stay — room quality, service, food, location…"
          style={{display:"block", width:"100%", padding:"10px 14px", borderRadius:10, fontSize:14,
            border:"1.5px solid var(--border,#E2E8F0)", outline:"none", resize:"none", marginBottom:16, boxSizing:"border-box"}}/>

        <div style={{display:"flex", gap:10}}>
          <button onClick={onClose}
            style={{flex:1, padding:"11px", borderRadius:10, fontSize:14, fontWeight:600,
              color:"var(--ink-600, #475569)", background:"var(--page-bg,#F8FAFC)", border:"1px solid var(--border,#E2E8F0)", cursor:"pointer"}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !body.trim()}
            style={{flex:1, padding:"11px", borderRadius:10, fontSize:14, fontWeight:700,
              color:"white", background: saving || !body.trim() ? "var(--text-muted,#94A3B8)" : "var(--brand-cta,#1E3A8A)",
              border:"none", cursor: saving||!body.trim() ? "not-allowed" : "pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6}}>
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Star size={14}/>}
            Submit review
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export default function RustoAccount() {
  const { customer, loading:authLoading, logout, updateProfile } = useCustomerAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const tab       = location.pathname.includes("bookings") ? "bookings" : "profile";

  useEffect(() => {
    if (!authLoading && !customer) navigate("/signin?next=/account", { replace:true });
  }, [customer, authLoading, navigate]);

  if (authLoading || !customer) return (
    <div style={{minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center"}}>
      <Loader2 size={28} className="animate-spin" style={{color:"var(--text-muted,#94A3B8)"}}/>
    </div>
  );

  const initials    = customer.full_name?.split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase() || "?";
  const memberSince = new Date(customer.created_at || Date.now())
    .toLocaleDateString("en-IN",{month:"long", year:"numeric"});

  return (
    <div className="customer-page" style={{minHeight:"100vh", paddingBottom:64}}>
      {/* Header */}
      <div style={{background:"var(--surface,#FFFFFF)", borderBottom:"1px solid var(--border,#E2E8F0)"}}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6" style={{padding:"28px 16px 0"}}>
          <div style={{display:"flex", alignItems:"center", gap:16, paddingBottom:20,
            borderBottom:"1px solid var(--border-soft,#F1F5F9)"}}>
            {/* Avatar */}
            <div style={{width:56, height:56, borderRadius:14, background:"var(--brand-navy,#1B2A4A)",
              display:"flex", alignItems:"center", justifycontent:"center",
              fontFamily:"Outfit,sans-serif", fontWeight:700, fontSize:22, color:"var(--brand-gold-dark,#A8873C)", flexShrink:0}}>
              {initials}
            </div>

            <div style={{flex:1, minWidth:0}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:4}}>
                <h1 style={{fontFamily:"Outfit,sans-serif", fontWeight:700, color:"var(--text-primary,#0F172A)",
                  fontSize:20, margin:0}}>
                  {customer.full_name || "Traveller"}
                </h1>
                <span style={{display:"flex", alignItems:"center", gap:4, padding:"2px 8px",
                  borderRadius:999, background:"var(--brand-cta-bg,#EFF6FF)", fontSize:11, fontWeight:700, color:"var(--brand-cta,#1E3A8A)"}}>
                  <BadgeCheck size={11}/>Verified
                </span>
              </div>
              <div style={{display:"flex", flexWrap:"wrap", gap:"4px 16px", fontSize:13, color:"var(--text-body,#475569)"}}>
                {customer.phone && <span style={{display:"flex", alignItems:"center", gap:4}}><Phone size={12}/>{customer.phone}</span>}
                {customer.email && <span style={{display:"flex", alignItems:"center", gap:4}}><Mail size={12}/>{customer.email}</span>}
                <span style={{display:"flex", alignItems:"center", gap:4}}><Calendar size={12}/>Since {memberSince}</span>
              </div>
            </div>

            <button onClick={() => { logout(); navigate("/"); }}
              style={{display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:10,
                fontSize:13, fontWeight:600, color:"var(--text-body,#475569)", background:"var(--page-bg,#F8FAFC)",
                border:"1px solid var(--border,#E2E8F0)", cursor:"pointer"}}>
              <LogOut size={13}/>Sign out
            </button>
          </div>

          {/* Tabs */}
          <div style={{display:"flex", gap:0, marginTop:0}}>
            {[
              { path:"/account",          label:"Profile",     icon:User,    key:"profile"   },
              { path:"/account/bookings", label:"My Bookings", icon:BookOpen, key:"bookings"  },
            ].map(t => (
              <Link key={t.key} to={t.path}
                style={{display:"flex", alignItems:"center", gap:8, padding:"14px 20px",
                  fontSize:14, fontWeight:600, textDecoration:"none",
                  borderBottom:`2.5px solid ${tab === t.key ? "var(--brand-cta,#1E3A8A)" : "transparent"}`,
                  color: tab === t.key ? "var(--brand-cta,#1E3A8A)" : "var(--text-body,#475569)",
                  transition:"all 0.15s"}}>
                <t.icon size={14}/>{t.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6" style={{marginTop:24}}>
        {tab === "profile"
          ? <ProfileTab customer={customer} updateProfile={updateProfile}/>
          : <BookingsTab/>}
      </div>
    </div>
  );
}

/* ── Profile tab ──────────────────────────────────────────────────── */
function ProfileTab({ customer, updateProfile }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState({
    full_name: customer.full_name || "",
    email:     customer.email     || "",
    city:      customer.city      || "",
    state:     customer.state     || "",
  });
  const [saving, setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    try { await updateProfile(form); setEditing(false); toast.success("Profile updated"); }
    catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
    finally { setSaving(false); }
  };

  const inputStyle = {
    display:"block", width:"100%", padding:"10px 14px", borderRadius:10, fontSize:14,
    border:"1.5px solid var(--border,#E2E8F0)", outline:"none", color:"var(--text-primary,#0F172A)", background:"var(--surface,#FFFFFF)",
    boxSizing:"border-box", transition:"border-color 0.15s",
  };

  return (
    <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:20, alignItems:"start"}}>
      {/* Profile form */}
      <div style={{background:"var(--surface,#FFFFFF)", borderRadius:16, border:"1px solid var(--border,#E2E8F0)",
        boxShadow:"0 1px 3px rgba(15,23,42,0.06)", overflow:"hidden"}}>
        <div style={{padding:"16px 20px", borderBottom:"1px solid #F1F5F9",
          display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <h2 style={{fontWeight:700, color:"var(--text-primary,#0F172A)", fontSize:15, margin:0}}>Personal information</h2>
          {!editing ? (
            <button onClick={() => setEditing(true)}
              style={{display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:600,
                color:"var(--brand-cta,#1E3A8A)", background:"none", border:"none", cursor:"pointer"}}>
              <Edit3 size={13}/>Edit
            </button>
          ) : (
            <div style={{display:"flex", gap:12}}>
              <button onClick={() => setEditing(false)}
                style={{fontSize:13, color:"var(--text-body,#475569)", background:"none", border:"none", cursor:"pointer", fontWeight:500}}>
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                style={{display:"flex", alignItems:"center", gap:6, padding:"6px 14px", borderRadius:8,
                  fontSize:13, fontWeight:700, color:"white", background: saving ? "var(--text-muted,#94A3B8)" : "var(--brand-cta,#1E3A8A)",
                  border:"none", cursor:"pointer"}}>
                {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>}Save
              </button>
            </div>
          )}
        </div>

        <div style={{padding:"20px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>
          {[
            { key:"full_name", label:"Full name",    icon:User },
            { key:"email",     label:"Email address", icon:Mail },
            { key:"city",      label:"City",          icon:MapPin },
            { key:"state",     label:"State",         icon:MapPin },
          ].map(({ key, label, icon:Icon }) => (
            <div key={key}>
              <label style={{display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700,
                color:"var(--text-muted,#94A3B8)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6}}>
                <Icon size={11}/>{label}
              </label>
              {editing ? (
                <input value={form[key]} onChange={e => setForm(p => ({...p, [key]:e.target.value}))}
                  style={inputStyle}/>
              ) : (
                <p style={{fontSize:14, color: form[key] ? "var(--text-primary,#0F172A)" : "var(--text-muted,#94A3B8)", fontWeight:500}}>
                  {form[key] || "—"}
                </p>
              )}
            </div>
          ))}

          <div>
            <label style={{display:"flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700,
              color:"var(--text-muted,#94A3B8)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6}}>
              <Phone size={11}/>Phone
            </label>
            <p style={{fontSize:14, color:"var(--text-primary,#0F172A)", fontWeight:500}}>{customer.phone}</p>
            <p style={{fontSize:11, color:"var(--text-muted,#94A3B8)", marginTop:2}}>Cannot be changed</p>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div style={{display:"flex", flexDirection:"column", gap:12}}>
        <div style={{background:"var(--surface,#FFFFFF)", borderRadius:16, border:"1px solid var(--border,#E2E8F0)",
          boxShadow:"0 1px 3px rgba(15,23,42,0.06)", overflow:"hidden"}}>
          {[
            { to:"/search",     icon:"🏨", label:"Find lodges",  sub:"Browse all properties" },
            { to:"/wishlist",   icon:"❤️", label:"Wishlist",      sub:"Saved properties"       },
            { to:"/membership", icon:"⭐", label:"Membership",    sub:"Points & perks"         },
          ].map(({ to, icon, label, sub }, i) => (
            <Link key={to} to={to}
              style={{display:"flex", alignItems:"center", gap:12, padding:"14px 16px",
                textDecoration:"none", borderBottom: i < 2 ? "1px solid var(--border-soft,#F1F5F9)" : "none",
                transition:"background 0.1s"}}
              onMouseEnter={e => e.currentTarget.style.background="var(--page-bg,#F8FAFC)"}
              onMouseLeave={e => e.currentTarget.style.background="transparent"}>
              <span style={{fontSize:18}}>{icon}</span>
              <div style={{flex:1}}>
                <p style={{fontSize:13, fontWeight:600, color:"var(--text-primary,#0F172A)", marginBottom:1}}>{label}</p>
                <p style={{fontSize:12, color:"var(--text-muted,#94A3B8)"}}>{sub}</p>
              </div>
              <ChevronRight size={14} style={{color:"var(--text-muted,#94A3B8)"}}/>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Bookings tab ─────────────────────────────────────────────────── */
function BookingsTab() {
  const [bookings, setBookings] = useState([]);
  const [myReviews, setMyReviews] = useState({});
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("upcoming");
  const [reviewFor, setReviewFor] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      rustoBookingsAPI.list({ limit:50 }),
      reviewsAPI.mine(),
    ]).then(([bk, rv]) => {
      if (bk.status === "fulfilled") setBookings(bk.value.data || []);
      if (rv.status === "fulfilled") {
        const m = {};
        (rv.value.data || []).forEach(r => { m[r.booking_id] = r; });
        setMyReviews(m);
      }
    }).finally(() => setLoading(false));
  }, []);

  const cancel = async b => {
    if (!window.confirm(`Cancel booking ${b.booking_ref}?`)) return;
    try {
      const r = await rustoBookingsAPI.cancel(b.booking_id, { reason:"Cancelled by customer" });
      setBookings(bs => bs.map(x => x.booking_id === b.booking_id
        ? (r.data?.booking || {...x, status:"cancelled"}) : x));
      toast.success("Booking cancelled");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not cancel"); }
  };

  const today    = new Date().toISOString().slice(0,10);
  const upcoming = bookings.filter(b => !["cancelled","checked_out"].includes(b.status) && b.checkout_date >= today);
  const past     = bookings.filter(b => !upcoming.includes(b));
  const shown    = filter === "upcoming" ? upcoming : filter === "past" ? past : bookings;

  if (loading) return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"center", padding:"64px 0"}}>
      <Loader2 size={24} className="animate-spin" style={{color:"var(--text-muted,#94A3B8)"}}/>
    </div>
  );

  const FILTERS = [
    { key:"upcoming", label:"Upcoming",  count:upcoming.length },
    { key:"past",     label:"Past stays", count:null },
    { key:"all",      label:"All",        count:bookings.length },
  ];

  return (
    <div>
      {/* Filter tabs */}
      <div style={{display:"flex", gap:4, background:"var(--surface,#FFFFFF)", borderRadius:12, padding:4,
        border:"1px solid var(--border,#E2E8F0)", marginBottom:20, width:"fit-content",
        boxShadow:"0 1px 3px rgba(15,23,42,0.04)"}}>
        {FILTERS.map(({ key, label, count }) => (
          <button key={key} onClick={() => setFilter(key)}
            style={{display:"flex", alignItems:"center", gap:6, padding:"8px 16px",
              borderRadius:10, fontSize:13, fontWeight:600, border:"none", cursor:"pointer",
              transition:"all 0.15s",
              background: filter === key ? "var(--brand-cta,#1E3A8A)" : "transparent",
              color:      filter === key ? "white"   : "var(--text-body,#475569)"}}>
            {label}
            {count !== null && count > 0 && (
              <span style={{padding:"1px 7px", borderRadius:999, fontSize:11, fontWeight:700,
                background: filter === key ? "rgba(255,255,255,0.2)" : "var(--brand-cta-bg,#EFF6FF)",
                color:      filter === key ? "white" : "var(--brand-cta,#1E3A8A)"}}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <div style={{textAlign:"center", padding:"64px 16px", background:"var(--surface,#FFFFFF)",
          borderRadius:16, border:"1px solid var(--border,#E2E8F0)"}}>
          <p style={{fontSize:40, marginBottom:12}}>🏨</p>
          <p style={{fontWeight:700, color:"var(--text-primary,#0F172A)", fontSize:16, marginBottom:8}}>
            {filter === "upcoming" ? "No upcoming stays" : filter === "past" ? "No past stays yet" : "No bookings yet"}
          </p>
          <p style={{fontSize:14, color:"var(--text-body,#475569)", marginBottom:20}}>
            {filter !== "past" ? "Ready to plan your next trip?" : "Your completed stays will appear here."}
          </p>
          <Link to="/search" className="btn-primary" style={{padding:"11px 24px", borderRadius:10}}>
            Find a lodge
          </Link>
        </div>
      ) : (
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16}}>
          {shown.map(b => (
            <BookingCard key={b.booking_id} b={b} onCancel={cancel}
              onReview={setReviewFor} myReviews={myReviews}/>
          ))}
        </div>
      )}

      {reviewFor && (
        <ReviewModal booking={reviewFor} onClose={() => setReviewFor(null)}
          onSaved={review => { if (review?.booking_id) setMyReviews(m => ({...m, [review.booking_id]:review})); }}/>
      )}
    </div>
  );
}
