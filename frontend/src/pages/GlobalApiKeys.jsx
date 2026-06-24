import React, { useState, useEffect, useCallback } from "react";
import {
  Globe, Plus, Key, Copy, Eye, EyeOff, Trash2, Edit2,
  CheckCircle2, XCircle, RefreshCw, Loader2, Shield,
  Building2, Zap, AlertTriangle, Check, X, ExternalLink
} from "lucide-react";
import { toast } from "react-toastify";
import { globalPartnerAdminAPI } from "../services/api";

/**
 * Super-admin: Global OTA Partner API Key management.
 *
 * A GlobalApiKey gives a single OTA partner access to ALL Rusto lodges
 * via a unified API — unlike per-lodge Agency keys.
 *
 * Features:
 *   - List all global API keys with usage stats
 *   - Create new key (secret shown once)
 *   - Update commission %, markup, webhook URL
 *   - Revoke key instantly
 *   - Copy key/secret to clipboard
 */

export default function GlobalApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [newKeyResult, setNewKeyResult] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await globalPartnerAdminAPI.list();
      setKeys(r.data.keys || []);
    } catch { toast.error("Failed to load global API keys"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleCreate = async (formData) => {
    try {
      const r = await globalPartnerAdminAPI.create(formData);
      setNewKeyResult(r.data);
      toast.success("Global API key created!");
      setCreating(false);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Create failed");
    }
  };

  const handleRevoke = async (key) => {
    if (!window.confirm(`Revoke access for "${key.partner_name}"? This is immediate and cannot be undone.`)) return;
    try {
      await globalPartnerAdminAPI.revoke(key.key_id);
      toast.success("Key revoked");
      refresh();
    } catch { toast.error("Revoke failed"); }
  };

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Globe size={22} className="text-gold"/> Global Partner API Keys
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Platform-level credentials for OTA partners (MakeMyTrip, Goibibo, Booking.com).
            One key covers ALL published Rusto properties automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="btn-icon">
            {loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
          </button>
          <button onClick={() => setCreating(true)} className="btn-gold flex items-center gap-1.5">
            <Plus size={15}/> New Partner Key
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="card border-blue-100 bg-blue-50/50 p-4 flex items-start gap-3">
        <Shield size={18} className="text-blue-600 shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm font-semibold text-blue-900">How Global API Keys work</p>
          <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
            Partners authenticate with <code className="bg-blue-100 px-1 rounded">X-Global-Api-Key</code> and{" "}
            <code className="bg-blue-100 px-1 rounded">X-Global-Api-Secret</code> headers.
            They can query <strong>all published lodges</strong> without needing separate per-lodge credentials.
            New lodges are automatically available to all global partners.
            Base URL: <code className="bg-blue-100 px-1 rounded">/api/global/v1/</code>
          </p>
        </div>
      </div>

      {/* Keys list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({length: 2}).map((_, i) => (
            <div key={i} className="card h-48 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
          ))}
        </div>
      ) : keys.length === 0 ? (
        <div className="card p-12 text-center">
          <Key size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="font-semibold text-navy">No global partner keys yet</p>
          <p className="text-sm text-ink-500 mt-1">Create the first key to start integrating OTA partners.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {keys.map(k => (
            <PartnerKeyCard key={k.key_id} k={k}
                             onEdit={() => setEditing(k)}
                             onRevoke={() => handleRevoke(k)}
                             onCopy={copy}/>
          ))}
        </div>
      )}

      {/* Endpoints reference */}
      <div className="card">
        <h2 className="font-display text-base font-bold text-navy mb-3 flex items-center gap-2">
          <Zap size={16} className="text-gold"/> API Endpoints Reference
        </h2>
        <div className="space-y-1.5">
          {[
            ["GET", "/api/global/v1/me",           "Verify credentials, partner info"],
            ["GET", "/api/global/v1/properties",   "List all accessible lodges"],
            ["GET", "/api/global/v1/availability", "Cross-lodge availability search"],
            ["POST","/api/global/v1/bookings",     "Create booking at any lodge"],
            ["GET", "/api/global/v1/bookings",     "List bookings made via this key"],
          ].map(([method, path, desc]) => (
            <div key={path} className="flex items-center gap-3 text-sm p-2 rounded-lg hover:bg-ink-50">
              <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono shrink-0
                ${method === "GET" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                {method}
              </span>
              <code className="text-navy text-xs font-mono">{path}</code>
              <span className="text-ink-500 text-xs">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Create modal */}
      {creating && (
        <KeyFormModal title="Create Global Partner Key"
                       onClose={() => setCreating(false)}
                       onSave={handleCreate}/>
      )}

      {/* Edit modal */}
      {editing && (
        <KeyFormModal title={`Edit: ${editing.partner_name}`}
                       initial={editing}
                       onClose={() => setEditing(null)}
                       onSave={async (data) => {
                         try {
                           await globalPartnerAdminAPI.update(editing.key_id, data);
                           toast.success("Updated");
                           setEditing(null);
                           refresh();
                         } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
                       }}/>
      )}

      {/* New key result modal */}
      {newKeyResult && (
        <NewKeyModal data={newKeyResult} onClose={() => setNewKeyResult(null)}/>
      )}
    </div>
  );
}

// ── Partner Key Card ─────────────────────────────────────────────────

function PartnerKeyCard({ k, onEdit, onRevoke, onCopy }) {
  const [showKey, setShowKey] = useState(false);
  const isActive  = k.status === "active";
  const lastUsed  = k.last_used_at ? new Date(k.last_used_at).toLocaleDateString("en-IN") : "Never";

  return (
    <div className={`card hover:shadow-lifted transition-all ${!isActive ? "opacity-70" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${isActive ? "bg-green-500" : "bg-red-400"}`}/>
            <span className="text-xs font-bold uppercase tracking-wide text-ink-500">
              {isActive ? "Active" : k.status}
            </span>
          </div>
          <h3 className="font-display text-lg font-bold text-navy">{k.partner_name}</h3>
          <p className="text-xs text-ink-500 font-mono">{k.partner_code}</p>
        </div>
        <div className="flex gap-1.5">
          {isActive && (
            <button onClick={onEdit} className="btn-icon" title="Edit"><Edit2 size={14}/></button>
          )}
          {isActive && (
            <button onClick={onRevoke} className="btn-icon text-red-500 hover:bg-red-50" title="Revoke">
              <XCircle size={14}/>
            </button>
          )}
        </div>
      </div>

      {/* API Key */}
      <div className="bg-ink-50 rounded-xl p-3 mb-3 border border-ink-200">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-2xs font-bold text-ink-500 uppercase tracking-widest mb-0.5">API Key</p>
            <p className="font-mono text-xs text-navy truncate">
              {showKey ? k.api_key : k.api_key.slice(0, 12) + "•••••••••••••••••••"}
            </p>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={() => setShowKey(s => !s)} className="p-1.5 text-ink-400 hover:text-ink-700">
              {showKey ? <EyeOff size={13}/> : <Eye size={13}/>}
            </button>
            <button onClick={() => onCopy(k.api_key, "API Key")} className="p-1.5 text-ink-400 hover:text-ink-700">
              <Copy size={13}/>
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "Commission", value: `${k.commission_pct}%` },
          { label: "Markup",     value: `${k.rate_markup_pct}%` },
          { label: "API Calls",  value: k.total_calls?.toLocaleString("en-IN") || "0" },
        ].map((s, i) => (
          <div key={i} className="text-center p-2 bg-ink-50 rounded-lg">
            <p className="font-bold text-navy text-sm">{s.value}</p>
            <p className="text-2xs text-ink-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Meta */}
      <div className="text-xs text-ink-400 space-y-0.5">
        <p>Scope: {k.allowed_lodge_ids ? `${k.allowed_lodge_ids.length} specific lodges` : "All published lodges"}</p>
        <p>Last used: {lastUsed}</p>
        {k.webhook_url && <p className="truncate">Webhook: {k.webhook_url}</p>}
      </div>
    </div>
  );
}

// ── Key Form Modal ───────────────────────────────────────────────────

function KeyFormModal({ title, initial, onClose, onSave }) {
  const [form, setForm] = useState({
    partner_name:        initial?.partner_name        || "",
    partner_code:        initial?.partner_code        || "",
    contact_email:       initial?.contact_email       || "",
    contact_person:      initial?.contact_person      || "",
    webhook_url:         initial?.webhook_url         || "",
    commission_pct:      initial?.commission_pct      ?? 10,
    rate_markup_pct:     initial?.rate_markup_pct     ?? 0,
    daily_booking_limit: initial?.daily_booking_limit ?? 0,
    allowed_lodge_ids:   null,  // null = all lodges
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.partner_name.trim() || !form.partner_code.trim()) {
      toast.error("Partner name and code are required");
      return;
    }
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-ink-100 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-navy">{title}</h2>
          <button onClick={onClose}><X size={18} className="text-ink-400"/></button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Partner Name *</label>
            <input value={form.partner_name} onChange={e => setForm(f=>({...f,partner_name:e.target.value}))}
                   placeholder="MakeMyTrip" className="input-field text-sm"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Partner Code * <span className="text-ink-400 font-normal">(no spaces, lowercase)</span></label>
            <input value={form.partner_code} onChange={e => setForm(f=>({...f,partner_code:e.target.value.toLowerCase()}))}
                   placeholder="makemytrip" className="input-field text-sm font-mono"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Contact Email</label>
            <input type="email" value={form.contact_email}
                   onChange={e => setForm(f=>({...f,contact_email:e.target.value}))}
                   placeholder="api@partner.com" className="input-field text-sm"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Contact Person</label>
            <input value={form.contact_person}
                   onChange={e => setForm(f=>({...f,contact_person:e.target.value}))}
                   placeholder="Rahul Sharma" className="input-field text-sm"/>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink-600 mb-1">Webhook URL <span className="text-ink-400 font-normal">(optional — receives booking events)</span></label>
            <input value={form.webhook_url}
                   onChange={e => setForm(f=>({...f,webhook_url:e.target.value}))}
                   placeholder="https://partner.com/webhooks/rusto" className="input-field text-sm font-mono"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Commission %</label>
            <input type="number" min="0" max="50" step="0.5" value={form.commission_pct}
                   onChange={e => setForm(f=>({...f,commission_pct:parseFloat(e.target.value)}))}
                   className="input-field text-sm"/>
            <p className="text-2xs text-ink-400 mt-1">Rusto charges this % on each booking from this partner</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 mb-1">Rate Markup %</label>
            <input type="number" min="0" max="100" step="0.5" value={form.rate_markup_pct}
                   onChange={e => setForm(f=>({...f,rate_markup_pct:parseFloat(e.target.value)}))}
                   className="input-field text-sm"/>
            <p className="text-2xs text-ink-400 mt-1">Added on top of lodge base rate for partner's customers</p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink-600 mb-1">Scope</label>
            <div className="flex items-center gap-2 p-3 bg-ink-50 rounded-xl border border-ink-200">
              <Globe size={15} className="text-ink-500 shrink-0"/>
              <div>
                <p className="text-sm font-medium text-navy">All published Rusto lodges</p>
                <p className="text-xs text-ink-500">New lodges automatically included when published</p>
              </div>
              <CheckCircle2 size={16} className="text-green-500 ml-auto shrink-0"/>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1.5">
            {saving ? <Loader2 size={14} className="animate-spin"/> : <Check size={14}/>}
            {saving ? "Saving…" : initial ? "Update" : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Key Display Modal ────────────────────────────────────────────

function NewKeyModal({ data, onClose }) {
  const copy = (text, label) => { navigator.clipboard.writeText(text); toast.success(`${label} copied`); };
  const [showSecret, setShowSecret] = useState(true);

  return (
    <div className="modal-backdrop">
      <div className="modal-box max-w-lg">
        <div className="p-6 text-center border-b border-ink-100">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center mb-4 shadow-gold">
            <Key size={32} className="text-white"/>
          </div>
          <h2 className="font-display text-xl font-bold text-navy">API Key Created! 🔑</h2>
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 inline-block">
            ⚠️ Save the secret now — it will never be shown again.
          </p>
        </div>
        <div className="p-6 space-y-3">
          {[
            { label: "Partner", value: data.partner_name },
            { label: "API Key", value: data.api_key, mono: true },
            { label: "API Secret", value: data.api_secret, mono: true, secret: true },
          ].map(({label, value, mono, secret}) => (
            <div key={label} className="flex items-center gap-2 bg-ink-50 rounded-xl p-3 border border-ink-200">
              <div className="flex-1 min-w-0">
                <p className="text-2xs uppercase tracking-widest font-bold text-ink-500">{label}</p>
                <p className={`text-navy font-semibold truncate mt-0.5 ${mono ? "font-mono text-sm" : ""}`}>
                  {secret && !showSecret ? "•".repeat(20) : value}
                </p>
              </div>
              {secret && (
                <button onClick={() => setShowSecret(s => !s)} className="text-ink-400 hover:text-ink-700 text-xs shrink-0">
                  {showSecret ? "Hide" : "Show"}
                </button>
              )}
              <button onClick={() => copy(value, label)} className="btn-icon shrink-0"><Copy size={14}/></button>
            </div>
          ))}
          <button onClick={() => {
            const block = `Rusto Global API Credentials\nPartner: ${data.partner_name}\nAPI Key: ${data.api_key}\nAPI Secret: ${data.api_secret}\nBase URL: /api/global/v1/`;
            navigator.clipboard.writeText(block);
            toast.success("All credentials copied");
          }} className="btn-primary w-full flex items-center justify-center gap-2 mt-2">
            <Copy size={14}/> Copy All Credentials
          </button>
          {data.note && <p className="text-xs text-ink-500 text-center">{data.note}</p>}
        </div>
        <div className="px-6 py-4 border-t border-ink-100 flex justify-end">
          <button onClick={onClose} className="btn-gold">Done</button>
        </div>
      </div>
    </div>
  );
}
