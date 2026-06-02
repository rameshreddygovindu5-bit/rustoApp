import React, { useEffect, useState, useMemo } from "react";
import { Mail, Send, Eye, RefreshCw, AlertCircle, CheckCircle2, X,
         PlusCircle, Save, Trash2, Loader2, Variable, Wifi } from "lucide-react";
import { toast } from "react-toastify";
import { emailAPI } from "../services/api";

/**
 * Emails page — three tabs:
 *   1. Templates — list + edit + create
 *   2. Logs — what's been sent, with filter chips for status / template
 *   3. Settings — SMTP test + seed-defaults
 *
 * The editor has a live preview pane (server-side render) and a chip
 * row for click-to-insert merge variables. We keep the preview server-
 * rendered (rather than reimplementing the substitution in JS) so the
 * two stay in sync — if we ever switch to a richer template engine the
 * frontend doesn't need changes.
 */
export default function Emails() {
  const [tab, setTab] = useState("templates");
  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
          <Mail size={22} className="text-gold"/> Email Automation
        </h1>
        <p className="text-ink-500 text-sm mt-0.5">
          Templates, automated confirmations, and SMTP delivery log.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-ink-200">
        {[
          ["templates", "Templates"],
          ["logs",      "Send Log"],
          ["settings",  "Settings"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    tab === k
                      ? "border-b-2 border-gold text-navy"
                      : "border-b-2 border-transparent text-ink-500 hover:text-navy"
                  }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "templates" && <TemplatesTab/>}
      {tab === "logs" && <LogsTab/>}
      {tab === "settings" && <SettingsTab/>}
    </div>
  );
}


