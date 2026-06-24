/**
 * StaffModuleAssignment.jsx
 * 
 * Admin page: for each staff member, admin chooses exactly which
 * modules (nav sections) they can access AND which permissions
 * (fine-grained actions within those modules) they can perform.
 *
 * Two-layer approach:
 *   Layer 1 — Module access:   What PAGES does this staff see in the sidebar?
 *   Layer 2 — Permission keys: What ACTIONS can they perform within those pages?
 *
 * This makes it crystal-clear: "Priya can see Housekeeping but can only
 * VIEW tasks, not REASSIGN them."
 *
 * Synced with backend:
 *   GET  /api/staff              — staff list with effective_permissions
 *   GET  /api/staff/permissions  — permission catalog grouped by section
 *   PATCH /api/staff/{id}        — update permissions array
 *   Settings `enabled_modules`   — per-lodge module set (already exists)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Users, ChevronDown, ChevronRight, CheckCircle2, XCircle,
  ShieldCheck, ShieldOff, Search, Loader2, Save, AlertTriangle,
  Eye, Edit2, RotateCcw, Info, BadgeCheck,
} from "lucide-react";
import { toast } from "react-toastify";
import { staffAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { ALL_MODULES, MODULE_NAV_ROUTES } from "../utils/moduleConfig";

// ── Permission → module mapping ─────────────────────────────────────
// Which module does each permission group belong to?
const PERM_MODULE_MAP = {
  "Front Desk":  ["front_desk"],
  "Operations":  ["housekeeping", "maintenance", "inventory", "shifts"],
  "Billing":     ["expenses"],
  "Insights":    ["reports"],
};

// Readable module labels for staff assignment
const MODULE_LABELS = {
  front_desk:    { icon: "🏨", label: "Front Desk",           desc: "Check-in, bookings, tape chart" },
  rooms:         { icon: "🛏️", label: "Room Management",       desc: "Room status and grid" },
  housekeeping:  { icon: "🧹", label: "Housekeeping",          desc: "Cleaning tasks and workflow" },
  maintenance:   { icon: "🔧", label: "Maintenance",           desc: "Issues, repairs, assets" },
  inventory:     { icon: "📦", label: "Inventory",             desc: "Stock counts and purchases" },
  shifts:        { icon: "⏱️", label: "Shifts",                desc: "Cash drawer and handover" },
  guests:        { icon: "🤝", label: "Guest Management",      desc: "Profiles and history" },
  loyalty:       { icon: "🏆", label: "Loyalty Programme",     desc: "Points and rewards" },
  foreign_guests:{ icon: "🛂", label: "C-Form",               desc: "Foreign guest registration" },
  feedback:      { icon: "⭐", label: "Guest Feedback",        desc: "Ratings and reviews" },
  alerts:        { icon: "🔔", label: "Notifications",         desc: "SMS and email alerts" },
  expenses:      { icon: "💰", label: "Expense Tracking",      desc: "Bills and payments" },
  reports:       { icon: "📊", label: "Reports & Analytics",   desc: "KPIs and occupancy" },
};

// Staff role badge
function RoleBadge({ role }) {
  const cfg = {
    admin:       { bg: "bg-navy/10",    text: "text-navy",   label: "Admin",      icon: <ShieldCheck size={10}/> },
    super_admin: { bg: "bg-gold/10",    text: "text-gold-700",label: "Super Admin",icon: <BadgeCheck size={10}/> },
    staff:       { bg: "bg-ink-100",    text: "text-ink-600", label: "Staff",     icon: <Users size={10}/> },
  };
  const c = cfg[role] || cfg.staff;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-bold ${c.bg} ${c.text}`}>
      {c.icon} {c.label}
    </span>
  );
}

// Toggle switch component
function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gold/40 ${
        on ? "bg-gold" : "bg-ink-200"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
      aria-checked={on}
      role="switch">
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
        on ? "translate-x-4" : "translate-x-0.5"
      }`}/>
    </button>
  );
}

// ── Main Component ──────────────────────────────────────────────────
export default function StaffModuleAssignment() {
  const { user, isAdmin } = useAuth();
  const [staff, setStaff]       = useState([]);
  const [catalog, setCatalog]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [selected, setSelected] = useState(null); // staff user being edited
  const [saving, setSaving]     = useState(false);
  const [draft, setDraft]       = useState(null); // {modules: Set, permissions: Set}
  const [expandedGroups, setExpandedGroups] = useState({});

  // Load staff + permission catalog
  useEffect(() => {
    Promise.all([
      staffAPI.list({ include_inactive: false }),
      staffAPI.permissionCatalog(),
    ]).then(([sl, pc]) => {
      setStaff(sl.data || []);
      setCatalog(pc.data);
    }).catch(() => toast.error("Failed to load staff"))
      .finally(() => setLoading(false));
  }, []);

  // When user selects a staff member, build a draft from their current effective permissions
  const selectStaff = useCallback((member) => {
    setSelected(member);
    const effectivePerms = new Set(member.permissions_effective || []);
    // Infer which modules they have access to from their permissions
    const inferredModules = new Set();
    if (catalog?.permissions) {
      for (const [group, modIds] of Object.entries(PERM_MODULE_MAP)) {
        const groupPerms = catalog.permissions
          .filter(p => p.group === group)
          .map(p => p.key);
        const hasAny = groupPerms.some(k => effectivePerms.has(k));
        if (hasAny) modIds.forEach(m => inferredModules.add(m));
      }
    }
    // Front desk and rooms always visible if any permissions at all
    if (effectivePerms.has("bookings.read") || effectivePerms.has("checkins.read")) {
      inferredModules.add("front_desk");
      inferredModules.add("rooms");
    }
    setDraft({ modules: inferredModules, permissions: effectivePerms });
    setExpandedGroups({});
  }, [catalog]);

  // Toggle a module on/off — also toggles related permissions
  const toggleModule = useCallback((moduleId) => {
    if (!draft || !catalog) return;
    const newModules = new Set(draft.modules);
    const newPerms   = new Set(draft.permissions);
    const isOn = newModules.has(moduleId);

    if (isOn) {
      newModules.delete(moduleId);
      // Remove permissions that belong exclusively to this module
      const relatedGroups = Object.entries(PERM_MODULE_MAP)
        .filter(([, mods]) => mods.includes(moduleId))
        .map(([grp]) => grp);
      if (relatedGroups.length > 0 && catalog.permissions) {
        const toRemove = catalog.permissions
          .filter(p => relatedGroups.includes(p.group))
          .map(p => p.key);
        toRemove.forEach(k => newPerms.delete(k));
      }
    } else {
      newModules.add(moduleId);
      // Auto-add read permissions for this module
      const relatedGroups = Object.entries(PERM_MODULE_MAP)
        .filter(([, mods]) => mods.includes(moduleId))
        .map(([grp]) => grp);
      if (relatedGroups.length > 0 && catalog.permissions) {
        const readPerms = catalog.permissions
          .filter(p => relatedGroups.includes(p.group) && p.key.endsWith(".read"))
          .map(p => p.key);
        readPerms.forEach(k => newPerms.add(k));
      }
    }
    setDraft({ modules: newModules, permissions: newPerms });
  }, [draft, catalog]);

  // Toggle a single permission key
  const togglePerm = useCallback((key) => {
    if (!draft) return;
    const newPerms = new Set(draft.permissions);
    newPerms.has(key) ? newPerms.delete(key) : newPerms.add(key);
    setDraft(d => ({ ...d, permissions: newPerms }));
  }, [draft]);

  // Save changes to backend
  const save = useCallback(async () => {
    if (!selected || !draft) return;
    setSaving(true);
    try {
      await staffAPI.update(selected.user_id, {
        permissions: [...draft.permissions],
      });
      // Refresh the staff member's record
      const updated = await staffAPI.get(selected.user_id);
      setStaff(prev => prev.map(s => s.user_id === selected.user_id ? updated.data : s));
      setSelected(updated.data);
      toast.success(`Permissions saved for ${selected.full_name}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save permissions");
    } finally { setSaving(false); }
  }, [selected, draft]);

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    if (!catalog) return;
    const defaultKeys = new Set(catalog.default_keys || []);
    const defaultMods = new Set(["front_desk", "rooms", "housekeeping", "maintenance", "guests", "feedback"]);
    setDraft({ modules: defaultMods, permissions: defaultKeys });
  }, [catalog]);

  const filteredStaff = useMemo(() =>
    staff.filter(s =>
      s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.username?.toLowerCase().includes(search.toLowerCase())
    ),
    [staff, search]
  );

  // Group permissions by their group label
  const groupedPerms = useMemo(() => {
    if (!catalog?.permissions) return {};
    const groups = {};
    catalog.permissions.forEach(p => {
      if (!groups[p.group]) groups[p.group] = [];
      groups[p.group].push(p);
    });
    return groups;
  }, [catalog]);

  if (!isAdmin) return (
    <div className="card text-center py-16 max-w-md mx-auto mt-12">
      <ShieldOff size={40} className="mx-auto text-ink-300 mb-4"/>
      <h2 className="font-display text-xl font-bold text-navy">Admin access required</h2>
      <p className="text-ink-500 mt-2">Only lodge administrators can manage staff access.</p>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={32} className="animate-spin text-gold"/>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-navy flex items-center gap-2">
            <ShieldCheck size={22} className="text-gold"/> Staff Access Control
          </h1>
          <p className="text-ink-500 text-sm mt-1">
            Choose exactly which modules each staff member can see, and what actions they can take.
          </p>
        </div>
        {/* Legend */}
        <div className="hidden lg:flex items-center gap-4 text-xs text-ink-500 bg-ink-50 rounded-xl px-4 py-2 border border-ink-200">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gold inline-block"/>Module access (nav visibility)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-navy inline-block"/>Action permission (what they can do)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">

        {/* ── Staff list ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search staff..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-ink-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
            />
          </div>

          {/* Staff cards */}
          <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {filteredStaff.length === 0 && (
              <p className="text-ink-400 text-sm text-center py-8">No staff found</p>
            )}
            {filteredStaff.map(member => {
              const isActive  = member.is_active;
              const isSelected = selected?.user_id === member.user_id;
              const permCount  = member.permissions_effective?.length ?? 0;
              return (
                <button
                  key={member.user_id}
                  onClick={() => selectStaff(member)}
                  className={`w-full text-left p-4 rounded-xl border transition-all duration-150 ${
                    isSelected
                      ? "border-gold bg-gold/5 shadow-gold/20 shadow-md"
                      : "border-ink-200 bg-white hover:border-ink-300 hover:shadow-soft"
                  } ${!isActive ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                        isSelected ? "bg-gold text-navy-dark" : "bg-ink-100 text-ink-600"
                      }`}>
                        {member.full_name?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div>
                        <p className="font-semibold text-navy text-sm leading-tight">{member.full_name}</p>
                        <p className="text-2xs text-ink-400 font-mono">{member.username}</p>
                      </div>
                    </div>
                    <RoleBadge role={member.role}/>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {!isActive && (
                      <span className="text-2xs text-ink-400 bg-ink-50 px-2 py-0.5 rounded-full border border-ink-200">Inactive</span>
                    )}
                    {member.role === "staff" && (
                      <span className="text-2xs text-ink-500">
                        {permCount} permission{permCount !== 1 ? "s" : ""}
                      </span>
                    )}
                    {member.uses_legacy_defaults && (
                      <span className="text-2xs text-gold-700 bg-gold/10 px-2 py-0.5 rounded-full">Default</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Permissions editor ──────────────────────────────── */}
        {!selected ? (
          <div className="flex flex-col items-center justify-center text-center py-20 bg-white rounded-2xl border border-ink-200">
            <div className="w-16 h-16 rounded-2xl bg-ink-50 flex items-center justify-center mb-4">
              <Users size={28} className="text-ink-300"/>
            </div>
            <h3 className="font-display text-lg font-bold text-navy mb-2">Select a staff member</h3>
            <p className="text-ink-500 text-sm max-w-xs">
              Click any staff member on the left to view and edit their module access and permissions.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 bg-ink-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center font-bold text-gold">
                  {selected.full_name?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-navy text-base">{selected.full_name}</p>
                  <p className="text-2xs text-ink-400 font-mono">{selected.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={resetToDefaults}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-ink-600 bg-white border border-ink-200 rounded-lg hover:border-ink-300 transition-colors">
                  <RotateCcw size={12}/> Reset defaults
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-gold text-navy-dark rounded-xl hover:bg-gold-light transition-colors disabled:opacity-60 shadow-gold">
                  {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                  Save changes
                </button>
              </div>
            </div>

            <div className="p-6 space-y-7 max-h-[calc(100vh-240px)] overflow-y-auto">

              {selected.role !== "staff" && (
                <div className="flex items-start gap-3 p-4 bg-navy/5 border border-navy/15 rounded-xl">
                  <Info size={16} className="text-navy flex-shrink-0 mt-0.5"/>
                  <p className="text-sm text-navy/80">
                    <strong>{selected.role === "admin" ? "Admin" : "Super Admin"}s</strong> have
                    unrestricted access to all modules and actions — permissions cannot be restricted.
                  </p>
                </div>
              )}

              {/* ── Layer 1: Module access ──────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-md bg-gold/15 flex items-center justify-center">
                    <Eye size={12} className="text-gold-700"/>
                  </div>
                  <h3 className="font-bold text-navy text-base">Module visibility</h3>
                  <span className="text-2xs text-ink-400 bg-ink-100 px-2 py-0.5 rounded-full ml-1">
                    Which pages appear in their sidebar
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Object.entries(MODULE_LABELS).map(([id, cfg]) => {
                    const isOn       = draft?.modules.has(id) ?? false;
                    const isDisabled = selected.role !== "staff";
                    const isCoreAlways = id === "front_desk" || id === "rooms";
                    return (
                      <label
                        key={id}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-150 ${
                          isOn
                            ? "border-gold bg-gold/5"
                            : "border-ink-200 bg-ink-50/50 hover:border-ink-300"
                        } ${isDisabled ? "cursor-not-allowed" : ""}`}>
                        <Toggle on={isOn} onChange={() => toggleModule(id)} disabled={isDisabled || isCoreAlways}/>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-navy truncate">
                            <span className="mr-1">{cfg.icon}</span>{cfg.label}
                          </p>
                          <p className="text-2xs text-ink-400 truncate">{cfg.desc}</p>
                        </div>
                        {isCoreAlways && (
                          <span className="text-2xs text-ink-400 flex-shrink-0">Core</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>

              {/* ── Layer 2: Fine-grained permissions ──────────── */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-md bg-navy/10 flex items-center justify-center">
                    <Edit2 size={12} className="text-navy"/>
                  </div>
                  <h3 className="font-bold text-navy text-base">Action permissions</h3>
                  <span className="text-2xs text-ink-400 bg-ink-100 px-2 py-0.5 rounded-full ml-1">
                    What they can do within each module
                  </span>
                </div>

                <div className="space-y-3">
                  {Object.entries(groupedPerms).map(([group, perms]) => {
                    const isExpanded = expandedGroups[group] ?? true;
                    const enabledCount = perms.filter(p => draft?.permissions.has(p.key)).length;
                    return (
                      <div key={group} className="border border-ink-200 rounded-xl overflow-hidden">
                        <button
                          onClick={() => setExpandedGroups(eg => ({ ...eg, [group]: !isExpanded }))}
                          className="w-full flex items-center justify-between px-4 py-3 bg-ink-50/60 hover:bg-ink-50 transition-colors">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown size={14} className="text-ink-400"/> : <ChevronRight size={14} className="text-ink-400"/>}
                            <span className="font-bold text-navy text-sm">{group}</span>
                            <span className="text-2xs text-ink-400">
                              {enabledCount}/{perms.length} enabled
                            </span>
                          </div>
                          {/* Quick toggles: all / none */}
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => {
                                if (!draft || selected.role !== "staff") return;
                                setDraft(d => {
                                  const np = new Set(d.permissions);
                                  perms.forEach(p => np.add(p.key));
                                  return { ...d, permissions: np };
                                });
                              }}
                              className="text-2xs text-gold-700 font-semibold hover:underline px-1.5 py-0.5 rounded hover:bg-gold/10 transition-colors">
                              All
                            </button>
                            <span className="text-ink-200">|</span>
                            <button
                              onClick={() => {
                                if (!draft || selected.role !== "staff") return;
                                setDraft(d => {
                                  const np = new Set(d.permissions);
                                  perms.forEach(p => np.delete(p.key));
                                  return { ...d, permissions: np };
                                });
                              }}
                              className="text-2xs text-ink-500 font-semibold hover:underline px-1.5 py-0.5 rounded hover:bg-ink-100 transition-colors">
                              None
                            </button>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="divide-y divide-ink-100">
                            {perms.map(perm => {
                              const isOn = draft?.permissions.has(perm.key) ?? false;
                              const isDisabled = selected.role !== "staff";
                              return (
                                <label
                                  key={perm.key}
                                  className={`flex items-center gap-4 px-4 py-3 transition-colors ${
                                    isDisabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-ink-50/50"
                                  } ${isOn ? "bg-gold/3" : ""}`}>
                                  <Toggle on={isOn} onChange={() => togglePerm(perm.key)} disabled={isDisabled}/>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-navy">{perm.label}</p>
                                    <p className="text-2xs text-ink-400 mt-0.5">{perm.description}</p>
                                  </div>
                                  <code className="text-2xs text-ink-400 font-mono bg-ink-100 px-2 py-0.5 rounded flex-shrink-0">
                                    {perm.key}
                                  </code>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Summary */}
              {draft && (
                <div className="flex items-center gap-3 p-4 bg-navy/3 border border-navy/10 rounded-xl">
                  <CheckCircle2 size={16} className="text-navy flex-shrink-0"/>
                  <p className="text-sm text-navy/80">
                    <strong>{selected.full_name}</strong> will have access to{" "}
                    <strong>{draft.modules.size} module{draft.modules.size !== 1 ? "s" : ""}</strong> and{" "}
                    <strong>{draft.permissions.size} permission{draft.permissions.size !== 1 ? "s" : ""}</strong>.
                    {" "}Save to apply.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
