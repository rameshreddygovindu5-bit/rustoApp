import { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck, ScrollText, KeyRound, RefreshCw, Search, ChevronDown,
  ChevronRight, CheckCircle, XCircle, Globe, Smartphone, User as UserIcon,
} from "lucide-react";
import { toast } from "react-toastify";
import { auditAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Audit Console — v11.2
 *
 * Tabs:
 *   Audit Trail    — super admin: cross-lodge /audit/all;
 *                    lodge admin:  lodge-scoped /audit list.
 *   Login Activity — /audit/logins (staff + customer login history with
 *                    real client IPs; lodge admins see own staff only).
 */

const PAGE_SIZE = 25;

const METHOD_BADGES = {
  password: "bg-blue-50 text-blue-700",
  otp:      "bg-purple-50 text-purple-700",
  pin:      "bg-indigo-50 text-indigo-700",
  totp:     "bg-teal-50 text-teal-700",
  signup:   "bg-emerald-50 text-emerald-700",
};

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function DetailsCell({ details }) {
  const [open, setOpen] = useState(false);
  if (!details) return <span className="text-xs text-ink-300">—</span>;
  let pretty = details;
  try { pretty = JSON.stringify(JSON.parse(details), null, 2); } catch { /* keep raw */ }
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-ink-500 hover:text-navy transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} details
      </button>
      {open && (
        <pre className="mt-1 text-2xs bg-ink-50 border border-ink-100 rounded-lg p-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-all">
          {pretty}
        </pre>
      )}
    </div>
  );
}

