import React, { useState, useEffect } from "react";
import { MessageCircle, Settings, Send, RefreshCw, AlertCircle,
         CheckCircle2, Clock, Eye, X, Phone, Copy, ExternalLink,
         Loader2, Filter, FileText, ChevronRight } from "lucide-react";
import { toast } from "react-toastify";
import { whatsappAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * WhatsApp Business management for the lodge admin.
 *
 * Sections:
 *   1. Enable toggle + credentials (Meta phone_number_id + access_token)
 *   2. Test-send card (verify the credentials actually work before
 *      counting on them in production)
 *   3. Template catalog (what'll be sent, when)
 *   4. Message log (status pills, filters, masked phone numbers)
 *
 * Privacy: phone numbers are masked in the table (e.g., ********6789).
 * The full number is only ever shown to the admin who initiated a
 * test-send and only in that immediate response — never re-fetched.
 *
 * Security: the access token is NEVER echoed back from the API. The
 * admin must paste it from Meta each time they change it.
 */
export default function WhatsAppAdmin() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("messages");   // messages | settings

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await whatsappAPI.getConfig();
      setConfig(r.data);
    } catch {
      toast.error("Failed to load WhatsApp config");
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  if (!isAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Admin access required</h2>
    </div>
  );

  if (loading || !config) return (
    <div className="text-center py-12 text-ink-400">
      <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
      <p className="text-sm">Loading…</p>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <MessageCircle size={22} className="text-gold"/> WhatsApp
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Send booking confirmations, payment nudges, check-in reminders, and
            review requests automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config.enabled ? (
            <span className="badge bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
              <CheckCircle2 size={11}/> Enabled
            </span>
          ) : (
            <span className="badge bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200">
              Disabled
            </span>
          )}
          <button onClick={refresh} className="btn-icon" title="Refresh"><RefreshCw size={16}/></button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center border-b border-ink-100">
        <TabBtn label="Messages" Icon={MessageCircle}
                 active={tab === "messages"} onPress={() => setTab("messages")}/>
        <TabBtn label="Settings" Icon={Settings}
                 active={tab === "settings"} onPress={() => setTab("settings")}/>
      </div>

      {tab === "settings"
        ? <SettingsPanel config={config} onSaved={refresh}/>
        : <MessagesPanel/>
      }
    </div>
  );
}


