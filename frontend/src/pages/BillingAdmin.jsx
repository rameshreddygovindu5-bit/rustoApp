import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  TrendingUp, Users, IndianRupee, Wallet, AlertCircle, Clock,
  CheckCircle2, XCircle, Loader2, RefreshCw, ExternalLink, Send,
  AlertTriangle, Sparkles, ArrowUpRight, ChevronRight
} from "lucide-react";
import { toast } from "react-toastify";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  Cell
} from "recharts";
import { billingAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Super-admin billing dashboard.
 *
 * Sections (top to bottom):
 *   1. Headline tiles — MRR, ARR, Active subs, Lifetime revenue
 *   2. Attention banners — trials expiring soon + past-due lodges
 *   3. Monthly revenue bar chart (last 6 months from paid invoices)
 *   4. Plan + billing-cycle breakdowns
 *   5. Manual actions — trigger renewal-reminder batch, view all subs
 *
 * Refresh button re-fetches everything; data is computed live server-side
 * so there's no cache to invalidate.
 */
export default function BillingAdmin() {
  const { isSuperAdmin } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [runningReminders, setRunningReminders] = useState(false);
  const [forceCancelTarget, setForceCancelTarget] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await billingAPI.adminMetrics();
      setMetrics(r.data);
    } catch (e) {
      toast.error("Failed to load metrics");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  if (!isSuperAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Super-admin access required</h2>
      <p className="text-ink-500 text-sm mt-2">This dashboard is cross-tenant.</p>
    </div>
  );

  if (loading || !metrics) return (
    <div className="text-center py-12 text-ink-400">
      <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
      <p className="text-sm">Crunching numbers…</p>
    </div>
  );

  const runReminders = async () => {
    setRunningReminders(true);
    try {
      const r = await billingAPI.runRenewalReminders(3);
      toast.success(
        `Renewal reminders: ${r.data.sent} sent, ${r.data.skipped} skipped (of ${r.data.checked} due)`
      );
    } catch (e) {
      toast.error("Reminder batch failed");
    } finally { setRunningReminders(false); }
  };

  const forceCancel = async (reason) => {
    if (!forceCancelTarget) return;
    try {
      await billingAPI.adminForceCancel(forceCancelTarget.subscription_id, { reason });
      toast.success(`Cancelled ${forceCancelTarget.lodge_name}`);
      setForceCancelTarget(null);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cancel failed");
    }
  };

  const h = metrics.headline;
  const a = metrics.attention;
  const c = metrics.cohort_this_month;

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <TrendingUp size={22} className="text-gold"/> Billing Dashboard
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            SaaS revenue, subscription health, and lodges needing attention — across all tenants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runReminders} disabled={runningReminders}
                  className="btn-outline text-sm flex items-center gap-1.5">
            {runningReminders ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
            Run renewal reminders
          </button>
          <button onClick={refresh} className="btn-icon" title="Refresh"><RefreshCw size={16}/></button>
        </div>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HeadlineTile label="MRR"
                       value={`₹${formatINR(h.mrr_inr)}`}
                       sub={`₹${formatINR(h.arr_inr)} ARR`}
                       Icon={TrendingUp} color="gold"/>
        <HeadlineTile label="Active subscriptions"
                       value={h.active_subscriptions}
                       sub={`across ${Object.values(metrics.breakdowns.by_status).reduce((a,b)=>a+b,0)} total`}
                       Icon={Users} color="navy"/>
        <HeadlineTile label="Lifetime revenue"
                       value={`₹${formatINR(h.lifetime_revenue_inr)}`}
                       sub="all paid invoices"
                       Icon={Wallet} color="green"/>
        <HeadlineTile label="This month"
                       value={`+${c.new_subscriptions} / -${c.cancellations}`}
                       sub="new / cancelled"
                       Icon={Sparkles}
                       color={c.cancellations > c.new_subscriptions ? "red" : "green"}/>
      </div>

      {/* Attention banners */}
      {(a.expiring_trials.length > 0 || a.past_due_subs.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {a.expiring_trials.length > 0 && (
            <AttentionPanel title="Trials expiring soon"
                             count={a.expiring_trials.length}
                             tone="amber" Icon={Clock}
                             subtitle="Conversion candidates — first charge happens automatically; reach out if you want a higher attach rate.">
              {a.expiring_trials.map(t => (
                <AttentionRow key={t.subscription_id} t={t} kind="trial"/>
              ))}
            </AttentionPanel>
          )}
          {a.past_due_subs.length > 0 && (
            <AttentionPanel title="Past-due lodges"
                             count={a.past_due_subs.length}
                             tone="red" Icon={AlertTriangle}
                             subtitle="Charges failed and Razorpay is retrying. May need manual outreach if it persists.">
              {a.past_due_subs.map(t => (
                <AttentionRow key={t.subscription_id} t={t} kind="past_due"
                                onForceCancel={() => setForceCancelTarget(t)}/>
              ))}
            </AttentionPanel>
          )}
        </div>
      )}

      {/* Revenue chart + breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 card">
          <h3 className="font-display font-bold text-navy flex items-center gap-2 mb-1">
            <IndianRupee size={16} className="text-gold"/> Monthly revenue
          </h3>
          <p className="text-xs text-ink-500 mb-4">
            Sum of paid invoices per month, last 6 months.
          </p>
          <RevenueChart series={metrics.monthly_revenue_series}/>
        </div>
        <div className="card">
          <h3 className="font-display font-bold text-navy mb-3">Subscription status</h3>
          <StatusBreakdown counts={metrics.breakdowns.by_status}/>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="card">
          <h3 className="font-display font-bold text-navy mb-3">MRR by plan</h3>
          <PlanBreakdown plans={metrics.breakdowns.by_plan} totalMrr={h.mrr_inr}/>
        </div>
        <div className="card">
          <h3 className="font-display font-bold text-navy mb-3">Billing cycle mix</h3>
          <CycleBreakdown cycles={metrics.breakdowns.by_cycle}/>
        </div>
      </div>

      {forceCancelTarget && (
        <ForceCancelModal target={forceCancelTarget}
                            onClose={() => setForceCancelTarget(null)}
                            onConfirm={forceCancel}/>
      )}
    </div>
  );
}


// ── Headline tiles ────────────────────────────────────────────────

function HeadlineTile({ label, value, sub, Icon, color }) {
  const palette = {
    gold:  { bg: "bg-gradient-to-br from-gold/10 to-gold/5 border-gold/30",
             icon: "text-gold-700", num: "text-navy" },
    navy:  { bg: "bg-gradient-to-br from-navy/10 to-navy/5 border-navy/30",
             icon: "text-navy", num: "text-navy" },
    green: { bg: "bg-gradient-to-br from-green-50 to-white border-green-200",
             icon: "text-green-700", num: "text-green-800" },
    red:   { bg: "bg-gradient-to-br from-red-50 to-white border-red-200",
             icon: "text-red-700", num: "text-red-800" },
  }[color] || { bg: "bg-white border-ink-200", icon: "text-ink-500", num: "text-navy" };
  return (
    <div className={`rounded-2xl border p-4 ${palette.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</span>
        {Icon && <Icon size={16} className={palette.icon}/>}
      </div>
      <div className={`font-display text-2xl md:text-3xl font-bold ${palette.num}`}>
        {value}
      </div>
      {sub && <p className="text-2xs text-ink-500 mt-1">{sub}</p>}
    </div>
  );
}


// ── Attention banners ─────────────────────────────────────────────

function AttentionPanel({ title, count, tone, Icon, subtitle, children }) {
  const palette = {
    amber: "bg-amber-50 border-amber-200",
    red:   "bg-red-50 border-red-200",
  }[tone];
  const iconColor = { amber: "text-amber-600", red: "text-red-600" }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${palette}`}>
      <div className="flex items-start gap-3 mb-3">
        <Icon size={18} className={`${iconColor} flex-shrink-0 mt-0.5`}/>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-navy">
            {title} <span className="text-sm font-semibold text-ink-500">({count})</span>
          </h3>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">{children}</div>
    </div>
  );
}

function AttentionRow({ t, kind, onForceCancel }) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-ink-200 p-2.5 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-navy truncate">{t.lodge_name}</div>
        <div className="text-2xs text-ink-500 flex items-center gap-2 flex-wrap">
          <code className="font-mono">{t.lodge_code}</code>
          <span>·</span>
          <span>{t.plan_name} {t.billing_cycle}</span>
          <span>·</span>
          <span>₹{Math.round(t.per_cycle_amount_inr).toLocaleString("en-IN")}</span>
          {kind === "trial" && t.trial_days_left !== null && (
            <>
              <span>·</span>
              <span className={`font-semibold ${t.trial_days_left <= 1 ? "text-red-600" : "text-amber-700"}`}>
                {t.trial_days_left === 0 ? "expires today"
                 : t.trial_days_left === 1 ? "1 day left"
                 : `${t.trial_days_left} days left`}
              </span>
            </>
          )}
          {kind === "past_due" && t.last_failure_reason && (
            <>
              <span>·</span>
              <span className="text-red-700 truncate">{t.last_failure_reason}</span>
            </>
          )}
        </div>
      </div>
      {kind === "past_due" && onForceCancel && (
        <button onClick={onForceCancel}
                className="text-2xs text-red-600 hover:text-red-700 font-semibold px-2 py-1 rounded hover:bg-red-50">
          Force cancel
        </button>
      )}
    </div>
  );
}


// ── Charts + breakdowns ───────────────────────────────────────────

function RevenueChart({ series }) {
  // Recharts wants {label, value} shape; we have {month, label, revenue_inr}
  const data = series.map(s => ({ name: s.label, revenue: s.revenue_inr }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EE" vertical={false}/>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#667085" }}
                  axisLine={{ stroke: "#E5E8EE" }} tickLine={false}/>
          <YAxis tick={{ fontSize: 11, fill: "#667085" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => v === 0 ? "0" : `₹${formatINRShort(v)}`}/>
          <Tooltip cursor={{ fill: "#C9A84C1A" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid #E5E8EE",
                                     fontSize: 12 }}
                    formatter={v => [`₹${formatINR(v)}`, "Revenue"]}/>
          <Bar dataKey="revenue" fill="#C9A84C" radius={[6, 6, 0, 0]} maxBarSize={48}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatusBreakdown({ counts }) {
  const order = [
    { key: "active",    label: "Active",    cls: "bg-green-500" },
    { key: "trialing",  label: "Trialing",  cls: "bg-amber-500" },
    { key: "past_due",  label: "Past due",  cls: "bg-red-500" },
    { key: "paused",    label: "Paused",    cls: "bg-ink-400" },
    { key: "cancelled", label: "Cancelled", cls: "bg-ink-300" },
  ];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-2.5">
      {order.map(s => {
        const n = counts[s.key] || 0;
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <div key={s.key}>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="text-ink-700">{s.label}</span>
              <span className="text-ink-500"><span className="text-navy font-semibold">{n}</span> · {pct}%</span>
            </div>
            <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
              <div className={`${s.cls} h-full transition-all`} style={{ width: `${pct}%` }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanBreakdown({ plans, totalMrr }) {
  if (!plans.length) return <p className="text-sm text-ink-400">No active subscriptions yet.</p>;
  const planColors = { starter: "#667085", growth: "#C9A84C", pro: "#1B2A4A" };
  return (
    <div className="space-y-3">
      {plans.map(p => {
        const pct = totalMrr > 0 ? Math.round((p.mrr_inr / totalMrr) * 100) : 0;
        return (
          <div key={p.plan_key}>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="font-semibold text-navy capitalize">{p.plan_key}</span>
              <span className="text-ink-600">
                <span className="text-navy font-semibold">{p.active_count}</span>
                {" subs · "}
                <span className="text-navy font-semibold">₹{formatINR(p.mrr_inr)}</span>
                {" MRR ("}
                {pct}%)
              </span>
            </div>
            <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
              <div className="h-full transition-all"
                    style={{ width: `${pct}%`,
                              backgroundColor: planColors[p.plan_key] || "#667085" }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CycleBreakdown({ cycles }) {
  const total = (cycles.monthly || 0) + (cycles.annual || 0);
  if (total === 0) return <p className="text-sm text-ink-400">No active subscriptions yet.</p>;
  const monthlyPct = Math.round(((cycles.monthly || 0) / total) * 100);
  const annualPct = 100 - monthlyPct;
  return (
    <>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        <div className="bg-navy" style={{ width: `${monthlyPct}%` }} title={`Monthly: ${monthlyPct}%`}/>
        <div className="bg-gold" style={{ width: `${annualPct}%` }} title={`Annual: ${annualPct}%`}/>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-navy"/>
            <span className="text-ink-700">Monthly</span>
          </div>
          <p className="font-display text-2xl font-bold text-navy mt-1">{cycles.monthly || 0}</p>
          <p className="text-2xs text-ink-500">{monthlyPct}% of active</p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-gold"/>
            <span className="text-ink-700">Annual</span>
          </div>
          <p className="font-display text-2xl font-bold text-navy mt-1">{cycles.annual || 0}</p>
          <p className="text-2xs text-ink-500">{annualPct}% of active</p>
        </div>
      </div>
      <p className="text-2xs text-ink-500 mt-3 leading-relaxed">
        Annual plans get 2 months free — higher upfront cash, lower churn risk.
      </p>
    </>
  );
}


// ── Force-cancel modal ────────────────────────────────────────────

function ForceCancelModal({ target, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-ink-100">
          <h3 className="font-display text-lg font-bold text-navy flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500"/>
            Force-cancel subscription
          </h3>
          <p className="text-xs text-ink-500 mt-1 leading-relaxed">
            This will cancel <strong className="text-navy">{target.lodge_name}</strong>'s{" "}
            {target.plan_name} subscription at Razorpay and locally. The lodge
            can continue using their account, but no further charges will be made.
            They can re-subscribe later by contacting support.
          </p>
        </div>
        <div className="p-5">
          <label className="block">
            <span className="label">Reason (required for audit)</span>
            <textarea value={reason} rows={3} maxLength={500}
                       onChange={e => setReason(e.target.value)}
                       placeholder="e.g. Fraudulent activity reported, billing error, chargeback…"
                       className="input-field"/>
          </label>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Don't cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={reason.trim().length < 3}
                  className="btn-outline border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Force-cancel
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Number formatters ─────────────────────────────────────────────

function formatINR(n) {
  // Full Indian grouping: 1,23,456 (last 3 then 2-2-2)
  if (n === null || n === undefined) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const s = String(Math.abs(rounded));
  if (s.length <= 3) return sign + s;
  const head = s.slice(0, -3);
  const tail = s.slice(-3);
  // Insert commas every 2 digits in head
  const groups = [];
  let h = head;
  while (h.length > 2) { groups.unshift(h.slice(-2)); h = h.slice(0, -2); }
  if (h) groups.unshift(h);
  return sign + groups.join(",") + "," + tail;
}

function formatINRShort(n) {
  // For chart axis labels: 1.2K, 5.4L (lakh), 1.2Cr (crore)
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e7)  return `${(n / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5)  return `${(n / 1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