// ── Audit Trail tab ────────────────────────────────────────────────────
function AuditTrailTab({ isSuperAdmin }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: "", action: "", actor: "", ip: "", lodge_id: "", from_date: "", to_date: "",
  });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      let res;
      if (isSuperAdmin) {
        res = await auditAPI.all({
          page, limit: PAGE_SIZE,
          search:   filters.search || undefined,
          action:   filters.action || undefined,
          actor:    filters.actor || undefined,
          ip:       filters.ip || undefined,
          lodge_id: filters.lodge_id || undefined,
          from_date: filters.from_date || undefined,
          to_date:   filters.to_date || undefined,
        });
      } else {
        // Lodge admins fall back to the lodge-scoped audit list.
        res = await auditAPI.list({
          page, limit: PAGE_SIZE,
          action:         filters.action || undefined,
          actor_username: filters.actor || undefined,
          from_date:      filters.from_date || undefined,
          to_date:        filters.to_date || undefined,
        });
      }
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error("Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, page, filters]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const setF = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const cols = isSuperAdmin ? 7 : 6;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-4">
        <div className="flex flex-wrap gap-3">
          {isSuperAdmin && (
            <div className="relative flex-1 min-w-44">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                type="text" placeholder="Search action / actor / IP / details…"
                value={filters.search} onChange={e => setF("search", e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
              />
            </div>
          )}
          <input
            type="text" placeholder="Action prefix (e.g. auth.)"
            value={filters.action} onChange={e => setF("action", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-44"
          />
          <input
            type="text" placeholder="Actor"
            value={filters.actor} onChange={e => setF("actor", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-32"
          />
          {isSuperAdmin && (
            <>
              <input
                type="text" placeholder="IP address"
                value={filters.ip} onChange={e => setF("ip", e.target.value)}
                className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-36"
              />
              <input
                type="number" placeholder="Lodge ID"
                value={filters.lodge_id} onChange={e => setF("lodge_id", e.target.value)}
                className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-24"
              />
            </>
          )}
          <input
            type="date" value={filters.from_date} onChange={e => setF("from_date", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
          />
          <input
            type="date" value={filters.to_date} onChange={e => setF("to_date", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
          />
          <button
            onClick={fetchRows}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-ink-50 border-b border-ink-100">
                {["Time", "Actor", "Action", "Entity", "IP",
                  ...(isSuperAdmin ? ["Lodge"] : []), "Details"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading ? (
                Array(8).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(cols).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-ink-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-4 py-12 text-center text-ink-400">
                    <ScrollText size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No audit entries match these filters</p>
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-ink-50 transition-colors align-top">
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-ink-800">{r.actor_username || "—"}</p>
                    {r.actor_type && r.actor_type !== "user" && (
                      <span className="text-2xs text-purple-600">{r.actor_type}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-ink-700 bg-ink-100 px-2 py-1 rounded-lg whitespace-nowrap">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap">
                    {r.entity_type ? `${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-ink-600 whitespace-nowrap">{r.ip_address || "—"}</td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap">
                      {r.lodge_name || (r.lodge_id != null ? `#${r.lodge_id}` : "—")}
                    </td>
                  )}
                  <td className="px-4 py-3"><DetailsCell details={r.details} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} setPage={setPage} />
      </div>
    </div>
  );
}

// ── Login Activity tab ─────────────────────────────────────────────────
function LoginActivityTab({ isSuperAdmin }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    actor_type: "", success: "", ip: "", username: "", from_date: "", to_date: "",
  });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await auditAPI.logins({
        page, limit: PAGE_SIZE,
        actor_type: filters.actor_type || undefined,
        success:    filters.success === "" ? undefined : filters.success === "true",
        ip:         filters.ip || undefined,
        username:   filters.username || undefined,
        from_date:  filters.from_date || undefined,
        to_date:    filters.to_date || undefined,
      });
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error("Failed to load login activity");
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const setF = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const cols = isSuperAdmin ? 7 : 6;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-4">
        <div className="flex flex-wrap gap-3">
          {isSuperAdmin && (
            <select
              value={filters.actor_type} onChange={e => setF("actor_type", e.target.value)}
              className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold bg-white"
            >
              <option value="">Staff + Customers</option>
              <option value="user">Staff only</option>
              <option value="customer">Customers only</option>
            </select>
          )}
          <select
            value={filters.success} onChange={e => setF("success", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold bg-white"
          >
            <option value="">All results</option>
            <option value="true">Successful</option>
            <option value="false">Failed</option>
          </select>
          <input
            type="text" placeholder="Username / phone"
            value={filters.username} onChange={e => setF("username", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-40"
          />
          <input
            type="text" placeholder="IP address"
            value={filters.ip} onChange={e => setF("ip", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold w-36"
          />
          <input
            type="date" value={filters.from_date} onChange={e => setF("from_date", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
          />
          <input
            type="date" value={filters.to_date} onChange={e => setF("to_date", e.target.value)}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
          />
          <button
            onClick={fetchRows}
            className="px-3 py-2 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-ink-50 border-b border-ink-100">
                {["Time", "Actor", "Result", "Method", "IP",
                  ...(isSuperAdmin ? ["Lodge"] : []), "Device"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading ? (
                Array(8).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(cols).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-ink-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-4 py-12 text-center text-ink-400">
                    <KeyRound size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No login events match these filters</p>
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.event_id} className="hover:bg-ink-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{fmtTime(r.occurred_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.actor_type === "customer"
                        ? <Smartphone size={13} className="text-purple-500 shrink-0" />
                        : <UserIcon size={13} className="text-blue-500 shrink-0" />}
                      <div>
                        <p className="text-sm text-ink-800">{r.username || "—"}</p>
                        <p className="text-2xs text-ink-400">{r.actor_type}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.success ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-lg w-fit">
                        <CheckCircle size={11} /> Success
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-1 rounded-lg w-fit">
                        <XCircle size={11} /> Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-lg ${METHOD_BADGES[r.method] || "bg-ink-100 text-ink-600"}`}>
                      {r.method || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-ink-600 whitespace-nowrap">{r.ip_address || "—"}</td>
                  {isSuperAdmin && (
                    <td className="px-4 py-3 text-xs text-ink-600 whitespace-nowrap">
                      {r.lodge_name || (r.lodge_id != null ? `#${r.lodge_id}` : "—")}
                    </td>
                  )}
                  <td className="px-4 py-3 max-w-56">
                    <p className="text-2xs text-ink-500 truncate" title={r.user_agent || ""}>
                      {r.user_agent || "—"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} setPage={setPage} />
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, total, setPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="px-6 py-3 border-t border-ink-100 flex items-center justify-between">
      <p className="text-xs text-ink-500">Page {page} of {totalPages} · {total} total</p>
      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
          className="px-3 py-1.5 text-xs border border-ink-200 rounded-lg disabled:opacity-40 hover:bg-ink-50">Prev</button>
        <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
          className="px-3 py-1.5 text-xs border border-ink-200 rounded-lg disabled:opacity-40 hover:bg-ink-50">Next</button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────
export default function AuditConsole() {
  const { user } = useAuth();
  const isSuperAdmin = ["super_admin", "app_owner"].includes(user?.role);
  const [tab, setTab] = useState("trail");

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-navy flex items-center gap-2">
          <ShieldCheck size={22} className="text-gold" /> Audit Console
        </h1>
        <p className="text-sm text-ink-500 mt-0.5">
          {isSuperAdmin
            ? "Cross-lodge audit trail and login activity with real client IPs"
            : "Your lodge's audit trail and staff login activity"}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-ink-200">
        {[
          { key: "trail",  label: "Audit Trail",    icon: ScrollText },
          { key: "logins", label: "Login Activity", icon: KeyRound },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap
              ${tab === t.key ? "border-gold text-navy" : "border-transparent text-ink-500 hover:text-navy"}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "trail" && <AuditTrailTab isSuperAdmin={isSuperAdmin} />}
      {tab === "logins" && <LoginActivityTab isSuperAdmin={isSuperAdmin} />}

      <p className="text-2xs text-ink-400 flex items-center gap-1">
        <Globe size={11} /> IPs are the real client address (X-Forwarded-For honoured only behind the trusted reverse proxy).
      </p>
    </div>
  );
}