function TabBtn({ label, Icon, active, onPress }) {
  return (
    <button onClick={onPress}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 transition-colors ${
              active ? "border-gold text-navy" : "border-transparent text-ink-500 hover:text-navy"
            }`}>
      <Icon size={14}/>
      <span className="text-sm font-semibold">{label}</span>
    </button>
  );
}


// ── Settings panel ────────────────────────────────────────────────

function SettingsPanel({ config, onSaved }) {
  const [form, setForm] = useState({
    enabled: config.enabled,
    phone_number_id: config.phone_number_id,
    display_name: config.display_name,
    access_token: "",   // never pre-filled
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testTemplate, setTestTemplate] = useState("rusto_booking_confirmed");

  const save = async () => {
    setBusy(true);
    try {
      // Only send access_token if user typed something; empty string from
      // an untouched field shouldn't blank out the stored token.
      const body = {
        enabled: form.enabled,
        phone_number_id: form.phone_number_id,
        display_name: form.display_name,
      };
      if (form.access_token.trim()) body.access_token = form.access_token.trim();
      await whatsappAPI.updateConfig(body);
      toast.success("Settings saved");
      setForm(f => ({ ...f, access_token: "" }));
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) { toast.error("Enter a phone number"); return; }
    setTesting(true);
    try {
      const r = await whatsappAPI.testSend({
        to_phone: testPhone.trim(), template_key: testTemplate,
      });
      if (r.data.status === "sent") {
        toast.success(`Test sent — provider returned ${r.data.provider}`);
      } else {
        toast.error(`Send failed: ${r.data.error_detail || r.data.error_code}`);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Test send failed");
    } finally { setTesting(false); }
  };

  // Detect mock provider to surface guidance
  const isMockProvider = config.active_provider === "mock";

  return (
    <div className="space-y-5">
      {/* Enable toggle */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-navy">WhatsApp messages</h3>
            <p className="text-xs text-ink-500 mt-0.5">
              When enabled, customers automatically receive booking confirmations
              and reminders via WhatsApp.
            </p>
          </div>
          <Toggle value={form.enabled}
                  onChange={v => setForm(f => ({...f, enabled: v}))}/>
        </div>
      </div>

      {/* Provider status banner */}
      {isMockProvider && (
        <div className="card bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 flex-shrink-0 mt-0.5"/>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Currently using mock provider
              </p>
              <p className="text-2xs text-amber-800 mt-1 leading-relaxed">
                Messages will be logged but NOT actually sent until you add
                real Meta credentials below. This is fine for testing the
                booking flow — customers won't receive WhatsApps yet.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Credentials */}
      <div className="card">
        <h3 className="font-display font-bold text-navy mb-3">Meta WhatsApp credentials</h3>
        <p className="text-xs text-ink-500 mb-4 leading-relaxed">
          Get these from <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noreferrer" className="text-gold-700 underline">Meta Business Manager → WhatsApp → API Setup</a>.
          Each lodge has its own credentials — Rusto doesn't share senders.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="label">Display name <span className="text-ink-400 font-normal">(shown in admin UI)</span></span>
            <input value={form.display_name}
                   onChange={e => setForm(f => ({...f, display_name: e.target.value}))}
                   placeholder="My Lodge WhatsApp"
                   className="input-field"/>
          </label>
          <label className="block">
            <span className="label">Phone Number ID <span className="text-ink-400 font-normal">(15-digit numeric, NOT the phone number itself)</span></span>
            <input value={form.phone_number_id}
                   onChange={e => setForm(f => ({...f, phone_number_id: e.target.value}))}
                   placeholder="123456789012345"
                   className="input-field font-mono text-sm"/>
          </label>
          <label className="block">
            <span className="label">
              Access Token
              {config.has_access_token && <span className="ml-2 text-2xs text-green-600 font-semibold">✓ A token is currently saved</span>}
            </span>
            <input value={form.access_token}
                   type="password"
                   onChange={e => setForm(f => ({...f, access_token: e.target.value}))}
                   placeholder={config.has_access_token ? "•••• (leave blank to keep current)" : "Paste your long-lived access token"}
                   className="input-field font-mono text-sm"/>
            <p className="text-2xs text-ink-500 mt-1">
              The token is encrypted at rest and never displayed in this UI again.
            </p>
          </label>
        </div>
        <button onClick={save} disabled={busy}
                className="btn-gold mt-4 flex items-center gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin"/> : null} Save settings
        </button>
      </div>

      {/* Test send */}
      <div className="card">
        <h3 className="font-display font-bold text-navy mb-3">Test send</h3>
        <p className="text-xs text-ink-500 mb-4">
          Send a test template to verify Meta has approved it. Bypasses the
          dedup gate — you can call this repeatedly.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="block md:col-span-1">
            <span className="label">Phone</span>
            <input value={testPhone}
                   onChange={e => setTestPhone(e.target.value)}
                   placeholder="9876543210"
                   className="input-field"/>
          </label>
          <label className="block md:col-span-1">
            <span className="label">Template</span>
            <select value={testTemplate}
                    onChange={e => setTestTemplate(e.target.value)}
                    className="input-field">
              {config.templates.map(t => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button onClick={sendTest} disabled={testing || !form.enabled}
                    className="btn-primary w-full md:w-auto flex items-center gap-1.5">
              {testing ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
              Send test
            </button>
          </div>
        </div>
        {!form.enabled && (
          <p className="text-2xs text-amber-700 mt-2 italic">
            Enable WhatsApp + save before testing.
          </p>
        )}
      </div>

      {/* Templates list */}
      <div className="card">
        <h3 className="font-display font-bold text-navy mb-3 flex items-center gap-2">
          <FileText size={16} className="text-gold"/> Templates
        </h3>
        <p className="text-xs text-ink-500 mb-4 leading-relaxed">
          These templates must be approved by Meta before live sends will work. Register them in your{" "}
          <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer" className="text-gold-700 underline">
            WhatsApp Manager
          </a> with these exact names and the parameter order shown.
        </p>
        <div className="space-y-3">
          {config.templates.map(t => (
            <div key={t.key} className="border border-ink-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <code className="text-sm font-mono font-semibold text-navy">{t.name}</code>
                  <span className="text-2xs ml-2 px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 uppercase font-bold tracking-eyebrow">
                    {t.category}
                  </span>
                  <span className="text-2xs ml-1 px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 uppercase font-bold tracking-eyebrow">
                    {t.lang}
                  </span>
                </div>
              </div>
              <p className="text-sm text-ink-700 bg-ink-50 rounded-lg p-2 leading-relaxed">
                {t.body_preview}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function Toggle({ value, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              value ? "bg-green-500" : "bg-ink-300"
            }`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
        value ? "translate-x-5" : "translate-x-0.5"
      }`}/>
    </button>
  );
}


// ── Messages panel ────────────────────────────────────────────────

function MessagesPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "", reason: "" });

  const refresh = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.reason) params.reason = filters.reason;
      const r = await whatsappAPI.messages(params);
      setData(r.data);
    } catch {
      toast.error("Failed to load messages");
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filters]);

  if (loading || !data) return (
    <div className="text-center py-12 text-ink-400">
      <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
    </div>
  );

  const s = data.summary_last_30d;

  return (
    <div className="space-y-4">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Sent (30d)"      value={s.sent} color="ink"/>
        <SummaryTile label="Delivered (30d)" value={s.delivered} color="green"/>
        <SummaryTile label="Read (30d)"      value={s.read} color="green"/>
        <SummaryTile label="Failed (30d)"    value={s.failed}
                     color={s.failed > 0 ? "red" : "ink"}/>
      </div>

      {/* Filters */}
      <div className="card flex items-center gap-3 flex-wrap">
        <Filter size={14} className="text-gold"/>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-600">Status</span>
          <select value={filters.status}
                  onChange={e => setFilters(f => ({...f, status: e.target.value}))}
                  className="input-field text-sm py-1.5 px-2 w-auto">
            <option value="">All</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="read">Read</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-600">Reason</span>
          <select value={filters.reason}
                  onChange={e => setFilters(f => ({...f, reason: e.target.value}))}
                  className="input-field text-sm py-1.5 px-2 w-auto">
            <option value="">All</option>
            <option value="booking_confirmation">Booking confirmation</option>
            <option value="payment_pending_nudge">Payment nudge</option>
            <option value="checkin_reminder">Check-in reminder</option>
            <option value="review_request">Review request</option>
            <option value="test_send">Test send</option>
          </select>
        </label>
      </div>

      {/* Message table */}
      {data.messages.length === 0 ? (
        <div className="card text-center py-12">
          <MessageCircle size={36} className="mx-auto text-ink-300 mb-3"/>
          <h3 className="font-display text-lg font-bold text-navy">No messages yet</h3>
          <p className="text-ink-500 mt-1 text-sm">
            Messages will appear here as bookings flow through the system.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50">
                  <Th>When</Th><Th>To</Th><Th>Reason</Th><Th>Template</Th><Th>Status</Th><Th>Booking</Th>
                </tr>
              </thead>
              <tbody>
                {data.messages.map(m => <MessageRow key={m.message_id} m={m}/>)}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-ink-200 text-2xs text-ink-500 bg-ink-50">
            Showing {data.messages.length} of {data.total} messages
          </div>
        </div>
      )}
    </div>
  );
}


function SummaryTile({ label, value, color }) {
  const cls = {
    ink:   "bg-white border-ink-200",
    green: "bg-green-50 border-green-200",
    red:   "bg-red-50 border-red-200",
  }[color] || "bg-white";
  const numCls = {
    ink: "text-navy", green: "text-green-700", red: "text-red-700",
  }[color] || "text-navy";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-0.5">{label}</div>
      <div className={`font-display text-2xl font-bold ${numCls}`}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return <th className="text-left text-2xs uppercase tracking-eyebrow font-bold text-ink-500 px-3 py-2">{children}</th>;
}

function MessageRow({ m }) {
  const statusCfg = {
    queued:      { cls: "bg-ink-100 text-ink-700",  Icon: Clock },
    sent:        { cls: "bg-blue-50 text-blue-700", Icon: Send },
    delivered:   { cls: "bg-green-50 text-green-700", Icon: CheckCircle2 },
    read:        { cls: "bg-green-50 text-green-700", Icon: Eye },
    failed:      { cls: "bg-red-50 text-red-700",     Icon: AlertCircle },
    undelivered: { cls: "bg-amber-50 text-amber-700", Icon: AlertCircle },
    throttled:   { cls: "bg-amber-50 text-amber-700", Icon: Clock },
  }[m.status] || { cls: "bg-ink-100 text-ink-700", Icon: Clock };
  const reasonLabel = {
    booking_confirmation:   "Booking confirmed",
    payment_pending_nudge:  "Payment nudge",
    checkin_reminder:       "Check-in reminder",
    review_request:         "Review request",
    test_send:              "Test send",
    cancellation_notice:    "Cancellation",
  }[m.reason] || m.reason;
  return (
    <tr className="border-b border-ink-100 hover:bg-ink-50/50">
      <td className="px-3 py-2 text-ink-700 text-xs">
        {m.created_at ? new Date(m.created_at).toLocaleString("en-IN",
            { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-ink-600">{m.to_phone_masked}</td>
      <td className="px-3 py-2 text-navy">{reasonLabel}</td>
      <td className="px-3 py-2 text-2xs font-mono text-ink-500">{m.template_name}</td>
      <td className="px-3 py-2">
        <span className={`badge ${statusCfg.cls} ring-1 ring-inset ring-current/20 text-2xs`}>
          <statusCfg.Icon size={10}/> {m.status}
        </span>
        {m.error_detail && (
          <div className="text-2xs text-red-600 mt-0.5 max-w-[200px] truncate" title={m.error_detail}>
            {m.error_detail}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-2xs font-mono text-ink-500">
        {m.related_booking_id ? `#${m.related_booking_id}` : "—"}
      </td>
    </tr>
  );
}