function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await emailAPI.listTemplates();
      setTemplates(r.data || []);
      if (!selected && r.data?.length) setSelected(r.data[0]);
    } catch { toast.error("Failed to load templates"); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  // Keep selection in sync after edits — find by id.
  useEffect(() => {
    if (selected) {
      const fresh = templates.find(t => t.template_id === selected.template_id);
      if (fresh) setSelected(fresh);
    }
  // eslint-disable-next-line
  }, [templates]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
      {/* Sidebar */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-3">
        <button onClick={() => setShowCreate(true)}
                className="w-full bg-navy text-white py-2 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:bg-navy-light mb-3">
          <PlusCircle size={14}/> New template
        </button>
        {loading ? (
          <div className="text-center py-6 text-ink-400 text-sm">Loading…</div>
        ) : templates.length === 0 ? (
          <p className="text-ink-400 text-sm text-center py-6">No templates. Use "New template" or seed defaults in Settings.</p>
        ) : (
          <div className="space-y-1">
            {templates.map(t => (
              <button key={t.template_id}
                      onClick={() => setSelected(t)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selected?.template_id === t.template_id
                          ? "bg-gold/10 ring-1 ring-inset ring-gold/30"
                          : "hover:bg-ink-50"
                      }`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-navy text-sm truncate">{t.name}</span>
                  {!t.is_active && <span className="text-2xs text-ink-400">off</span>}
                </div>
                {t.template_key && (
                  <div className="text-2xs uppercase tracking-eyebrow text-gold font-bold mt-0.5">
                    SYSTEM · {t.template_key}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      {selected ? (
        <TemplateEditor key={selected.template_id} tpl={selected}
                         onSaved={refresh} onDeleted={() => { setSelected(null); refresh(); }}/>
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-12 text-center text-ink-400">
          Pick a template to edit.
        </div>
      )}

      {showCreate && (
        <CreateTemplateModal onClose={() => setShowCreate(false)}
                              onSaved={() => { setShowCreate(false); refresh(); }}/>
      )}
    </div>
  );
}


function TemplateEditor({ tpl, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    name: tpl.name, subject: tpl.subject, body_html: tpl.body_html,
    description: tpl.description || "", is_active: tpl.is_active,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vars, setVars] = useState([]);
  const [preview, setPreview] = useState({ subject: "", body_html: "" });
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    setForm({ name: tpl.name, subject: tpl.subject, body_html: tpl.body_html,
              description: tpl.description || "", is_active: tpl.is_active });
    setDirty(false);
  }, [tpl]);

  // Fetch merge variables once.
  useEffect(() => {
    emailAPI.mergeVariables().then(r => setVars(r.data || [])).catch(() => {});
  }, []);

  // Live preview — debounced server render. Uses example values from
  // the merge-variables doc so the preview looks realistic.
  useEffect(() => {
    const ctx = Object.fromEntries(vars.map(v => [v.key, v.example]));
    const id = setTimeout(() => {
      emailAPI.preview({ subject: form.subject, body_html: form.body_html, context: ctx })
        .then(r => setPreview(r.data))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(id);
  }, [form.subject, form.body_html, vars]);

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };

  const insertVar = (key) => {
    // Append at end of body for simplicity (a textarea cursor API
    // would be nicer but enough; advanced users can paste anywhere).
    setField("body_html", form.body_html + ` {{${key}}}`);
  };

  const save = async () => {
    setSaving(true);
    try {
      await emailAPI.updateTemplate(tpl.template_id, form);
      toast.success("Saved");
      setDirty(false);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!testTo.trim() || !testTo.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    try {
      const ctx = Object.fromEntries(vars.map(v => [v.key, v.example]));
      const r = await emailAPI.send({
        to_email: testTo.trim(),
        // Use current (possibly unsaved) body + subject for the test
        subject: form.subject, body_html: form.body_html,
        context: ctx, is_test: true,
      });
      if (r.data.status === "sent") {
        toast.success(`Test sent to ${testTo}`);
      } else if (r.data.status === "skipped") {
        toast.warning("Skipped — SMTP not configured. Open Settings tab.");
      } else {
        toast.error(`Send failed: ${r.data.error_message || "unknown"}`);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Send failed");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete template "${tpl.name}"?`)) return;
    try {
      await emailAPI.deleteTemplate(tpl.template_id);
      toast.success("Deleted");
      onDeleted();
    } catch (e) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <input value={form.name} onChange={e => setField("name", e.target.value)}
                 className="font-display text-xl font-bold text-navy bg-transparent w-full outline-none border-b border-transparent focus:border-gold transition-colors"/>
          {tpl.template_key && (
            <div className="text-2xs uppercase tracking-eyebrow text-gold font-bold mt-1">
              SYSTEM TEMPLATE · {tpl.template_key}
            </div>
          )}
          {form.description && <p className="text-xs text-ink-500 mt-1">{form.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-sm text-ink-600">
            <input type="checkbox" checked={form.is_active}
                   onChange={e => setField("is_active", e.target.checked)}/>
            Active
          </label>
          {!tpl.template_key && (
            <button onClick={remove} className="text-red-500 hover:text-red-700 p-1.5 rounded hover:bg-red-50">
              <Trash2 size={14}/>
            </button>
          )}
          <button onClick={save} disabled={!dirty || saving}
                  className="bg-navy text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 hover:bg-navy-light">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
            {saving ? "Saving" : (dirty ? "Save" : "Saved")}
          </button>
        </div>
      </div>

      {/* Two-column body: edit | preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-ink-100">
        {/* Editor side */}
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">
              Subject line
            </label>
            <input value={form.subject} onChange={e => setField("subject", e.target.value)}
                   className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm font-mono"/>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">
              Body (HTML)
            </label>
            <textarea value={form.body_html} onChange={e => setField("body_html", e.target.value)}
                      rows={14}
                      className="w-full border border-ink-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed"/>
          </div>
          {/* Merge-variable chips */}
          <div>
            <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1 flex items-center gap-1">
              <Variable size={12}/> Click to insert
            </div>
            <div className="flex flex-wrap gap-1.5">
              {vars.map(v => (
                <button key={v.key} onClick={() => insertVar(v.key)}
                        title={v.example}
                        className="text-2xs px-2 py-1 bg-ink-50 hover:bg-gold/10 hover:text-gold-dark border border-ink-200 hover:border-gold/40 rounded font-mono transition-colors">
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
          {/* Test send */}
          <div className="pt-3 border-t border-ink-100">
            <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">
              Send a test
            </div>
            <div className="flex gap-2">
              <input type="email" placeholder="you@example.com" value={testTo}
                     onChange={e => setTestTo(e.target.value)}
                     className="flex-1 border border-ink-200 rounded-lg px-3 py-2 text-sm"/>
              <button onClick={sendTest}
                      className="bg-gradient-to-br from-gold to-gold-dark text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 hover:shadow-gold">
                <Send size={13}/> Send test
              </button>
            </div>
            <p className="text-2xs text-ink-400 mt-1">Uses example values for merge variables. SMTP must be configured.</p>
          </div>
        </div>

        {/* Preview side */}
        <div className="p-5 bg-ink-50/30">
          <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-2 flex items-center gap-1">
            <Eye size={12}/> Live preview
          </div>
          <div className="bg-white rounded-xl shadow-soft border border-ink-200 overflow-hidden">
            <div className="px-4 py-2 border-b border-ink-100 bg-ink-50">
              <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Subject</div>
              <div className="text-sm font-semibold text-navy mt-0.5 truncate">{preview.subject || "—"}</div>
            </div>
            <div className="p-1">
              <div dangerouslySetInnerHTML={{ __html: preview.body_html || "" }}/>
            </div>
          </div>
          <p className="text-2xs text-ink-400 mt-2">
            Hotel name, address, and phone come from your Settings.
          </p>
        </div>
      </div>
    </div>
  );
}


function CreateTemplateModal({ onClose, onSaved }) {
  const [f, setF] = useState({
    name: "", subject: "", body_html: "<p>Hello {{first_name}},</p>",
    description: "", is_active: true, template_key: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || !f.subject.trim()) { toast.error("Name + subject required"); return; }
    setSaving(true);
    try {
      await emailAPI.createTemplate({
        ...f,
        template_key: f.template_key.trim() || null,
      });
      toast.success("Template created");
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Create failed");
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-navy-dark/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-lux w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="px-5 py-4 border-b border-ink-100 flex justify-between items-center">
          <h2 className="font-display font-bold text-navy text-lg">New Email Template</h2>
          <button type="button" onClick={onClose}><X size={20} className="text-ink-400 hover:text-navy"/></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Name *</label>
            <input value={f.name} onChange={e => setF({...f, name: e.target.value})}
                   className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Subject *</label>
            <input value={f.subject} onChange={e => setF({...f, subject: e.target.value})}
                   className="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono"/>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Body HTML</label>
            <textarea value={f.body_html} onChange={e => setF({...f, body_html: e.target.value})}
                      rows={5} className="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono text-xs"/>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Description</label>
            <input value={f.description} onChange={e => setF({...f, description: e.target.value})}
                   className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-50 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-5 py-2 bg-navy hover:bg-navy-light text-white rounded-xl font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}


function LogsTab() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "", template_key: "", days: 30 });

  const refresh = async () => {
    setLoading(true);
    try {
      const [logsR, statsR] = await Promise.all([
        emailAPI.logs(filter),
        emailAPI.stats(filter.days),
      ]);
      setRows(logsR.data || []);
      setStats(statsR.data || {});
    } catch { toast.error("Failed to load logs"); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter.status, filter.template_key, filter.days]);

  const StatChip = ({ label, value, color }) => (
    <div className={`px-3 py-2 rounded-xl text-center ${color}`}>
      <div className="text-2xs uppercase tracking-eyebrow font-bold opacity-70">{label}</div>
      <div className="text-2xl font-display font-bold mt-0.5">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip label="Sent"    value={stats.by_status?.sent ?? 0}    color="bg-green-50 text-green-800 ring-1 ring-inset ring-green-200"/>
        <StatChip label="Failed"  value={stats.by_status?.failed ?? 0}  color="bg-red-50 text-red-800 ring-1 ring-inset ring-red-200"/>
        <StatChip label="Skipped" value={stats.by_status?.skipped ?? 0} color="bg-ink-100 text-ink-700 ring-1 ring-inset ring-ink-200"/>
        <StatChip label={`Last ${filter.days} days`} value={rows.length} color="bg-gold/10 text-gold-dark ring-1 ring-inset ring-gold/30"/>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={filter.status} onChange={e => setFilter({...filter, status: e.target.value})}
                className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <select value={filter.template_key} onChange={e => setFilter({...filter, template_key: e.target.value})}
                className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm">
          <option value="">All templates</option>
          {Object.keys(stats.by_template_key || {}).map(k => (
            <option key={k} value={k === "(custom)" ? "" : k}>{k}</option>
          ))}
        </select>
        <select value={filter.days} onChange={e => setFilter({...filter, days: parseInt(e.target.value, 10)})}
                className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button onClick={refresh} className="p-2 text-ink-500 hover:text-navy">
          <RefreshCw size={16}/>
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-ink-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <Mail size={36} className="mx-auto text-ink-300 mb-3"/>
            <p className="text-ink-500">No emails in this window.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50">
              <tr>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">When</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Template</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">To</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden md:table-cell">Subject</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(L => (
                <tr key={L.log_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                  <td className="px-4 py-2 text-ink-700 text-xs whitespace-nowrap">
                    {L.sent_at ? new Date(L.sent_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
                  </td>
                  <td className="px-4 py-2 font-mono text-2xs">{L.template_key || "(custom)"}</td>
                  <td className="px-4 py-2 text-navy">{L.to_email}</td>
                  <td className="px-4 py-2 hidden md:table-cell text-ink-700 truncate max-w-xs">{L.subject}</td>
                  <td className="px-4 py-2">
                    {L.status === "sent" && (
                      <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-eyebrow font-bold px-2 py-1 rounded bg-green-50 text-green-700 ring-1 ring-inset ring-green-200">
                        <CheckCircle2 size={10}/> Sent
                      </span>
                    )}
                    {L.status === "failed" && (
                      <span title={L.error_message || ""}
                            className="inline-flex items-center gap-1 text-2xs uppercase tracking-eyebrow font-bold px-2 py-1 rounded bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 cursor-help">
                        <AlertCircle size={10}/> Failed
                      </span>
                    )}
                    {L.status === "skipped" && (
                      <span title={L.error_message || ""}
                            className="inline-flex items-center gap-1 text-2xs uppercase tracking-eyebrow font-bold px-2 py-1 rounded bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200 cursor-help">
                        Skipped
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


function SettingsTab() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      const r = await emailAPI.testConnection();
      setResult(r.data);
      if (r.data.ok) toast.success("SMTP connection OK");
      else toast.warning("SMTP not configured or unreachable");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Test failed");
    } finally { setTesting(false); }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      const r = await emailAPI.seedDefaults();
      toast.success(`${r.data.created} default template(s) created`);
    } catch (e) { toast.error("Seed failed"); }
    finally { setSeeding(false); }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-5">
        <h3 className="font-display text-lg font-bold text-navy flex items-center gap-2">
          <Wifi size={18} className="text-gold"/> SMTP connection
        </h3>
        <p className="text-sm text-ink-500 mt-1 mb-4">
          Configure <code className="font-mono text-xs bg-ink-50 px-1 rounded">smtp_host</code>, <code className="font-mono text-xs bg-ink-50 px-1 rounded">smtp_port</code>, <code className="font-mono text-xs bg-ink-50 px-1 rounded">smtp_user</code>, <code className="font-mono text-xs bg-ink-50 px-1 rounded">smtp_password</code> in the main Settings page. The button below tests the live connection (no email sent).
        </p>
        <button onClick={test} disabled={testing}
                className="bg-navy hover:bg-navy-light text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
          {testing ? <Loader2 size={14} className="animate-spin"/> : <Wifi size={14}/>}
          {testing ? "Testing…" : "Test connection"}
        </button>
        {result && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${
            result.ok
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-amber-50 text-amber-800 border border-amber-200"
          }`}>
            {result.ok ? <CheckCircle2 size={14} className="inline mr-1"/> : <AlertCircle size={14} className="inline mr-1"/>}
            {result.message}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-5">
        <h3 className="font-display text-lg font-bold text-navy">Default templates</h3>
        <p className="text-sm text-ink-500 mt-1 mb-4">
          Restore any missing system templates (booking confirmation, pre-arrival, check-in welcome, post-stay thank-you). Idempotent — won't overwrite edits to existing ones.
        </p>
        <button onClick={seed} disabled={seeding}
                className="border-2 border-navy text-navy hover:bg-navy hover:text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
          {seeding ? <Loader2 size={14} className="animate-spin"/> : <PlusCircle size={14}/>}
          {seeding ? "Seeding…" : "Seed defaults"}
        </button>
      </div>
    </div>
  );
}
