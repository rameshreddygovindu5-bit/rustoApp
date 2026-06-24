import React, { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck, CheckCircle2, XCircle, Eye, Copy, Mail, Phone,
  MapPin, Hash, AlertCircle, Building2, User, ShieldCheck, RefreshCw,
  ExternalLink, IndianRupee, CreditCard, Clock, PhoneCall, FileText,
  X, Check, RotateCcw, Search, Loader2, Send, Bell, Award
} from "lucide-react";
import { toast } from "react-toastify";
import { registrationsAPI } from "../services/api";

const STATUS_TABS = [
  { key: "pending",  label: "Pending",  color: "amber" },
  { key: "approved", label: "Approved", color: "green" },
  { key: "rejected", label: "Rejected", color: "red" },
];

const PAYMENT_STATUS_CFG = {
  pending:           { label: "Payment Pending",   color: "amber",  icon: Clock },
  paid:              { label: "Paid",               color: "green",  icon: CheckCircle2 },
  failed:            { label: "Payment Failed",     color: "red",    icon: XCircle },
  waived:            { label: "Waived",             color: "blue",   icon: Award },
  offline_collected: { label: "Offline Collected",  color: "purple", icon: IndianRupee },
};

const PROPERTY_TYPE_LABELS = {
  lodge:"Lodge", hotel:"Hotel", resort:"Resort", boutique_hotel:"Boutique",
  motel:"Motel", homestay:"Homestay", villa:"Villa", service_apartment:"Svc Apt",
  hostel:"Hostel", heritage:"Heritage", eco_resort:"Eco Resort",
};

