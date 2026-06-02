import React, { useState, useEffect } from "react";
import { ClipboardCheck, CheckCircle2, XCircle, Eye, Copy,
         Mail, Phone, MapPin, Hash, AlertCircle, Building2,
         User, ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "react-toastify";
import { registrationsAPI } from "../services/api";

/**
 * Super-admin: lodge registration queue.
 *
 * Three tabs by status (pending / approved / rejected). Pending requests
 * have prominent Approve + Reject buttons; approved show the new lodge
 * link; rejected show the reason.
 *
 * Approval flow renders a credentials modal with the auto-generated
 * password — shown ONCE — that the super-admin copies and shares
 * out-of-band with the new lodge owner.
 */
const STATUS_TABS = [
  { key: "pending", label: "Pending Review", color: "amber" },
  { key: "approved", label: "Approved", color: "green" },
  { key: "rejected", label: "Rejected", color: "red" },
];

export default function Registrations() {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);        // detail view
  const [approvalResult, setApprovalResult] = useState(null); // credentials modal
  const [rejecting, setRejecting] = useState(null);      // ID being rejected
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [listR, statsR] = await Promise.all([
        registrationsAPI.list({ status: tab }),
        registrationsAPI.stats(),
      ]);
      setRows(listR.data || []);
      setStats(statsR.data || {});
    } catch (e) {
      toast.error("Failed to load registrations");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tab]);

  const approve = async (id) => {
    if (!window.confirm(`Approve registration #REG-${String(id).padStart(6, "0")}? This creates the lodge and an admin user.`)) return;
    setBusy(true);
    try {
      const r = await registrationsAPI.approve(id);
      setApprovalResult(r.data);
      toast.success("Lodge created. Capture the credentials below.");
      refresh();
      setSelected(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (rejectReason.trim().length < 3) {
      toast.error("Please provide a reason"); return;
    }
    setBusy(true);
    try {
      await registrationsAPI.reject(rejecting, rejectReason.trim());
      toast.success("Registration rejected");
      setRejecting(null); setRejectReason("");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rejection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <ClipboardCheck size={22} className="text-gold"/> Lodge Registrations
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Review new lodge applications. Approving creates the lodge + admin user automatically.
          </p>
        </div>
        <button onClick={refresh} className="btn-icon" title="Refresh">
          <RefreshCw size={16}/>
        </button>
      </div>

      {/* Status tabs with counts */}
      <div className="flex gap-1 border-b border-ink-200">
        {STATUS_TABS.map(t => {
          const count = stats[t.key] || 0;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className={`px-4 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2 ${
                      active ? "border-b-2 border-gold text-navy" : "border-b-2 border-transparent text-ink-500 hover:text-navy"
                    }`}>
              {t.label}
              {count > 0 && (
                <span className={`text-2xs px-2 py-0.5 rounded-full font-bold ${
                  t.color === "amber" ? "bg-amber-100 text-amber-800" :
                  t.color === "green" ? "bg-green-100 text-green-800" :
                  "bg-red-100 text-red-800"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-ink-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-12 text-center">
          <Building2 size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">No {tab} registrations.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((r, i) => (
            <RegistrationCard key={r.request_id} reg={r}
                               style={{ animationDelay: `${i * 40}ms` }}
                               onView={() => setSelected(r)}
                               onApprove={() => approve(r.request_id)}
                               onReject={() => { setRejecting(r.request_id); setRejectReason(""); }}/>
          ))}
        </div>
      )}

      {/* Detail panel modal */}
      {selected && (
        <RegistrationDetailModal reg={selected} onClose={() => setSelected(null)}
                                  onApprove={() => approve(selected.request_id)}
                                  onReject={() => { setRejecting(selected.request_id); setRejectReason(""); setSelected(null); }}/>
      )}

      {/* Reject modal */}
      {rejecting && (
        <div className="modal-backdrop">
          <div className="modal-box max-w-md">
            <div className="p-5 border-b border-ink-100">
              <h2 className="font-display text-lg font-bold text-navy">Reject Registration</h2>
              <p className="text-sm text-ink-500 mt-1">Provide a reason for the rejection.</p>
            </div>
            <div className="p-5">
              <textarea rows={5} value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="e.g. Insufficient documentation — please re-submit with PAN..."
                        className="input-field"/>
            </div>
            <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
              <button onClick={() => setRejecting(null)} className="btn-ghost">Cancel</button>
              <button onClick={reject} disabled={busy} className="btn-danger">
                {busy ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials reveal modal */}
      {approvalResult && (
        <CredentialsModal data={approvalResult} onClose={() => setApprovalResult(null)}/>
      )}
    </div>
  );
}


// ── Sub-components ────────────────────────────────────────────────

function RegistrationCard({ reg, style, onView, onApprove, onReject }) {
  const isPending = reg.status === "pending";
  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-5 hover:shadow-lifted transition-shadow animate-slide-up" style={style}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-1">
            REG-{String(reg.request_id).padStart(6, "0")}
          </div>
          <h3 className="font-display text-lg font-bold text-navy truncate">{reg.lodge_name}</h3>
          <p className="text-xs text-ink-500 font-mono mt-0.5">{reg.proposed_code}</p>
        </div>
        <StatusBadge status={reg.status}/>
      </div>
      <div className="space-y-1.5 text-sm text-ink-700 mb-4">
        <div className="flex items-center gap-2"><User size={13} className="text-ink-400"/> {reg.owner_full_name}</div>
        <div className="flex items-center gap-2"><Phone size={13} className="text-ink-400"/> {reg.owner_phone}</div>
        <div className="flex items-center gap-2 truncate"><Mail size={13} className="text-ink-400"/> {reg.owner_email}</div>
        <div className="flex items-center gap-2"><MapPin size={13} className="text-ink-400"/> {reg.city}, {reg.state}</div>
        <div className="flex items-center gap-2"><Hash size={13} className="text-ink-400"/> {reg.total_rooms} rooms</div>
        {/* v7.1 — show plan + locked-in quote so super-admin sees pricing context inline */}
        {reg.selected_plan && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge bg-gold-100 text-gold-800 text-2xs uppercase tracking-eyebrow font-bold">
              {reg.selected_plan}
            </span>
            {reg.quoted_price_inr && (
              <span className="text-xs text-ink-600">
                <span className="font-bold text-navy">₹{Math.round(reg.quoted_price_inr).toLocaleString("en-IN")}</span>
                <span className="text-ink-500">/{reg.billing_cycle === "annual" ? "year" : "month"}</span>
              </span>
            )}
          </div>
        )}
      </div>
      {reg.status === "rejected" && reg.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 mb-3">
          <strong>Rejection reason:</strong> {reg.rejection_reason}
        </div>
      )}
      {reg.status === "approved" && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 mb-3">
          ✓ Lodge created · ID #{reg.created_lodge_id}
        </div>
      )}
      <div className="flex gap-2 pt-3 border-t border-ink-100">
        <button onClick={onView} className="btn-ghost flex-1 flex items-center justify-center gap-1.5">
          <Eye size={14}/> View
        </button>
        {isPending && (
          <>
            <button onClick={onReject} className="btn-outline border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-500 flex-1 flex items-center justify-center gap-1.5">
              <XCircle size={14}/> Reject
            </button>
            <button onClick={onApprove} className="btn-gold flex-1 flex items-center justify-center gap-1.5">
              <CheckCircle2 size={14}/> Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 ring-amber-200" },
    approved: { label: "Approved", cls: "bg-green-100 text-green-800 ring-green-200" },
    rejected: { label: "Rejected", cls: "bg-red-100 text-red-800 ring-red-200" },
  }[status] || { label: status, cls: "bg-ink-100 text-ink-700 ring-ink-200" };
  return (
    <span className={`badge ${cfg.cls} ring-1 ring-inset flex-shrink-0`}>
      {cfg.label}
    </span>
  );
}

function RegistrationDetailModal({ reg, onClose, onApprove, onReject }) {
  const isPending = reg.status === "pending";
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-ink-100 flex justify-between items-start">
          <div>
            <div className="text-2xs uppercase tracking-eyebrow font-bold text-gold">
              REG-{String(reg.request_id).padStart(6, "0")}
            </div>
            <h2 className="font-display text-xl font-bold text-navy">{reg.lodge_name}</h2>
            <p className="text-xs text-ink-500 font-mono mt-0.5">Code: {reg.proposed_code}</p>
          </div>
          <StatusBadge status={reg.status}/>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <DetailGroup title="Owner contact">
            <DetailRow icon={<User size={14}/>} label="Name" value={reg.owner_full_name}/>
            <DetailRow icon={<Phone size={14}/>} label="Phone" value={reg.owner_phone}/>
            <DetailRow icon={<Mail size={14}/>} label="Email" value={reg.owner_email}/>
          </DetailGroup>
          <DetailGroup title="Address">
            <DetailRow icon={<MapPin size={14}/>} label="Street" value={reg.address_line1}/>
            {reg.address_line2 && <DetailRow icon={null} label="Line 2" value={reg.address_line2}/>}
            <DetailRow icon={null} label="City / State / Pin" value={`${reg.city} · ${reg.state} · ${reg.pincode}`}/>
          </DetailGroup>
          <DetailGroup title="Property">
            <DetailRow icon={<Hash size={14}/>} label="Total rooms" value={reg.total_rooms}/>
            {/* v7.1 — room-type breakdown from the wizard. Show non-zero only. */}
            {(reg.rooms_ac > 0 || reg.rooms_non_ac > 0 || reg.rooms_deluxe > 0 || reg.rooms_suite > 0) && (
              <DetailRow icon={null} label="Breakdown"
                          value={
                            <span className="flex flex-wrap gap-1.5">
                              {reg.rooms_ac > 0 && <span className="badge bg-blue-100 text-blue-800 text-2xs">AC × {reg.rooms_ac}</span>}
                              {reg.rooms_non_ac > 0 && <span className="badge bg-ink-200 text-ink-700 text-2xs">Non-AC × {reg.rooms_non_ac}</span>}
                              {reg.rooms_deluxe > 0 && <span className="badge bg-gold-100 text-gold-800 text-2xs">Deluxe × {reg.rooms_deluxe}</span>}
                              {reg.rooms_suite > 0 && <span className="badge bg-purple-100 text-purple-800 text-2xs">Suite × {reg.rooms_suite}</span>}
                            </span>
                          }/>
            )}
            {reg.gstin && <DetailRow icon={null} label="GSTIN" value={<code className="font-mono">{reg.gstin}</code>}/>}
            {reg.pan && <DetailRow icon={null} label="PAN" value={<code className="font-mono">{reg.pan}</code>}/>}
          </DetailGroup>
          {/* v7.1 — plan selection from the wizard. Shows the locked-in quote. */}
          {reg.selected_plan && (
            <DetailGroup title="Plan selection">
              <DetailRow icon={null} label="Plan" value={
                <span className="capitalize font-semibold text-gold-700">{reg.selected_plan}</span>
              }/>
              <DetailRow icon={null} label="Billing cycle" value={
                <span className="capitalize">{reg.billing_cycle || "monthly"}</span>
              }/>
              {reg.quoted_price_inr && (
                <DetailRow icon={null} label="Quoted price" value={
                  <span className="font-display font-bold text-navy">
                    ₹{Math.round(reg.quoted_price_inr).toLocaleString("en-IN")}
                    <span className="text-2xs text-ink-500 ml-1">
                      /{reg.billing_cycle === "annual" ? "year" : "month"}
                    </span>
                  </span>
                }/>
              )}
            </DetailGroup>
          )}
          {reg.notes && (
            <DetailGroup title="Applicant notes">
              <p className="text-ink-700 italic">{reg.notes}</p>
            </DetailGroup>
          )}
          {reg.reviewed_at && (
            <div className="border-t border-ink-100 pt-3 text-xs text-ink-500">
              Reviewed by <span className="font-mono">{reg.reviewed_by_username || `#${reg.reviewed_by}`}</span> on {new Date(reg.reviewed_at).toLocaleString("en-IN")}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Close</button>
          {isPending && (
            <>
              <button onClick={onReject} className="btn-outline border-red-300 text-red-600 hover:bg-red-50 hover:border-red-500 flex items-center gap-1.5">
                <XCircle size={14}/> Reject
              </button>
              <button onClick={onApprove} className="btn-gold flex items-center gap-1.5">
                <CheckCircle2 size={14}/> Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailGroup({ title, children }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="text-ink-400 mt-0.5">{icon}</span>}
      {!icon && <span className="w-3.5"/>}
      <div className="flex-1 min-w-0 flex justify-between gap-3">
        <span className="text-ink-500 text-xs">{label}</span>
        <span className="text-navy font-medium text-right">{value}</span>
      </div>
    </div>
  );
}

function CredentialsModal({ data, onClose }) {
  const copy = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };
  const copyAll = () => {
    const block = `Rusto — Your lodge admin credentials\n\nLodge: ${data.lodge_code}\nUsername: ${data.admin_username}\nPassword: ${data.admin_password}\n\nLogin at: ${window.location.origin}/login\n\nFor security, please change your password after first login.`;
    navigator.clipboard.writeText(block);
    toast.success("All details copied to clipboard");
  };
  return (
    <div className="modal-backdrop">
      <div className="modal-box max-w-lg">
        <div className="p-6 text-center border-b border-ink-100">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center mb-4 shadow-gold animate-pop-in">
            <ShieldCheck size={32} className="text-white"/>
          </div>
          <h2 className="font-display text-2xl font-bold text-navy">Lodge Approved</h2>
          <p className="text-sm text-ink-500 mt-1">
            Capture these credentials now — the password won't be shown again.
          </p>
        </div>
        <div className="p-6 space-y-3">
          {data.admin_password && (
            <>
              <CredentialRow label="Username" value={data.admin_username} onCopy={() => copy(data.admin_username)}/>
              <CredentialRow label="Password" value={data.admin_password} onCopy={() => copy(data.admin_password)} mono/>
              <CredentialRow label="Lodge ID" value={`#${data.lodge_id} (${data.lodge_code})`} onCopy={() => copy(data.lodge_code)}/>

              {/* v7.1 — email-sent status. Reassures super-admin the lodge will get the message. */}
              <div className={`rounded-lg p-3 border flex items-start gap-2 text-xs ${
                data.email_sent
                  ? "bg-green-50 border-green-200 text-green-800"
                  : "bg-amber-50 border-amber-200 text-amber-800"
              }`}>
                {data.email_sent
                  ? <CheckCircle2 size={14} className="text-green-600 flex-shrink-0 mt-0.5"/>
                  : <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5"/>}
                <div className="flex-1">
                  {data.email_sent
                    ? <>Credentials emailed to <strong>{data.owner_email}</strong></>
                    : <>Email delivery wasn't possible (SMTP not configured?). Share the password with <strong>{data.owner_email}</strong> manually via a secure channel.</>}
                </div>
              </div>

              {/* v8.0 — subscription status. Surface the Razorpay short_url if available. */}
              {data.subscription_id && (
                <div className="bg-gold-50 border border-gold/30 rounded-lg p-3 text-xs">
                  <p className="font-semibold text-gold-800 mb-1">Billing subscription ready</p>
                  <p className="text-ink-700 leading-relaxed">
                    Subscription #{data.subscription_id} is in trial. The lodge owner can complete
                    payment authorization from <span className="font-mono">/billing</span> after they log in.
                  </p>
                  {data.subscription_short_url && (
                    <a href={data.subscription_short_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-gold-800 hover:text-gold-900 font-semibold mt-2">
                      Open Razorpay auth link <ExternalLink size={11}/>
                    </a>
                  )}
                </div>
              )}

              <button onClick={copyAll} className="btn-primary w-full mt-3 flex items-center justify-center gap-2">
                <Copy size={14}/> Copy all (formatted)
              </button>
            </>
          )}
          {!data.admin_password && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 flex gap-3">
              <AlertCircle size={18} className="flex-shrink-0 mt-0.5"/>
              <div>
                This lodge was already approved earlier. The original password was shown at that time and cannot be retrieved. If lost, the admin should use the password-reset flow.
              </div>
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

function CredentialRow({ label, value, mono, onCopy }) {
  return (
    <div className="flex items-center gap-2 bg-ink-50 rounded-xl p-3 border border-ink-200">
      <div className="flex-1 min-w-0">
        <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</div>
        <div className={`text-navy font-semibold truncate ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
      <button onClick={onCopy} className="btn-icon" title="Copy">
        <Copy size={14}/>
      </button>
    </div>
  );
}
