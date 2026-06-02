import React, { useState, useEffect, useMemo } from "react";
import { Users, UserPlus, RefreshCw, KeyRound, ShieldCheck, X,
         Phone, Mail, Clock, CheckCircle2, Ban, Edit2, Save,
         Copy, AlertCircle, Loader2, ChevronDown, ChevronRight,
         Eye, EyeOff } from "lucide-react";
import { toast } from "react-toastify";
import { staffAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Staff Management — lodge admin onboards + manages their team.
 *
 * Anatomy:
 *   - Active staff list (cards) + toggle to show inactive
 *   - "Add staff" modal: only asks for name/email/phone + permission preset.
 *     Backend auto-generates `<code>_staffN` username + 12-char password.
 *     Password reveal modal shown once after creation.
 *   - Edit modal: lets admin toggle is_active, edit profile, fine-tune
 *     permissions via grouped checkbox toggles, reset password.
 *
 * Why not extend the existing Users page? Different audience: Users.jsx
 * is for super-admin cross-tenant work (lodge_id field, role picker).
 * This page is for lodge admins, simpler, opinionated for the common
 * onboard-a-front-desk-hire flow.
 */
export default function StaffManagement() {
  const { user, isAdmin } = useAuth();
  const [staff, setStaff] = useState([]);
  const [catalog, setCatalog] = useState(null);   // {permissions, default_keys}
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);      // staff user being edited
  const [credModal, setCredModal] = useState(null);  // {username, password, message}

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, cat] = await Promise.all([
        staffAPI.list({ include_inactive: showInactive }),
        catalog ? Promise.resolve({ data: catalog }) : staffAPI.permissionCatalog(),
      ]);
      setStaff(list.data || []);
      if (!catalog) setCatalog(cat.data);
    } catch (e) {
      toast.error("Failed to load staff");
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [showInactive]);

  if (!isAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <ShieldCheck size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Admin access required</h2>
      <p className="text-ink-500 mt-1">Only lodge admins can manage staff.</p>
    </div>
  );

  // Group: admins separate from regular staff.
  const admins = staff.filter(u => u.role !== "staff");
  const regular = staff.filter(u => u.role === "staff");

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Users size={22} className="text-gold"/> Staff Management
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Onboard your team. Auto-generated usernames + auto-generated passwords;
            you pick what each member can do.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-600 flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showInactive}
                   onChange={e => setShowInactive(e.target.checked)}
                   className="rounded"/>
            Show inactive
          </label>
          <button onClick={refresh} className="btn-icon" title="Refresh">
            <RefreshCw size={16}/>
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-gold flex items-center gap-1.5">
            <UserPlus size={14}/> Add staff
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-ink-400">
          <Loader2 size={24} className="mx-auto animate-spin mb-2"/>
          Loading…
        </div>
      ) : (
        <>
          {/* Admins */}
          {admins.length > 0 && (
            <section>
              <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">
                Admins ({admins.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {admins.map((u, i) => (
                  <StaffCard key={u.user_id} u={u} style={{ animationDelay: `${i * 40}ms` }}
                              onEdit={() => setEditing(u)}/>
                ))}
              </div>
            </section>
          )}
          {/* Staff */}
          <section>
            <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">
              Staff ({regular.length})
            </div>
            {regular.length === 0 ? (
              <div className="card text-center py-10">
                <Users size={36} className="mx-auto text-ink-300 mb-3"/>
                <h3 className="font-display text-lg font-bold text-navy">No staff yet</h3>
                <p className="text-ink-500 mt-1 mb-4">
                  Add your first team member to get started.
                </p>
                <button onClick={() => setShowCreate(true)} className="btn-gold inline-flex items-center gap-1.5">
                  <UserPlus size={14}/> Add staff
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {regular.map((u, i) => (
                  <StaffCard key={u.user_id} u={u} style={{ animationDelay: `${i * 40}ms` }}
                              onEdit={() => setEditing(u)}/>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {showCreate && catalog && (
        <CreateStaffModal catalog={catalog} onClose={() => setShowCreate(false)}
                          onCreated={(creds) => {
                            setShowCreate(false);
                            setCredModal(creds);
                            refresh();
                          }}/>
      )}
      {editing && catalog && (
        <EditStaffModal u={editing} catalog={catalog}
                        currentUserId={user?.user_id}
                        onClose={() => setEditing(null)}
                        onUpdated={() => { setEditing(null); refresh(); }}
                        onPasswordReset={(creds) => { setEditing(null); setCredModal(creds); refresh(); }}/>
      )}
      {credModal && (
        <CredentialsModal data={credModal} onClose={() => setCredModal(null)}/>
      )}
    </div>
  );
}


// ── Staff card ────────────────────────────────────────────────────

function StaffCard({ u, style, onEdit }) {
  const isAdminRole = u.role !== "staff";
  return (
    <div onClick={onEdit} style={style}
          className={`card-interactive p-5 cursor-pointer animate-slide-up ${
            !u.is_active ? "opacity-60" : ""
          }`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold flex-shrink-0 ${
          isAdminRole ? "bg-gold text-navy-dark shadow-gold" : "bg-navy text-white"
        }`}>
          {u.full_name?.[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold text-navy text-base truncate">{u.full_name}</h3>
          <p className="text-xs text-ink-500 font-mono truncate">{u.username}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RoleBadge role={u.role}/>
          {!u.is_active && (
            <span className="badge bg-red-50 text-red-700 ring-1 ring-inset ring-red-200">
              <Ban size={10}/> Inactive
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1 text-xs text-ink-700">
        {u.email && <div className="flex items-center gap-1.5 truncate"><Mail size={11} className="text-ink-400 flex-shrink-0"/> {u.email}</div>}
        {u.phone && <div className="flex items-center gap-1.5"><Phone size={11} className="text-ink-400"/> {u.phone}</div>}
        <div className="flex items-center gap-1.5 text-ink-500">
          <Clock size={11}/>
          {u.last_login
            ? `Last login: ${new Date(u.last_login).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
            : "Never logged in"}
        </div>
      </div>
      {u.role === "staff" && (
        <div className="mt-3 pt-3 border-t border-ink-100 flex items-center justify-between">
          <span className="text-2xs text-ink-500">
            {u.permissions_effective?.length || 0} permission{u.permissions_effective?.length === 1 ? "" : "s"}
            {u.uses_legacy_defaults && <span className="text-ink-400"> (defaults)</span>}
          </span>
          <span className="text-2xs text-gold-700 font-semibold flex items-center gap-0.5">
            Edit <ChevronRight size={11}/>
          </span>
        </div>
      )}
    </div>
  );
}


function RoleBadge({ role }) {
  const cfg = {
    super_admin: { label: "Super Admin", cls: "bg-purple-50 text-purple-800 ring-purple-200" },
    admin:        { label: "Admin",        cls: "bg-gold-50 text-gold-800 ring-gold-300" },
    staff:        { label: "Staff",        cls: "bg-ink-100 text-ink-700 ring-ink-200" },
  }[role] || { label: role, cls: "bg-ink-100 text-ink-700 ring-ink-200" };
  return (
    <span className={`badge ${cfg.cls} ring-1 ring-inset flex-shrink-0`}>
      {cfg.label}
    </span>
  );
}


// ── Create modal ──────────────────────────────────────────────────

function CreateStaffModal({ catalog, onClose, onCreated }) {
  const [form, setForm] = useState({
    full_name: "", email: "", phone: "",
    // Start with the catalog's "default" preset selected. Admin can prune.
    permissions: new Set(catalog.default_keys),
  });
  const [busy, setBusy] = useState(false);
  const [usePreset, setUsePreset] = useState(true);  // when true, send null = legacy defaults

  const submit = async (e) => {
    e.preventDefault();
    if (form.full_name.trim().length < 2) {
      toast.error("Full name required"); return;
    }
    setBusy(true);
    try {
      const body = {
        full_name: form.full_name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        // null → backend applies legacy defaults; else explicit list.
        permissions: usePreset ? undefined : Array.from(form.permissions),
      };
      const r = await staffAPI.create(body);
      toast.success(`${r.data.username} created`);
      onCreated({
        username: r.data.username,
        password: r.data.password,
        full_name: r.data.full_name,
      });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Create failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="modal-box max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-ink-100 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="font-display text-lg font-bold text-navy">Add staff member</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Username and password are generated automatically.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="label">Full name <span className="text-red-500">*</span></span>
              <input value={form.full_name}
                     onChange={e => setForm(f => ({...f, full_name: e.target.value}))}
                     placeholder="Priya Iyer" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Email <span className="text-ink-400">(optional)</span></span>
              <input value={form.email} type="email"
                     onChange={e => setForm(f => ({...f, email: e.target.value}))}
                     placeholder="priya@yourlodge.com" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Phone <span className="text-ink-400">(optional)</span></span>
              <input value={form.phone}
                     onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                     placeholder="9876543210" className="input-field"/>
            </label>
          </div>

          <div>
            <label className="label">Permissions</label>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => setUsePreset(true)}
                      className={`flex-1 p-3 rounded-xl border-2 text-left text-sm transition-all ${
                        usePreset ? "border-gold bg-gold-50" : "border-ink-200 hover:border-ink-300"
                      }`}>
                <div className="font-display font-bold text-navy">Standard staff</div>
                <div className="text-2xs text-ink-500 mt-0.5">Full operational access (bookings, checkins, billing, …)</div>
              </button>
              <button type="button" onClick={() => setUsePreset(false)}
                      className={`flex-1 p-3 rounded-xl border-2 text-left text-sm transition-all ${
                        !usePreset ? "border-gold bg-gold-50" : "border-ink-200 hover:border-ink-300"
                      }`}>
                <div className="font-display font-bold text-navy">Custom permissions</div>
                <div className="text-2xs text-ink-500 mt-0.5">Pick exactly what they can do</div>
              </button>
            </div>
            {!usePreset && (
              <PermissionPicker catalog={catalog}
                                 selected={form.permissions}
                                 onChange={set => setForm(f => ({...f, permissions: set}))}/>
            )}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2 flex-shrink-0">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-gold flex items-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <UserPlus size={14}/>}
            Create staff
          </button>
        </div>
      </form>
    </div>
  );
}


// ── Edit modal ────────────────────────────────────────────────────

function EditStaffModal({ u, catalog, currentUserId, onClose, onUpdated, onPasswordReset }) {
  const [form, setForm] = useState({
    full_name: u.full_name || "",
    email: u.email || "",
    phone: u.phone || "",
    is_active: u.is_active,
    permissions: new Set(u.permissions_explicit || u.permissions_effective),
    uses_defaults: u.uses_legacy_defaults,
  });
  const [busy, setBusy] = useState(false);
  const isSelf = currentUserId === u.user_id;
  const isStaff = u.role === "staff";

  const save = async () => {
    setBusy(true);
    try {
      const patch = {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        is_active: form.is_active,
      };
      if (isStaff) {
        if (form.uses_defaults) {
          patch.reset_to_defaults = true;
        } else {
          patch.permissions = Array.from(form.permissions);
        }
      }
      await staffAPI.update(u.user_id, patch);
      toast.success("Saved");
      onUpdated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm(`Reset ${u.username}'s password? The new password will be shown once.`)) return;
    setBusy(true);
    try {
      const r = await staffAPI.resetPassword(u.user_id);
      onPasswordReset({ username: u.username, password: r.data.password, full_name: u.full_name });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reset failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
            className="modal-box max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-ink-100 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-display text-lg font-bold text-navy">{u.full_name}</h2>
              <RoleBadge role={u.role}/>
            </div>
            <p className="text-xs text-ink-500 font-mono">{u.username}</p>
          </div>
          <button onClick={onClose} className="btn-icon"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="label">Full name</span>
              <input value={form.full_name}
                     onChange={e => setForm(f => ({...f, full_name: e.target.value}))}
                     className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Email</span>
              <input value={form.email} type="email"
                     onChange={e => setForm(f => ({...f, email: e.target.value}))}
                     className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Phone</span>
              <input value={form.phone}
                     onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                     className="input-field"/>
            </label>
          </div>

          {/* Active toggle — disabled when editing self to prevent lockout */}
          <div className="card bg-ink-50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-navy text-sm">Account active</h3>
                <p className="text-2xs text-ink-500 mt-0.5">
                  {isSelf ? "You can't deactivate yourself" : "Inactive accounts cannot log in"}
                </p>
              </div>
              <button type="button" disabled={isSelf}
                      onClick={() => setForm(f => ({...f, is_active: !f.is_active}))}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        isSelf ? "bg-ink-200 cursor-not-allowed" :
                        form.is_active ? "bg-green-500" : "bg-ink-300"
                      }`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.is_active ? "translate-x-5" : "translate-x-0.5"
                }`}/>
              </button>
            </div>
          </div>

          {/* Permissions block: only meaningful for staff role */}
          {isStaff && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Permissions</label>
                <label className="text-xs text-ink-600 flex items-center gap-1.5">
                  <input type="checkbox" checked={form.uses_defaults}
                         onChange={e => setForm(f => ({...f, uses_defaults: e.target.checked,
                           permissions: e.target.checked ? new Set(catalog.default_keys) : f.permissions}))}
                         className="rounded"/>
                  Use defaults
                </label>
              </div>
              <PermissionPicker catalog={catalog}
                                 selected={form.permissions}
                                 disabled={form.uses_defaults}
                                 onChange={set => setForm(f => ({...f, permissions: set, uses_defaults: false}))}/>
            </div>
          )}

          {!isStaff && (
            <div className="card bg-gold-50 border-gold/30">
              <p className="text-sm text-ink-700">
                <ShieldCheck size={14} className="inline mr-1 text-gold-700"/>
                <strong>Admin</strong> and <strong>Super Admin</strong> users have full access by role.
                Permissions don't apply.
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2 flex-shrink-0">
          <button type="button" disabled={busy || isSelf}
                  onClick={reset}
                  className="btn-outline text-sm border-amber-300 text-amber-700 hover:bg-amber-50 hover:border-amber-500 flex items-center gap-1.5"
                  title={isSelf ? "Use Security page to change your own password" : "Generate a new password"}>
            <KeyRound size={13}/> Reset password
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="button" onClick={save} disabled={busy}
                    className="btn-gold flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Permission picker ─────────────────────────────────────────────

function PermissionPicker({ catalog, selected, disabled, onChange }) {
  // Group by section for readability.
  const groups = useMemo(() => {
    const out = {};
    catalog.permissions.forEach(p => {
      if (!out[p.group]) out[p.group] = [];
      out[p.group].push(p);
    });
    return out;
  }, [catalog]);

  const toggle = (key) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  const toggleAll = (groupKeys, value) => {
    if (disabled) return;
    const next = new Set(selected);
    groupKeys.forEach(k => value ? next.add(k) : next.delete(k));
    onChange(next);
  };

  return (
    <div className={`space-y-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {Object.entries(groups).map(([group, perms]) => {
        const keys = perms.map(p => p.key);
        const allOn = keys.every(k => selected.has(k));
        const anyOn = keys.some(k => selected.has(k));
        return (
          <div key={group} className="border border-ink-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-ink-50 border-b border-ink-200">
              <h4 className="font-display font-bold text-navy text-sm">{group}</h4>
              <button type="button" onClick={() => toggleAll(keys, !allOn)}
                      className="text-2xs font-semibold text-gold-700 hover:text-gold uppercase tracking-eyebrow">
                {allOn ? "Clear all" : anyOn ? "Select all" : "Select all"}
              </button>
            </div>
            <div className="p-3 space-y-1">
              {perms.map(p => (
                <label key={p.key}
                       className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50 cursor-pointer transition-colors">
                  <input type="checkbox" checked={selected.has(p.key)}
                         onChange={() => toggle(p.key)}
                         className="mt-0.5 rounded"/>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-navy">{p.label}</div>
                    <div className="text-2xs text-ink-500">{p.description}</div>
                  </div>
                  <span className="text-2xs font-mono text-ink-400 mt-1">{p.key}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ── Credentials reveal modal ──────────────────────────────────────

function CredentialsModal({ data, onClose }) {
  const copy = (t) => { navigator.clipboard.writeText(t); toast.success("Copied"); };
  const copyAll = () => {
    const block = `Rusto — Account credentials\n\nUser: ${data.full_name}\nUsername: ${data.username}\nPassword: ${data.password}\n\nLogin: ${window.location.origin}/login\n\nPlease change your password after first login.`;
    navigator.clipboard.writeText(block);
    toast.success("All details copied");
  };
  return (
    <div className="modal-backdrop">
      <div className="modal-box max-w-md">
        <div className="p-6 text-center border-b border-ink-100">
          <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center mb-4 shadow-gold animate-pop-in">
            <KeyRound size={28} className="text-white"/>
          </div>
          <h2 className="font-display text-xl font-bold text-navy">Credentials</h2>
          <p className="text-sm text-ink-500 mt-1">
            Capture now — the password won't be shown again.
          </p>
        </div>
        <div className="p-6 space-y-3">
          <CredRow label="Username" value={data.username} onCopy={() => copy(data.username)}/>
          <CredRow label="Password" value={data.password} onCopy={() => copy(data.password)} mono/>
          <button onClick={copyAll} className="btn-primary w-full mt-3 flex items-center justify-center gap-2">
            <Copy size={14}/> Copy all (formatted)
          </button>
        </div>
        <div className="px-6 py-4 border-t border-ink-100 flex justify-end">
          <button onClick={onClose} className="btn-gold">Done</button>
        </div>
      </div>
    </div>
  );
}

function CredRow({ label, value, mono, onCopy }) {
  return (
    <div className="flex items-center gap-2 bg-ink-50 rounded-xl p-3 border border-ink-200">
      <div className="flex-1 min-w-0">
        <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</div>
        <div className={`text-navy font-semibold truncate ${mono ? "font-mono" : ""}`}>{value}</div>
      </div>
      <button onClick={onCopy} className="btn-icon" title="Copy"><Copy size={14}/></button>
    </div>
  );
}