export default function Registrations() {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [payStats, setPayStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [approvalResult, setApprovalResult] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [listR, statsR, payR] = await Promise.all([
        registrationsAPI.list({ status: tab }),
        registrationsAPI.stats(),
        registrationsAPI.paymentStats(),
      ]);
      setRows(listR.data || []);
      setStats(statsR.data || {});
      setPayStats(payR.data || {});
    } catch { toast.error("Failed to load registrations"); }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  const approve = async (id) => {
    if (!window.confirm(`Approve REG-${String(id).padStart(6,"0")}? This creates the lodge account.`)) return;
    setBusy(true);
    try {
      const r = await registrationsAPI.approve(id);
      setApprovalResult(r.data);
      toast.success("Lodge approved! Capture credentials below.");
      refresh(); setSelected(null);
    } catch (e) { toast.error(e.response?.data?.detail || "Approval failed"); }
    finally { setBusy(false); }
  };

  const reject = async () => {
    if (rejectReason.trim().length < 3) { toast.error("Provide a reason"); return; }
    setBusy(true);
    try {
      await registrationsAPI.reject(rejecting, rejectReason.trim());
      toast.success("Rejected"); setRejecting(null); setRejectReason(""); refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Rejection failed"); }
    finally { setBusy(false); }
  };

  const filtered = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.lodge_name?.toLowerCase().includes(q) || r.owner_full_name?.toLowerCase().includes(q) ||
           r.owner_phone?.includes(q) || r.city?.toLowerCase().includes(q) || r.proposed_code?.toLowerCase().includes(q);
  });

  const totalRevenue = Object.values(payStats.by_payment_status || {}).reduce((s,v) => s+(v.total_amount||0), 0);

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <ClipboardCheck size={22} className="text-gold"/> Lodge Registrations
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">Review applications · manage payments · activate lodge accounts</p>
        </div>
        <button onClick={refresh} className="btn-icon" title="Refresh">
          {loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
        </button>
      </div>

      {/* KPI Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Pending Review",      value:stats.pending||0,       icon:Clock,        col:"text-amber-600", bg:"bg-amber-50" },
          { label:"Approved Lodges",     value:stats.approved||0,      icon:CheckCircle2, col:"text-green-600", bg:"bg-green-50" },
          { label:"Payment Follow-ups",  value:payStats.awaiting_payment_followup||0, icon:PhoneCall, col:"text-red-600", bg:"bg-red-50" },
          { label:"Revenue Collected",   value:`₹${Math.round(totalRevenue/1000)}K`, icon:IndianRupee, col:"text-gold", bg:"bg-amber-50" },
        ].map((k,i) => (
          <div key={i} className="card p-4 flex items-center gap-3 animate-slide-up" style={{animationDelay:`${i*40}ms`}}>
            <div className={`w-10 h-10 rounded-xl ${k.bg} flex items-center justify-center shrink-0`}>
              <k.icon size={18} className={k.col}/>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-navy">{k.value}</p>
              <p className="text-xs text-ink-500">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-ink-200">
          {STATUS_TABS.map(t => {
            const count = stats[t.key]||0; const active = tab===t.key;
            return (
              <button key={t.key} onClick={()=>setTab(t.key)}
                      className={`px-4 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap
                        ${active?"border-b-2 border-gold text-navy":"border-b-2 border-transparent text-ink-500 hover:text-navy"}`}>
                {t.label}
                {count>0 && <span className={`text-2xs px-2 py-0.5 rounded-full font-bold
                  ${t.color==="amber"?"bg-amber-100 text-amber-800":t.color==="green"?"bg-green-100 text-green-800":"bg-red-100 text-red-800"}`}>{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…"
                 className="input-field pl-8 text-sm py-2 w-52"/>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({length:4}).map((_,i)=>(
            <div key={i} className="card h-48 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
          ))}
        </div>
      ) : filtered.length===0 ? (
        <div className="card p-12 text-center">
          <Building2 size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">{search?"No results match.":"No "+tab+" registrations."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((r,i) => (
            <RegCard key={r.request_id} reg={r} style={{animationDelay:`${i*30}ms`}} busy={busy}
                     onView={()=>setSelected(r)}
                     onApprove={()=>approve(r.request_id)}
                     onReject={()=>{setRejecting(r.request_id);setRejectReason("");}}/>
          ))}
        </div>
      )}

      {selected && (
        <RegDrawer reg={selected} busy={busy}
          onClose={()=>setSelected(null)}
          onApprove={()=>approve(selected.request_id)}
          onReject={()=>{setRejecting(selected.request_id);setRejectReason("");setSelected(null);}}
          onPaymentUpdate={async(body)=>{
            const r = await registrationsAPI.updatePayment(selected.request_id, body);
            setSelected(r.data); refresh(); return r.data;
          }}
          onResend={async()=>{
            const r = await registrationsAPI.resendCredentials(selected.request_id);
            setApprovalResult(r.data); setSelected(null);
          }}
        />
      )}

      {rejecting && (
        <div className="modal-backdrop">
          <div className="modal-box max-w-md">
            <div className="p-5 border-b border-ink-100">
              <h2 className="font-display text-lg font-bold text-navy">Reject Registration</h2>
              <p className="text-sm text-ink-500 mt-1">Reason will be shared with the applicant.</p>
            </div>
            <div className="p-5">
              <textarea rows={5} value={rejectReason} onChange={e=>setRejectReason(e.target.value)}
                        placeholder="e.g. Insufficient documentation..." className="input-field"/>
            </div>
            <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
              <button onClick={()=>setRejecting(null)} className="btn-ghost">Cancel</button>
              <button onClick={reject} disabled={busy} className="btn-danger">
                {busy?<Loader2 size={14} className="animate-spin inline mr-1"/>:<XCircle size={14} className="inline mr-1"/>}
                {busy?"Rejecting…":"Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {approvalResult && <CredentialsModal data={approvalResult} onClose={()=>setApprovalResult(null)}/>}
    </div>
  );
}

// ── RegCard ──────────────────────────────────────────────────────────

function RegCard({reg, style, busy, onView, onApprove, onReject}) {
  const pCfg = PAYMENT_STATUS_CFG[reg.payment_status||"pending"] || PAYMENT_STATUS_CFG.pending;
  const isPending = reg.status==="pending";
  const payProblem = ["pending","failed"].includes(reg.payment_status||"pending");
  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-5 hover:shadow-lifted transition-all animate-slide-up" style={style}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-2xs font-mono text-gold font-bold">REG-{String(reg.request_id).padStart(6,"0")}</code>
            {reg.property_category && (
              <span className="text-2xs px-1.5 py-0.5 bg-navy/10 text-navy rounded font-semibold">
                {PROPERTY_TYPE_LABELS[reg.property_category]||reg.property_category}
              </span>
            )}
          </div>
          <h3 className="font-display text-lg font-bold text-navy truncate">{reg.lodge_name}</h3>
          <p className="text-xs text-ink-500 font-mono">{reg.proposed_code}</p>
        </div>
        <StatusBadge status={reg.status}/>
      </div>

      <div className="space-y-1 text-sm text-ink-700 mb-3">
        <div className="flex items-center gap-2"><User size={12} className="text-ink-400 shrink-0"/>{reg.owner_full_name}</div>
        <div className="flex items-center gap-2"><Phone size={12} className="text-ink-400 shrink-0"/>{reg.owner_phone}</div>
        <div className="flex items-center gap-2"><MapPin size={12} className="text-ink-400 shrink-0"/>{reg.city}, {reg.state}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Hash size={12} className="text-ink-400 shrink-0"/>{reg.total_rooms} rooms
          {reg.selected_plan && <span className="badge bg-gold/10 text-gold-800 text-2xs uppercase font-bold">{reg.selected_plan}</span>}
          {reg.quoted_price_inr && <span className="text-2xs text-ink-500">₹{Math.round(reg.quoted_price_inr).toLocaleString("en-IN")}/{reg.billing_cycle==="annual"?"yr":"mo"}</span>}
        </div>
      </div>

      <div className={`flex items-center gap-2 p-2 rounded-lg mb-3 text-xs font-semibold
        ${pCfg.color==="green"?"bg-green-50 text-green-800":pCfg.color==="red"?"bg-red-50 text-red-800":
          pCfg.color==="purple"?"bg-purple-50 text-purple-800":pCfg.color==="blue"?"bg-blue-50 text-blue-800":
          "bg-amber-50 text-amber-800"}`}>
        <pCfg.icon size={13}/>{pCfg.label}
        {reg.payment_method && <span className="ml-1 text-2xs font-normal opacity-70">via {reg.payment_method}</span>}
        {reg.payment_ref && <span className="ml-auto font-mono text-2xs opacity-60 truncate max-w-24">{reg.payment_ref}</span>}
      </div>

      {isPending && payProblem && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
          <Bell size={12} className="shrink-0"/>
          {reg.follow_up_count>0?`${reg.follow_up_count} follow-up${reg.follow_up_count>1?"s":""} done`:"Needs payment follow-up"}
          {reg.assigned_to && <span className="ml-auto">→ {reg.assigned_to}</span>}
        </div>
      )}
      {reg.status==="approved" && <div className="text-xs text-green-700 bg-green-50 rounded-lg p-2 mb-3">✓ Lodge #{reg.created_lodge_id} active</div>}
      {reg.status==="rejected" && reg.rejection_reason && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 mb-3 line-clamp-2">{reg.rejection_reason}</div>
      )}

      <div className="flex gap-2 pt-3 border-t border-ink-100">
        <button onClick={onView} className="btn-ghost flex-1 flex items-center justify-center gap-1.5 text-xs">
          <Eye size={13}/> Details
        </button>
        {isPending && <>
          <button onClick={onReject} className="btn-outline border-red-200 text-red-600 hover:bg-red-50 flex-1 flex items-center justify-center gap-1.5 text-xs">
            <XCircle size={13}/> Reject
          </button>
          <button onClick={onApprove} disabled={busy} className="btn-gold flex-1 flex items-center justify-center gap-1.5 text-xs">
            {busy?<Loader2 size={13} className="animate-spin"/>:<CheckCircle2 size={13}/>} Approve
          </button>
        </>}
      </div>
    </div>
  );
}

// ── RegDrawer ────────────────────────────────────────────────────────

function RegDrawer({reg, busy, onClose, onApprove, onReject, onPaymentUpdate, onResend}) {
  const [payForm, setPayForm] = useState({
    payment_status: reg.payment_status||"pending",
    payment_method: reg.payment_method||"",
    payment_ref:    reg.payment_ref||"",
    payment_amount: reg.payment_amount||reg.quoted_price_inr||"",
    payment_date:   reg.payment_date?reg.payment_date.slice(0,10):new Date().toISOString().slice(0,10),
    payment_notes:  "",
    follow_up_at:   "",
    assigned_to:    reg.assigned_to||"",
  });
  const [savingPay, setSavingPay] = useState(false);
  const [resending, setResending] = useState(false);
  const [section, setSection] = useState("details");
  const isPending = reg.status==="pending";

  const savePayment = async () => {
    setSavingPay(true);
    try {
      await onPaymentUpdate({
        ...payForm,
        payment_amount: payForm.payment_amount ? parseFloat(payForm.payment_amount) : undefined,
        payment_date: payForm.payment_date||undefined,
        follow_up_at: payForm.follow_up_at||undefined,
      });
      toast.success("Payment details saved");
      setPayForm(f=>({...f,payment_notes:"",follow_up_at:""}));
    } catch(e) { toast.error(e.response?.data?.detail||"Save failed"); }
    finally { setSavingPay(false); }
  };

  const handleResend = async () => {
    if (!window.confirm("Generate new password and re-send credentials?")) return;
    setResending(true);
    try { await onResend(); }
    catch(e) { toast.error(e.response?.data?.detail||"Resend failed"); }
    finally { setResending(false); }
  };

  const SECTIONS = [
    {key:"details", label:"Application", icon:FileText},
    {key:"payment", label:"Payment",     icon:CreditCard},
    {key:"notes",   label:"Call Notes",  icon:PhoneCall},
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-3xl max-h-[92vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-ink-100 flex items-start justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <code className="text-xs font-mono text-gold font-bold">REG-{String(reg.request_id).padStart(6,"0")}</code>
              {reg.property_category && <span className="text-2xs px-2 py-0.5 bg-navy/10 text-navy rounded-full font-semibold">{PROPERTY_TYPE_LABELS[reg.property_category]||reg.property_category}</span>}
              <StatusBadge status={reg.status}/>
            </div>
            <h2 className="font-display text-xl font-bold text-navy">{reg.lodge_name}</h2>
            <p className="text-xs text-ink-500 font-mono">/{reg.proposed_code}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-ink-100 rounded-lg text-ink-400"><X size={18}/></button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b border-ink-100 shrink-0">
          {SECTIONS.map(s=>(
            <button key={s.key} onClick={()=>setSection(s.key)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px
                      ${section===s.key?"border-gold text-navy":"border-transparent text-ink-500 hover:text-navy"}`}>
              <s.icon size={13}/>{s.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {section==="details" && (
            <>
              <DGroup title="Owner Contact">
                <DRow icon={<User size={14}/>} label="Name" value={reg.owner_full_name}/>
                <DRow icon={<Phone size={14}/>} label="Phone" value={<a href={`tel:${reg.owner_phone}`} className="text-blue-600 hover:underline">{reg.owner_phone}</a>}/>
                <DRow icon={<Mail size={14}/>} label="Email" value={<a href={`mailto:${reg.owner_email}`} className="text-blue-600 hover:underline">{reg.owner_email}</a>}/>
              </DGroup>
              <DGroup title="Property">
                <DRow icon={<MapPin size={14}/>} label="Address" value={`${reg.address_line1}${reg.address_line2?", "+reg.address_line2:""}, ${reg.city}, ${reg.state} ${reg.pincode}`}/>
                <DRow icon={<Hash size={14}/>} label="Rooms" value={reg.total_rooms}/>
                {(reg.rooms_ac>0||reg.rooms_non_ac>0||reg.rooms_deluxe>0||reg.rooms_suite>0)&&(
                  <DRow icon={null} label="Breakdown" value={
                    <span className="flex flex-wrap gap-1">
                      {reg.rooms_deluxe>0&&<span className="badge bg-gold/10 text-gold-800 text-2xs">Deluxe×{reg.rooms_deluxe}</span>}
                      {reg.rooms_ac>0&&<span className="badge bg-blue-100 text-blue-800 text-2xs">AC×{reg.rooms_ac}</span>}
                      {reg.rooms_non_ac>0&&<span className="badge bg-ink-100 text-ink-700 text-2xs">NonAC×{reg.rooms_non_ac}</span>}
                      {reg.rooms_suite>0&&<span className="badge bg-purple-100 text-purple-800 text-2xs">Suite×{reg.rooms_suite}</span>}
                    </span>
                  }/>
                )}
                {reg.gstin&&<DRow icon={null} label="GSTIN" value={<code className="font-mono text-xs">{reg.gstin}</code>}/>}
                {reg.pan&&<DRow icon={null} label="PAN" value={<code className="font-mono text-xs">{reg.pan}</code>}/>}
              </DGroup>
              {reg.selected_plan&&(
                <DGroup title="Plan">
                  <DRow icon={null} label="Plan" value={<span className="capitalize font-bold text-gold-700">{reg.selected_plan}</span>}/>
                  <DRow icon={null} label="Billing" value={<span className="capitalize">{reg.billing_cycle||"monthly"}</span>}/>
                  {reg.quoted_price_inr&&<DRow icon={null} label="Quoted" value={<span className="font-bold text-navy">₹{Math.round(reg.quoted_price_inr).toLocaleString("en-IN")}/{reg.billing_cycle==="annual"?"yr":"mo"}</span>}/>}
                </DGroup>
              )}
              {reg.enabled_modules&&(()=>{try{const m=JSON.parse(reg.enabled_modules);return(<DGroup title="Modules"><div className="flex flex-wrap gap-1">{m.map(x=><span key={x} className="badge bg-navy/10 text-navy text-2xs">{x.replace(/_/g," ")}</span>)}</div></DGroup>);}catch{return null;}})()}
              {reg.notes&&<DGroup title="Applicant Notes"><p className="text-ink-700 italic text-sm">{reg.notes}</p></DGroup>}
              {reg.status==="approved"&&(
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-green-800 flex items-center gap-2"><CheckCircle2 size={16}/> Lodge #{reg.created_lodge_id} is active</p>
                  <button onClick={handleResend} disabled={resending} className="mt-2 text-xs text-green-700 hover:underline flex items-center gap-1">
                    {resending?<Loader2 size={11} className="animate-spin"/>:<RotateCcw size={11}/>} Re-generate password & resend
                  </button>
                </div>
              )}
            </>
          )}

          {section==="payment"&&(
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-navy mb-3">Payment Status</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(PAYMENT_STATUS_CFG).map(([key,cfg])=>(
                    <label key={key} className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all
                      ${payForm.payment_status===key?"border-gold bg-gold/5 font-semibold":"border-ink-200 hover:border-ink-300"}`}>
                      <input type="radio" name="ps" value={key} checked={payForm.payment_status===key}
                             onChange={()=>setPayForm(f=>({...f,payment_status:key}))} className="w-3.5 h-3.5 accent-navy"/>
                      <cfg.icon size={13} className={cfg.color==="green"?"text-green-600":cfg.color==="red"?"text-red-600":cfg.color==="purple"?"text-purple-600":cfg.color==="blue"?"text-blue-600":"text-amber-600"}/>
                      <span className="text-xs">{cfg.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1">Payment Method</label>
                  <select value={payForm.payment_method} onChange={e=>setPayForm(f=>({...f,payment_method:e.target.value}))} className="input-field text-sm">
                    <option value="">— Select —</option>
                    <option value="upi">UPI (any app)</option>
                    <option value="phonepe">PhonePe</option>
                    <option value="googlepay">Google Pay</option>
                    <option value="paytm">Paytm</option>
                    <option value="razorpay">Razorpay</option>
                    <option value="neft_rtgs">NEFT / RTGS</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                    <option value="offline">Offline (other)</option>
                    <option value="waived">Waived</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1">Transaction / UTR Ref</label>
                  <input value={payForm.payment_ref} onChange={e=>setPayForm(f=>({...f,payment_ref:e.target.value}))} placeholder="UTR123456…" className="input-field text-sm font-mono"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1">Amount Paid (₹)</label>
                  <input type="number" value={payForm.payment_amount} onChange={e=>setPayForm(f=>({...f,payment_amount:e.target.value}))} placeholder={reg.quoted_price_inr||""} className="input-field text-sm"/>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-600 mb-1">Payment Date</label>
                  <input type="date" value={payForm.payment_date} onChange={e=>setPayForm(f=>({...f,payment_date:e.target.value}))} className="input-field text-sm"/>
                </div>
              </div>
              <div className="border-t border-ink-100 pt-4">
                <h4 className="text-xs font-bold text-ink-600 mb-3 uppercase tracking-widest">Follow-up Scheduling</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-ink-600 mb-1">Next Follow-up Date/Time</label>
                    <input type="datetime-local" value={payForm.follow_up_at} onChange={e=>setPayForm(f=>({...f,follow_up_at:e.target.value}))} className="input-field text-sm"/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-ink-600 mb-1">Assigned To</label>
                    <input value={payForm.assigned_to} onChange={e=>setPayForm(f=>({...f,assigned_to:e.target.value}))} placeholder="RUSTO team member name" className="input-field text-sm"/>
                  </div>
                </div>
                {reg.follow_up_count>0&&<p className="text-xs text-amber-700 mt-2 flex items-center gap-1"><PhoneCall size={11}/>{reg.follow_up_count} follow-up{reg.follow_up_count!==1?"s":""} recorded</p>}
              </div>
              {reg.payment_notes&&(
                <div className="bg-ink-50 rounded-xl p-3 text-xs text-ink-600 whitespace-pre-line border border-ink-200">
                  <p className="text-2xs uppercase tracking-widest font-bold text-ink-500 mb-1">Previous Notes</p>
                  {reg.payment_notes}
                </div>
              )}
              <button onClick={savePayment} disabled={savingPay} className="btn-primary w-full flex items-center justify-center gap-2">
                {savingPay?<Loader2 size={15} className="animate-spin"/>:<Check size={15}/>}
                {savingPay?"Saving…":"Save Payment Details"}
              </button>
            </div>
          )}

          {section==="notes"&&(
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-navy mb-1">Add Call Note</h3>
                <p className="text-xs text-ink-500 mb-3">Notes are timestamped and saved to the registration.</p>
                <textarea rows={4} value={payForm.payment_notes} onChange={e=>setPayForm(f=>({...f,payment_notes:e.target.value}))}
                          placeholder="e.g. Called at 2pm. Owner confirmed UPI payment by 5pm. Rescheduled follow-up…" className="input-field text-sm"/>
                <button onClick={savePayment} disabled={savingPay||!payForm.payment_notes.trim()} className="mt-2 btn-primary flex items-center gap-1.5 text-sm">
                  {savingPay?<Loader2 size={14} className="animate-spin"/>:<Send size={14}/>} Save Note
                </button>
              </div>
              {reg.payment_notes&&(
                <div>
                  <p className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-2">Note History</p>
                  <div className="space-y-2">
                    {reg.payment_notes.split("\n").filter(Boolean).map((line,i)=>(
                      <div key={i} className="bg-ink-50 rounded-xl p-3 text-xs text-ink-700 border border-ink-100">{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          {isPending&&(
            <div className="flex gap-2">
              <button onClick={onReject} className="btn-outline border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5">
                <XCircle size={14}/> Reject
              </button>
              <button onClick={onApprove} disabled={busy} className="btn-gold flex items-center gap-1.5">
                {busy?<Loader2 size={14} className="animate-spin"/>:<CheckCircle2 size={14}/>} Approve Lodge
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CredentialsModal({data, onClose}) {
  const [showPwd, setShowPwd] = useState(false);
  const copy = t => { navigator.clipboard.writeText(t); toast.success("Copied"); };
  const copyAll = () => {
    const block = `Rusto — Lodge Admin Credentials\n\nLodge: ${data.lodge_code}\nUsername: ${data.admin_username}\nPassword: ${data.admin_password}\nLogin: ${window.location.origin}/login\n\nChange your password after first login.`;
    navigator.clipboard.writeText(block); toast.success("All details copied");
  };
  return (
    <div className="modal-backdrop">
      <div className="modal-box max-w-lg">
        <div className="p-6 text-center border-b border-ink-100">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center mb-4 shadow-gold animate-pop-in">
            <ShieldCheck size={32} className="text-white"/>
          </div>
          <h2 className="font-display text-2xl font-bold text-navy">Lodge Approved! 🎉</h2>
          <p className="text-sm text-ink-500 mt-1">{data.admin_password?"Save the password — it won't be shown again.":"Previously approved."}</p>
        </div>
        <div className="p-6 space-y-3">
          {data.admin_password ? (
            <>
              <CRow label="Username" value={data.admin_username} onCopy={()=>copy(data.admin_username)}/>
              <CRow label="Password (one-time)" value={data.admin_password} secret show={showPwd} onShow={()=>setShowPwd(s=>!s)} onCopy={()=>copy(data.admin_password)} mono/>
              <CRow label="Lodge Code" value={`${data.lodge_code}  (#${data.lodge_id})`} onCopy={()=>copy(data.lodge_code)}/>
              <CRow label="Login URL" value={`${window.location.origin}/login`} onCopy={()=>copy(`${window.location.origin}/login`)}/>
              <div className={`rounded-xl p-3 border flex items-start gap-2 text-xs ${data.email_sent?"bg-green-50 border-green-200 text-green-800":"bg-amber-50 border-amber-200 text-amber-800"}`}>
                {data.email_sent?<><CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5"/> Credentials emailed to <strong className="ml-1">{data.owner_email}</strong></>
                :<><AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5"/> Email failed — share with <strong className="ml-1">{data.owner_email}</strong> via WhatsApp or call.</>}
              </div>
              {data.subscription_id&&(
                <div className="bg-navy/5 border border-navy/10 rounded-xl p-3 text-xs">
                  <p className="font-semibold text-navy mb-1">✓ Billing subscription created</p>
                  <p className="text-ink-600">Trial started. Lodge owner completes payment from their Billing page.</p>
                  {data.subscription_short_url&&<a href={data.subscription_short_url} target="_blank" rel="noreferrer" className="text-navy hover:underline font-semibold mt-2 inline-flex items-center gap-1">Razorpay auth link <ExternalLink size={11}/></a>}
                </div>
              )}
              <button onClick={copyAll} className="btn-primary w-full flex items-center justify-center gap-2 mt-2">
                <Copy size={14}/> Copy all credentials
              </button>
            </>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex gap-3">
              <AlertCircle size={18} className="shrink-0 mt-0.5"/> Already approved earlier. Use "Resend Credentials" to generate a new password.
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-ink-100 flex justify-end">
          <button onClick={onClose} className="btn-primary">Done</button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({status}) {
  const cfg = {pending:{label:"Pending",cls:"bg-amber-100 text-amber-800 ring-amber-200"},approved:{label:"Approved",cls:"bg-green-100 text-green-800 ring-green-200"},rejected:{label:"Rejected",cls:"bg-red-100 text-red-800 ring-red-200"}}[status]||{label:status,cls:"bg-ink-100 text-ink-700 ring-ink-200"};
  return <span className={`badge ${cfg.cls} ring-1 ring-inset flex-shrink-0`}>{cfg.label}</span>;
}

function DGroup({title,children}) {
  return <div><div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">{title}</div><div className="space-y-2">{children}</div></div>;
}

function DRow({icon,label,value}) {
  return <div className="flex items-start gap-2 text-sm">{icon?<span className="text-ink-400 mt-0.5">{icon}</span>:<span className="w-3.5"/>}<div className="flex-1 flex justify-between gap-3 min-w-0"><span className="text-ink-500 text-xs shrink-0">{label}</span><span className="text-navy font-medium text-right min-w-0">{value}</span></div></div>;
}

function CRow({label,value,mono,secret,show,onShow,onCopy}) {
  return (
    <div className="flex items-center gap-2 bg-ink-50 rounded-xl p-3 border border-ink-200">
      <div className="flex-1 min-w-0">
        <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</div>
        <div className={`text-navy font-semibold truncate mt-0.5 ${mono?"font-mono text-sm":""}`}>{secret&&!show?"••••••••••••":value}</div>
      </div>
      {secret&&<button onClick={onShow} className="text-ink-400 hover:text-ink-700 text-xs">{show?"Hide":"Show"}</button>}
      <button onClick={onCopy} className="btn-icon" title="Copy"><Copy size={14}/></button>
    </div>
  );
}
