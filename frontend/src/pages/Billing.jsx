import React, { useState, useEffect } from "react";
import {
  CreditCard, Receipt, AlertCircle, CheckCircle2, Clock,
  XCircle, Download, RefreshCw, ExternalLink, Loader2, Pause,
  TrendingUp, FileText, Sparkles, Calendar, Wallet, Mail,
  ArrowUpDown, ArrowRight, ArrowLeft, X, TrendingDown, ArrowUp
} from "lucide-react";
import { toast } from "react-toastify";
import { billingAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Lodge admin billing page.
 *
 * Sections:
 *   1. Subscription summary card — plan, status pill, next charge / trial countdown
 *   2. Action buttons — "Pay now" (during trial), "Cancel subscription"
 *   3. Razorpay checkout link if the lodge hasn't completed auth yet
 *   4. Invoice history table — number, period, amount, status, PDF download
 *   5. Lifetime revenue summary tile
 */
export default function Billing() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [planChangeOpen, setPlanChangeOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [sub, inv] = await Promise.all([
        billingAPI.getSubscription(),
        billingAPI.listInvoices(),
      ]);
      setData(sub.data);
      setInvoices(inv.data);
    } catch (e) {
      toast.error("Failed to load billing info");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const onPayNow = async () => {
    setBusy(true);
    try {
      const r = await billingAPI.issueTrialInvoice();
      toast.success(`Invoice ${r.data.invoice_number} issued + paid`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not issue invoice");
    } finally { setBusy(false); }
  };

  const onCancel = async (opts) => {
    setBusy(true); setConfirmCancel(false);
    try {
      const r = await billingAPI.cancelSubscription({
        reason:        opts.reason || "",
        at_period_end: opts.at_period_end !== false,    // default true
        with_refund:   opts.with_refund === true,
      });
      if (r.data.refund) {
        toast.success(`Subscription cancelled. Refund ${r.data.refund.refund_number} (₹${Math.round(r.data.refund.total_refund_inr).toLocaleString("en-IN")}) processed — money in 5-7 business days.`);
      } else if (r.data.at_period_end) {
        toast.success(`Subscription set to cancel at end of period. You keep service until then.`);
      } else {
        toast.success("Subscription cancelled");
      }
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cancellation failed");
    } finally { setBusy(false); }
  };

  const onDownload = async (invoice) => {
    try {
      const r = await billingAPI.downloadInvoicePdf(invoice.invoice_id);
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${invoice.invoice_number}.pdf`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  // v8.2 — clear a queued plan change (lodge admin changed their mind)
  const onCancelPendingChange = async () => {
    try {
      await billingAPI.cancelPendingChange();
      toast.success("Scheduled change cancelled");
      refresh();
    } catch (e) {
      toast.error("Could not cancel scheduled change");
    }
  };

  // v8.0.1 — re-send invoice email (admin opens to verify, or to forward
  // to a new accounting email after the original bill_to was wrong).
  const onResendEmail = async (invoice) => {
    try {
      const r = await billingAPI.resendInvoiceEmail(invoice.invoice_id);
      if (r.data.sent) {
        toast.success(`Invoice emailed to ${r.data.bill_to_email || "the lodge"}`);
      } else {
        toast.error(r.data.message || "Email could not be sent");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Resend failed");
    }
  };

  if (!isAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Admin access required</h2>
    </div>
  );

  if (loading || !data) return (
    <div className="text-center py-12 text-ink-400">
      <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
      <p className="text-sm">Loading billing…</p>
    </div>
  );

  // No subscription found — rare (legacy lodges). Show CTA.
  if (!data.subscription) return <NoSubscriptionCard plans={data.available_plans || []}/>;

  const sub = data.subscription;

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <CreditCard size={22} className="text-gold"/> Billing
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Manage your Rusto subscription and view past invoices.
          </p>
        </div>
        <button onClick={refresh} className="btn-icon" title="Refresh"><RefreshCw size={16}/></button>
      </div>

      {/* Past-due alert */}
      {sub.status === "past_due" && (
        <div className="card bg-red-50 border-red-200">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="font-semibold text-red-900">Payment failed</p>
              <p className="text-xs text-red-800 mt-1 leading-relaxed">
                {sub.last_failure_reason || "Your most recent charge couldn't be collected."}
                {" "}Razorpay will retry automatically, or you can update your payment method below.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {sub.status === "cancelled" && (
        <div className="card bg-ink-100 border-ink-300">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="text-ink-600 flex-shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="font-semibold text-ink-800">Subscription cancelled</p>
              <p className="text-xs text-ink-600 mt-1 leading-relaxed">
                {sub.cancellation_reason || "This subscription is no longer active."}
                {" "}Contact support to reactivate.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* v8.3 — cancelling at period end banner (sub still active but scheduled to cancel) */}
      {sub.is_cancelling_at_period_end && sub.status !== "cancelled" && (
        <div className="card bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <Clock size={20} className="text-amber-600 flex-shrink-0 mt-0.5"/>
            <div className="flex-1">
              <p className="font-semibold text-amber-900">
                Cancellation scheduled for{" "}
                {sub.service_ends_at && new Date(sub.service_ends_at).toLocaleDateString("en-IN",
                  { day: "numeric", month: "long", year: "numeric" })}
              </p>
              <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
                You keep full access until then. After that, your subscription
                ends and no further charges will be made. Need to change your
                mind? Contact support before that date.
              </p>
            </div>
          </div>
        </div>
      )}

      <SubscriptionCard sub={sub} onPayNow={onPayNow}
                         onCancel={() => setConfirmCancel(true)}
                         onChangePlan={() => setPlanChangeOpen(true)}
                         busy={busy}/>

      {sub.pending_change && (
        <PendingChangeBanner pending={sub.pending_change}
                              currentPlan={sub.plan_name}
                              onCancel={onCancelPendingChange}/>
      )}

      <InvoicesSection invoices={invoices} onDownload={onDownload}
                         onResendEmail={onResendEmail}/>

      {confirmCancel && (
        <ConfirmCancelModal onClose={() => setConfirmCancel(false)}
                             onConfirm={onCancel}/>
      )}
      {planChangeOpen && (
        <PlanChangeModal sub={sub}
                          onClose={() => setPlanChangeOpen(false)}
                          onSaved={() => { setPlanChangeOpen(false); refresh(); }}/>
      )}
    </div>
  );
}


// ── Subscription summary card ─────────────────────────────────────

function SubscriptionCard({ sub, onPayNow, onCancel, onChangePlan, busy }) {
  const status = STATUS_META[sub.status] || STATUS_META.active;

  // Days until next charge.
  const daysLeft = sub.next_charge_date
    ? Math.max(0, Math.ceil((new Date(sub.next_charge_date) - new Date()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-card">
      {/* Header strip */}
      <div className="bg-gradient-to-br from-navy-dark to-navy text-white p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-1">
              Current plan
            </p>
            <h2 className="font-display text-3xl font-bold">{sub.plan_name}</h2>
            <p className="text-white/70 text-sm mt-1">
              {sub.billing_cycle === "annual" ? "Annual" : "Monthly"} billing ·{" "}
              {sub.total_rooms_at_signup} rooms at signup
            </p>
          </div>
          <span className={`badge ${status.cls} ring-1 ring-inset ring-white/20`}>
            <status.Icon size={11}/> {status.label}
          </span>
        </div>

        <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Stat label="Per cycle" value={`₹${Math.round(sub.per_cycle_amount_inr).toLocaleString("en-IN")}`}
                 sub={sub.billing_cycle === "annual" ? "/year" : "/month"}/>
          <Stat label={sub.status === "trialing" ? "Trial ends" : "Next charge"}
                 value={sub.next_charge_date
                          ? new Date(sub.next_charge_date).toLocaleDateString("en-IN",
                                { day: "numeric", month: "short", year: "numeric" })
                          : "—"}
                 sub={daysLeft !== null ? `in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}` : null}/>
          <Stat label="Billing period"
                 value={sub.current_period_start
                          ? `${new Date(sub.current_period_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                          : "—"}
                 sub={sub.current_period_end
                          ? `to ${new Date(sub.current_period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                          : null}/>
        </div>
      </div>

      {/* Action area */}
      <div className="p-5 md:p-6 bg-white">
        <div className="flex items-center gap-3 flex-wrap">
          {sub.status === "trialing" && (
            <button onClick={onPayNow} disabled={busy} className="btn-gold flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Wallet size={14}/>}
              Pay now to activate
            </button>
          )}
          {sub.status !== "cancelled" && (
            <button onClick={onChangePlan} disabled={busy}
                    className="btn-outline text-sm flex items-center gap-1.5">
              <ArrowUpDown size={13}/> Change plan
            </button>
          )}
          {sub.status !== "cancelled" && (
            <button onClick={onCancel} disabled={busy}
                    className="btn-outline text-sm border-red-300 text-red-600 hover:bg-red-50">
              Cancel subscription
            </button>
          )}
        </div>
        {sub.status === "trialing" && (
          <p className="text-xs text-ink-500 mt-3 leading-relaxed">
            You're in your free trial period. No charges will be made until{" "}
            <strong>{new Date(sub.trial_until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            Pay now to issue your first invoice and activate billing.
          </p>
        )}
        {!sub.is_provider_linked && (
          <p className="text-xs text-amber-700 mt-3 leading-relaxed">
            <AlertCircle size={11} className="inline mr-1"/>
            Payment provider not yet linked. Contact support if this persists.
          </p>
        )}
      </div>

      {/* v8.0.1 — Payment method section. Always shown when there's a
          provider link, regardless of subscription status (cancelled lodges
          might still want to view past auth). */}
      {sub.provider_short_url && sub.status !== "cancelled" && (
        <PaymentMethodBlock shortUrl={sub.provider_short_url}
                              status={sub.status}/>
      )}
    </div>
  );
}


// ── Payment method block ──────────────────────────────────────────

function PaymentMethodBlock({ shortUrl, status }) {
  // Different copy depending on whether the lodge has activated yet.
  const isPendingActivation = status === "trialing";
  return (
    <div className="border-t border-ink-100 px-5 md:px-6 py-5 bg-gradient-to-br from-ink-50 to-white">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-gold/15 flex items-center justify-center flex-shrink-0">
          <CreditCard size={20} className="text-gold-700"/>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-navy">Payment method</h3>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">
            {isPendingActivation
              ? <>Authorize your card or UPI on Razorpay's secure page to enable
                  auto-renewal. You can change the payment method anytime later.</>
              : <>Your subscription auto-renews via Razorpay. Visit your secure
                  payment page to update your card or UPI ID.</>
            }
          </p>
        </div>
        <a href={shortUrl} target="_blank" rel="noreferrer"
            className={`flex items-center gap-1.5 ${
              isPendingActivation ? "btn-gold" : "btn-outline text-sm"
            }`}>
          <ExternalLink size={13}/>
          {isPendingActivation ? "Authorize payment" : "Update payment method"}
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-white/60">{label}</p>
      <p className="font-display text-xl font-bold mt-0.5">{value}</p>
      {sub && <p className="text-2xs text-white/60 mt-0.5">{sub}</p>}
    </div>
  );
}

const STATUS_META = {
  trialing:  { label: "Trial",      cls: "bg-amber-100 text-amber-900",  Icon: Clock },
  active:    { label: "Active",     cls: "bg-green-100 text-green-900",  Icon: CheckCircle2 },
  past_due:  { label: "Past due",   cls: "bg-red-100 text-red-900",      Icon: AlertCircle },
  paused:    { label: "Paused",     cls: "bg-ink-200 text-ink-700",      Icon: Pause },
  cancelled: { label: "Cancelled",  cls: "bg-ink-200 text-ink-700",      Icon: XCircle },
};


// ── Invoices section ──────────────────────────────────────────────

function InvoicesSection({ invoices, onDownload, onResendEmail }) {
  if (!invoices) return null;
  const list = invoices.invoices || [];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryTile label="Lifetime billed"
                      value={`₹${Math.round(invoices.summary.lifetime_paid_inr).toLocaleString("en-IN")}`}
                      Icon={TrendingUp} color="green"/>
        <SummaryTile label="Total invoices" value={invoices.total}
                      Icon={FileText} color="ink"/>
        <SummaryTile label="Awaiting payment"
                      value={invoices.summary.open_invoice_count}
                      Icon={Clock}
                      color={invoices.summary.open_invoice_count > 0 ? "amber" : "ink"}/>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-ink-100 flex items-center justify-between">
          <h3 className="font-display font-bold text-navy flex items-center gap-2">
            <Receipt size={16} className="text-gold"/> Invoices
          </h3>
          {list.length > 0 && (
            <span className="text-xs text-ink-500">{list.length} of {invoices.total}</span>
          )}
        </div>
        {list.length === 0 ? (
          <div className="text-center py-12 text-ink-400">
            <Receipt size={32} className="mx-auto mb-2"/>
            <p className="text-sm">No invoices yet. Your first one appears after the trial ends.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50">
                  <Th>Invoice</Th>
                  <Th>Period</Th>
                  <Th>Issued</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.map(inv => (
                  <tr key={inv.invoice_id} className="border-b border-ink-100 hover:bg-ink-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-navy">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-ink-700 text-xs">
                      {new Date(inv.period_start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      {" – "}
                      {new Date(inv.period_end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-ink-700 text-xs">
                      {inv.issued_at && new Date(inv.issued_at).toLocaleDateString("en-IN",
                          { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-navy">
                      ₹{Math.round(inv.total_inr).toLocaleString("en-IN")}
                      <div className="text-2xs text-ink-400 font-normal">
                        incl. ₹{Math.round(inv.gst_amount_inr).toLocaleString("en-IN")} GST
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusPill status={inv.status}/>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {inv.has_pdf && (
                          <button onClick={() => onDownload(inv)}
                                   className="btn-icon" title="Download PDF">
                            <Download size={14}/>
                          </button>
                        )}
                        <button onClick={() => onResendEmail(inv)}
                                 className="btn-icon" title="Resend invoice email">
                          <Mail size={14}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Th({ children, align = "left" }) {
  return (
    <th className={`text-${align} text-2xs uppercase tracking-eyebrow font-bold text-ink-500 px-4 py-2.5`}>
      {children}
    </th>
  );
}

function InvoiceStatusPill({ status }) {
  const meta = {
    paid:   { label: "Paid",   cls: "bg-green-100 text-green-900", Icon: CheckCircle2 },
    open:   { label: "Open",   cls: "bg-amber-100 text-amber-900", Icon: Clock },
    failed: { label: "Failed", cls: "bg-red-100 text-red-900",     Icon: XCircle },
    void:   { label: "Void",   cls: "bg-ink-200 text-ink-700",     Icon: XCircle },
  }[status] || { label: status, cls: "bg-ink-100 text-ink-700", Icon: Clock };
  return (
    <span className={`badge ${meta.cls} text-2xs ring-1 ring-inset ring-current/20`}>
      <meta.Icon size={10}/> {meta.label}
    </span>
  );
}

function SummaryTile({ label, value, sub, Icon, color }) {
  const cls = {
    ink:   "bg-white border-ink-200",
    green: "bg-green-50 border-green-200",
    amber: "bg-amber-50 border-amber-200",
  }[color];
  const numCls = {
    ink:   "text-navy",
    green: "text-green-700",
    amber: "text-amber-700",
  }[color];
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</span>
        {Icon && <Icon size={14} className="text-gold"/>}
      </div>
      <div className={`font-display text-2xl font-bold ${numCls}`}>{value}</div>
      {sub && <p className="text-2xs text-ink-500 mt-0.5">{sub}</p>}
    </div>
  );
}


// ── Confirm cancel modal (v8.3 — refund support) ──────────────────

function ConfirmCancelModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [option, setOption] = useState("at_period_end");
  const [refundPreview, setRefundPreview] = useState(null);
  const [previewing, setPreviewing] = useState(true);

  // Auto-fetch refund eligibility so we can show or hide that option.
  useEffect(() => {
    let cancelled = false;
    billingAPI.refundPreview()
      .then(r => { if (!cancelled) { setRefundPreview(r.data); setPreviewing(false); } })
      .catch(() => { if (!cancelled) { setRefundPreview({ eligible: false }); setPreviewing(false); } });
    return () => { cancelled = true; };
  }, []);

  const submit = () => onConfirm({
    reason,
    at_period_end: option === "at_period_end",
    with_refund:   option === "immediate_refund",
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-ink-100">
          <h3 className="font-display text-lg font-bold text-navy flex items-center gap-2">
            <AlertCircle size={18} className="text-red-500"/>
            Cancel your subscription?
          </h3>
          <p className="text-xs text-ink-500 mt-1 leading-relaxed">
            We're sorry to see you go. Pick how you want to wrap up — your data
            stays intact either way and you can re-subscribe anytime.
          </p>
        </div>

        <div className="p-5 space-y-3">
          {/* Option 1: cancel at period end (default, recommended) */}
          <CancelOption value="at_period_end" selected={option === "at_period_end"}
                         onSelect={setOption}
                         title="Cancel at end of period"
                         badge="Recommended"
                         desc="You keep full access until your current period ends. No refund issued. No surprise charges after."/>

          {/* Option 2: immediate + refund (only if eligible) */}
          {previewing ? (
            <div className="text-xs text-ink-400 italic px-3 py-2">Checking refund eligibility…</div>
          ) : refundPreview?.eligible ? (
            <CancelOption value="immediate_refund" selected={option === "immediate_refund"}
                           onSelect={setOption}
                           title={`Cancel now + refund ₹${Math.round(refundPreview.refund_total_inr).toLocaleString("en-IN")}`}
                           desc={`Service ends today. We'll refund ${refundPreview.unused_days} unused day${refundPreview.unused_days === 1 ? "" : "s"} of your ${refundPreview.total_period_days}-day period to your original payment method.`}/>
          ) : null}

          {/* Option 3: immediate, no refund */}
          <CancelOption value="immediate" selected={option === "immediate"}
                         onSelect={setOption}
                         title="Cancel now without refund"
                         desc="Service ends today. No refund for the rest of the period."
                         danger/>

          <label className="block pt-2">
            <span className="label">Reason (optional, helps us improve)</span>
            <textarea value={reason} rows={3} maxLength={500}
                       onChange={e => setReason(e.target.value)}
                       placeholder="Tell us what went wrong, or just say switching, closing, etc."
                       className="input-field"/>
          </label>
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Keep my plan</button>
          <button onClick={submit} disabled={previewing}
                  className="btn-outline border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
            {option === "immediate_refund" ? "Cancel & refund"
              : option === "immediate" ? "Cancel now"
              : "Cancel at period end"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CancelOption({ value, selected, onSelect, title, badge, desc, danger }) {
  return (
    <button type="button" onClick={() => onSelect(value)}
            className={`w-full text-left border-2 rounded-xl p-3 transition-all ${
              selected
                ? danger ? "border-red-400 bg-red-50" : "border-gold bg-gold-50"
                : "border-ink-200 hover:border-ink-300"
            }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-navy flex items-center gap-2 flex-wrap">
            {title}
            {badge && (
              <span className="text-2xs uppercase tracking-eyebrow font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                {badge}
              </span>
            )}
          </p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{desc}</p>
        </div>
        <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 mt-1 transition-all ${
          selected
            ? (danger ? "border-red-400 bg-red-400" : "border-gold bg-gold")
            : "border-ink-300"
        }`}/>
      </div>
    </button>
  );
}


// ── No-subscription fallback ──────────────────────────────────────

function NoSubscriptionCard({ plans }) {
  return (
    <div className="card text-center py-12 max-w-2xl mx-auto">
      <Sparkles size={36} className="mx-auto text-gold mb-3"/>
      <h2 className="font-display text-xl font-bold text-navy">No subscription found</h2>
      <p className="text-ink-500 mt-2 text-sm max-w-md mx-auto">
        Your lodge doesn't have an active subscription yet. This usually means
        your account was created before billing was set up. Please contact support
        to get a subscription provisioned.
      </p>
    </div>
  );
}


// ── v8.2: Pending change banner ───────────────────────────────────

/**
 * Shown between the subscription card and the invoices when a plan
 * change has been queued for end-of-period. Gives the lodge a clear
 * "you changed your mind?" affordance.
 */
function PendingChangeBanner({ pending, currentPlan, onCancel }) {
  const effective = pending.takes_effect_at
    ? new Date(pending.takes_effect_at).toLocaleDateString("en-IN",
        { day: "numeric", month: "short", year: "numeric" })
    : "—";
  const daysAway = pending.takes_effect_at
    ? Math.max(0, Math.ceil((new Date(pending.takes_effect_at) - new Date()) / (1000 * 60 * 60 * 24)))
    : null;
  return (
    <div className="card bg-amber-50 border-amber-200">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Calendar size={16} className="text-amber-700"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-900">
            Plan change scheduled
          </p>
          <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
            Your subscription will switch from <strong>{currentPlan}</strong> to{" "}
            <strong>{pending.plan_name}</strong> ({pending.billing_cycle})
            {pending.total_rooms ? ` for ${pending.total_rooms} rooms` : ""}
            {" "}on <strong>{effective}</strong>
            {daysAway !== null && (
              <> — {daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : `in ${daysAway} days`}</>
            )}.
            Until then, you keep your current plan and pricing.
          </p>
        </div>
        <button onClick={onCancel}
                className="text-xs text-amber-900 hover:text-amber-700 font-semibold whitespace-nowrap px-2 py-1 rounded hover:bg-amber-100">
          Cancel scheduled change
        </button>
      </div>
    </div>
  );
}


// ── v8.2: Plan-change wizard modal ────────────────────────────────

/**
 * 3-step modal: pick plan + cycle + rooms → preview proration → confirm.
 *
 * Calls /preview-change as the user makes selections so they see the
 * proration calc before committing. The /change-plan call only fires
 * on the final confirm step.
 *
 * Mirrors the public onboarding wizard's visual language (gold/navy,
 * plan cards) but inside a modal — feels like a continuation of the
 * onboarding experience rather than a separate UI.
 */
function PlanChangeModal({ sub, onClose, onSaved }) {
  const [step, setStep] = useState(1);  // 1=pick, 2=review, 3=done
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [planKey, setPlanKey] = useState(sub.plan_key);
  const [cycle, setCycle] = useState(sub.billing_cycle);
  const [rooms, setRooms] = useState(sub.total_rooms_at_signup || 1);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Load plan catalog once
  useEffect(() => {
    billingAPI.publicPlans()
      .then(r => { setPlans(r.data.plans); setLoading(false); })
      .catch(() => { setLoading(false); toast.error("Could not load plans"); });
  }, []);

  // Auto-preview as the user changes selections (debounced via simple effect)
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    setPreviewing(true);
    billingAPI.previewPlanChange({
      new_plan_key: planKey,
      new_billing_cycle: cycle,
      new_total_rooms: rooms,
    }).then(r => {
      if (!cancelled) { setPreview(r.data); setPreviewing(false); }
    }).catch(e => {
      if (!cancelled) {
        toast.error(e.response?.data?.detail || "Preview failed");
        setPreviewing(false);
      }
    });
    return () => { cancelled = true; };
  }, [step, planKey, cycle, rooms]);

  const onConfirm = async () => {
    setSubmitting(true);
    try {
      const r = await billingAPI.changePlan({
        new_plan_key: planKey,
        new_billing_cycle: cycle,
        new_total_rooms: rooms,
      });
      setResult(r.data);
      setStep(3);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Plan change failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-display text-lg font-bold text-navy flex items-center gap-2">
              <ArrowUpDown size={16} className="text-gold"/>
              {step === 3 ? "Plan change submitted" : "Change your plan"}
            </h3>
            {step < 3 && (
              <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mt-0.5">
                Step {step} of 2 — {step === 1 ? "Pick a plan" : "Review the change"}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-icon"><X size={16}/></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-12"><Loader2 size={24} className="animate-spin mx-auto text-gold"/></div>
          ) : step === 1 ? (
            <PlanChangeStep1 sub={sub} plans={plans}
                              planKey={planKey} setPlanKey={setPlanKey}
                              cycle={cycle} setCycle={setCycle}
                              rooms={rooms} setRooms={setRooms}/>
          ) : step === 2 ? (
            <PlanChangeStep2 preview={preview} previewing={previewing}/>
          ) : (
            <PlanChangeStep3 result={result}/>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-ink-100 flex items-center justify-between gap-2 flex-shrink-0">
          {step === 1 && (
            <>
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={() => setStep(2)} className="btn-gold flex items-center gap-1.5">
                Review change <ArrowRight size={13}/>
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="btn-ghost flex items-center gap-1.5">
                <ArrowLeft size={13}/> Back
              </button>
              <button onClick={onConfirm} disabled={previewing || submitting || preview?.is_no_op}
                      className="btn-gold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                Confirm change
              </button>
            </>
          )}
          {step === 3 && (
            <button onClick={onSaved} className="btn-gold ml-auto">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanChangeStep1({ sub, plans, planKey, setPlanKey, cycle, setCycle, rooms, setRooms }) {
  return (
    <div className="space-y-5">
      {/* Cycle toggle */}
      <div>
        <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">Billing cycle</p>
        <div className="inline-flex bg-ink-100 rounded-full p-1">
          {["monthly", "annual"].map(opt => (
            <button key={opt} onClick={() => setCycle(opt)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                      cycle === opt ? "bg-navy text-white shadow-card" : "text-ink-600 hover:text-navy"
                    }`}>
              <span className="capitalize">{opt}</span>
              {opt === "annual" && (
                <span className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
                  cycle === opt ? "bg-gold text-navy-dark" : "bg-green-100 text-green-700"
                }`}>Save 17%</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Room count */}
      <div>
        <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">Total rooms</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setRooms(r => Math.max(1, r - 1))}
                  className="w-9 h-9 rounded-lg border border-ink-200 hover:border-gold hover:bg-gold-50 flex items-center justify-center font-bold text-lg">−</button>
          <input type="number" min="1" max="10000" value={rooms}
                 onChange={e => setRooms(Math.max(1, parseInt(e.target.value) || 1))}
                 className="w-20 text-center input-field font-display font-bold"/>
          <button onClick={() => setRooms(r => r + 1)}
                  className="w-9 h-9 rounded-lg border border-ink-200 hover:border-gold hover:bg-gold-50 flex items-center justify-center font-bold text-lg">+</button>
          <p className="text-xs text-ink-500 ml-2">Currently {sub.total_rooms_at_signup} rooms.</p>
        </div>
      </div>

      {/* Plan cards */}
      <div>
        <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">Choose plan</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {plans.map(p => {
            const isCurrent = sub.plan_key === p.key && sub.billing_cycle === cycle;
            const isSelected = planKey === p.key;
            const tooManyRooms = p.max_rooms !== null && rooms > p.max_rooms;
            return (
              <button key={p.key} type="button"
                      onClick={() => !tooManyRooms && setPlanKey(p.key)}
                      disabled={tooManyRooms}
                      className={`text-left border-2 rounded-xl p-3 transition-all relative ${
                        tooManyRooms ? "border-ink-200 bg-ink-50 opacity-50 cursor-not-allowed" :
                        isSelected ? "border-gold bg-gold-50 shadow-gold-glow" :
                                      "border-ink-200 hover:border-gold/50"
                      }`}>
                {isCurrent && (
                  <span className="absolute -top-2 right-3 bg-navy text-white text-2xs font-bold uppercase tracking-eyebrow px-1.5 py-0.5 rounded">
                    Current
                  </span>
                )}
                <h4 className="font-display font-bold text-navy">{p.name}</h4>
                <p className="text-2xs text-ink-500 mt-0.5 line-clamp-2">{p.tagline}</p>
                <p className="font-display text-lg font-bold text-navy mt-2">
                  ₹{p.base_monthly.toLocaleString("en-IN")}
                  <span className="text-2xs text-ink-500 font-normal ml-1">/mo base</span>
                </p>
                <p className="text-2xs text-ink-500">
                  Includes {p.included_rooms} rooms · ₹{p.per_room}/extra
                </p>
                {tooManyRooms && (
                  <p className="text-2xs text-red-600 mt-1 font-semibold">Cap is {p.max_rooms} rooms</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanChangeStep2({ preview, previewing }) {
  if (previewing || !preview) return (
    <div className="text-center py-12"><Loader2 size={24} className="animate-spin mx-auto text-gold"/>
      <p className="text-sm text-ink-500 mt-2">Calculating proration…</p>
    </div>
  );

  if (preview.is_no_op) return (
    <div className="text-center py-12">
      <AlertCircle size={32} className="mx-auto text-amber-500 mb-2"/>
      <p className="font-display font-bold text-navy">This is your current plan</p>
      <p className="text-sm text-ink-500 mt-1">Go back and pick something different to change.</p>
    </div>
  );

  // Pick the "kind" badge + colour based on the change type.
  const kind =
    preview.is_upgrade   ? { label: "Upgrade",      Icon: ArrowUp,        cls: "bg-green-100 text-green-800" } :
    preview.is_downgrade ? { label: "Downgrade",    Icon: TrendingDown,   cls: "bg-amber-100 text-amber-800" } :
    preview.is_cycle_change ? { label: "Cycle change", Icon: ArrowUpDown, cls: "bg-blue-100 text-blue-800" } :
                           { label: "Update",        Icon: ArrowUpDown,   cls: "bg-ink-200 text-ink-800" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center">
        <span className={`badge ${kind.cls} px-3 py-1.5 text-sm`}>
          <kind.Icon size={13}/> {kind.label}
        </span>
      </div>

      {/* Current → Next compare */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <PlanSummaryBlock label="Current" data={preview.current}/>
        <ArrowRight size={20} className="text-ink-400 mx-auto rotate-90 sm:rotate-0"/>
        <PlanSummaryBlock label="New" data={preview.next} highlight/>
      </div>

      {/* Charge / scheduled box */}
      {preview.change_takes_effect === "immediate" && preview.immediate_charge_inr > 0 ? (
        <div className="bg-gold-50 border-2 border-gold rounded-xl p-4">
          <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold-700 mb-1">
            Prorated charge today
          </p>
          <p className="font-display text-3xl font-bold text-navy">
            ₹{preview.immediate_charge_inr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            <span className="text-sm text-ink-500 font-normal ml-1">+ GST</span>
          </p>
        </div>
      ) : preview.change_takes_effect === "end_of_period" ? (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
          <p className="text-2xs uppercase tracking-eyebrow font-bold text-amber-700 mb-1">
            Scheduled for
          </p>
          <p className="font-display text-2xl font-bold text-amber-900">
            {new Date(preview.effective_at).toLocaleDateString("en-IN",
              { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      ) : (
        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4">
          <p className="font-display text-xl font-bold text-green-800">
            Free + instant
          </p>
          <p className="text-xs text-green-700 mt-1">No charge during your trial period.</p>
        </div>
      )}

      <p className="text-sm text-ink-700 leading-relaxed bg-ink-50 rounded-lg p-3">
        {preview.proration_explanation}
      </p>

      {preview.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
          {preview.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5"/>
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanSummaryBlock({ label, data, highlight }) {
  return (
    <div className={`border rounded-xl p-3 ${highlight ? "border-gold bg-gold-50" : "border-ink-200 bg-white"}`}>
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</p>
      <p className="font-display text-lg font-bold text-navy mt-1">{data.plan_name}</p>
      <p className="text-xs text-ink-600 capitalize">{data.billing_cycle} · {data.total_rooms} rooms</p>
      <p className="font-display text-xl font-bold text-navy mt-2">
        ₹{Math.round(data.per_cycle_inr).toLocaleString("en-IN")}
        <span className="text-2xs text-ink-500 font-normal ml-1">
          /{data.billing_cycle === "annual" ? "yr" : "mo"}
        </span>
      </p>
      <p className="text-2xs text-ink-500 mt-0.5">
        (₹{Math.round(data.monthly_equivalent_inr).toLocaleString("en-IN")}/mo equivalent)
      </p>
    </div>
  );
}

function PlanChangeStep3({ result }) {
  const immediate = result?.change_takes_effect === "immediate";
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mb-4">
        <CheckCircle2 size={32} className="text-white"/>
      </div>
      <h3 className="font-display text-xl font-bold text-navy">
        {immediate ? "Plan updated" : "Change scheduled"}
      </h3>
      <p className="text-sm text-ink-600 mt-2 max-w-md mx-auto leading-relaxed">
        {immediate
          ? `You're now on ${result.next.plan_name} (${result.next.billing_cycle}). ${
              result.prorated_invoice_id ? "A prorated invoice was generated and emailed." : ""
            }`
          : `Your change to ${result.next.plan_name} (${result.next.billing_cycle}) takes effect on ${
              new Date(result.effective_at).toLocaleDateString("en-IN",
                { day: "numeric", month: "short", year: "numeric" })
            }. Until then, your current plan continues.`}
      </p>
    </div>
  );
}
