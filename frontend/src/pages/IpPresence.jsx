import { useState, useEffect, useCallback } from "react";
import {
  MapPin, RefreshCw, Search, Globe, Clock, Users, Smartphone,
  User as UserIcon, Power, Loader2, Eye, Monitor,
} from "lucide-react";
import { toast } from "react-toastify";
import { ipPresenceAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * IP Presence — v11.2 (the platform owner's "who is online from where")
 *
 * Flag-gated: tracking only records data while the platform-level
 * `ip_tracking_enabled` setting is on (default OFF). Super admins can
 * toggle it here; lodge admins see the state read-only and only their
 * own lodge's staff rows.
 */

const PAGE_SIZE = 25;

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function IpPresence() {
  const { user } = useAuth();
  const isSuperAdmin = ["super_admin", "app_owner"].includes(user?.role);

  const [flag, setFlag] = useState(null);          // {enabled, can_toggle}
  const [toggling, setToggling] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actorType, setActorType] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchFlag = useCallback(async () => {
    try {
      const res = await ipPresenceAPI.getFlag();
      setFlag(res.data);
    } catch { /* non-fatal */ }
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        ipPresenceAPI.list({
          page, limit: PAGE_SIZE,
          search: search || undefined,
          actor_type: actorType || undefined,
        }),
        ipPresenceAPI.summary(),
      ]);
      setRows(list.data.data || []);
      setTotal(list.data.total || 0);
      setSummary(sum.data);
    } catch {
      toast.error("Failed to load IP presence data");
    } finally {
      setLoading(false);
    }
  }, [page, search, actorType]);

  useEffect(() => { fetchFlag(); }, [fetchFlag]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleToggle = async () => {
    if (!flag || !isSuperAdmin) return;
    setToggling(true);
    try {
      const next = !flag.enabled;
      await ipPresenceAPI.setFlag(next);
      setFlag(f => ({ ...f, enabled: next }));
      toast.success(next ? "IP presence tracking enabled" : "IP presence tracking disabled");
      fetchRows();
    } catch (e) {
      toast.error(e?.data?.detail || "Failed to toggle tracking");
    } finally {
      setToggling(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const enabled = flag?.enabled;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-navy flex items-center gap-2">
            <MapPin size={22} className="text-gold" /> IP Presence
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            Where users connect from, and how long they spend from each address
          </p>
        </div>
        <button
          onClick={fetchRows}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Flag banner */}
      {flag !== null && (
        <div className={`rounded-2xl border p-4 flex items-center gap-4 flex-wrap
          ${enabled ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
            ${enabled ? "bg-emerald-100" : "bg-amber-100"}`}>
            <Power size={18} className={enabled ? "text-emerald-600" : "text-amber-600"} />
          </div>
          <div className="flex-1 min-w-48">
            <p className={`font-semibold text-sm ${enabled ? "text-emerald-800" : "text-amber-800"}`}>
              IP presence tracking is {enabled ? "ON" : "OFF"}
            </p>
            <p className={`text-xs mt-0.5 ${enabled ? "text-emerald-700" : "text-amber-700"}`}>
              {enabled
                ? "Every authenticated request updates first/last seen and cumulative active time per user + IP."
                : isSuperAdmin
                  ? "No presence data is being recorded. Turn it on to start tracking."
                  : "No presence data is being recorded. Only the platform owner can enable tracking."}
            </p>
          </div>
          {isSuperAdmin ? (
            <button
              onClick={handleToggle}
              disabled={toggling}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60
                ${enabled
                  ? "bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                  : "bg-navy text-white hover:bg-navy/90"}`}
            >
              {toggling ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
              {enabled ? "Turn off" : "Turn on"}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-medium text-ink-500 bg-white/70 border border-ink-200 px-3 py-1.5 rounded-xl">
              <Eye size={12} /> Read-only
            </span>
          )}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Presence Records" value={summary.total_rows} icon={<MapPin size={18} />} color="blue" />
          <StatCard label="Distinct IPs" value={summary.distinct_ips} icon={<Globe size={18} />} color="green" />
          <StatCard label="Tracked Actors" value={summary.distinct_actors} icon={<Users size={18} />} color="amber" />
          <StatCard label="Active (30 min)" value={summary.online_last_30m} icon={<Clock size={18} />} color="red" />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              placeholder="Search by username, phone or IP…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold"
            />
          </div>
          {isSuperAdmin && (
            <select
              value={actorType}
              onChange={e => { setActorType(e.target.value); setPage(1); }}
              className="px-3 py-2 text-sm border border-ink-200 rounded-xl focus:outline-none focus:border-gold bg-white"
            >
              <option value="">Staff + Customers</option>
              <option value="user">Staff only</option>
              <option value="customer">Customers only</option>
            </select>
          )}
        </div>
      </div>

      {/* Presence table */}
      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-ink-50 border-b border-ink-100">
                {["User / Customer", "IP Address", "First Seen", "Last Seen",
                  "Time Spent", "Visits", "Last Device"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-ink-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-ink-400">
                    <MapPin size={34} className="mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium text-ink-500">No presence data yet</p>
                    <p className="text-xs mt-1 max-w-md mx-auto">
                      {enabled
                        ? "Rows appear here as users make authenticated requests — check back shortly."
                        : "This feature activates when IP presence tracking is enabled. Once on, every user's active time per IP address is recorded here."}
                    </p>
                  </td>
                </tr>
              ) : rows.map(r => (
                <tr key={r.presence_id} className="hover:bg-ink-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.actor_type === "customer"
                        ? <Smartphone size={13} className="text-purple-500 shrink-0" />
                        : <UserIcon size={13} className="text-blue-500 shrink-0" />}
                      <div>
                        <p className="text-sm text-ink-800">{r.username || `#${r.actor_id}`}</p>
                        <p className="text-2xs text-ink-400">
                          {r.actor_type === "customer" ? "customer" : `staff${r.lodge_id ? ` · lodge #${r.lodge_id}` : ""}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-ink-700 whitespace-nowrap">{r.ip_address}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{fmtTime(r.first_seen)}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{fmtTime(r.last_seen)}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-xs font-semibold text-navy bg-gold/10 px-2 py-1 rounded-lg w-fit whitespace-nowrap">
                      <Clock size={11} /> {r.total_time_human}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-700">{r.visit_count}</td>
                  <td className="px-4 py-3 max-w-52">
                    <p className="flex items-center gap-1.5 text-2xs text-ink-500 truncate" title={r.last_user_agent || ""}>
                      <Monitor size={11} className="shrink-0" /> {r.last_user_agent || "—"}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-ink-100 flex items-center justify-between">
            <p className="text-xs text-ink-500">Page {page} of {totalPages} · {total} total</p>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs border border-ink-200 rounded-lg disabled:opacity-40 hover:bg-ink-50">Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs border border-ink-200 rounded-lg disabled:opacity-40 hover:bg-ink-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Top IPs */}
      {summary?.top_ips?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-5">
          <h2 className="font-display text-lg font-bold text-navy mb-3 flex items-center gap-2">
            <Globe size={17} className="text-gold" /> Top IPs by Active Time
          </h2>
          <div className="space-y-2">
            {summary.top_ips.map((t, i) => (
              <div key={t.ip_address} className="flex items-center gap-3 p-2.5 rounded-lg bg-ink-50">
                <span className="w-6 h-6 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <p className="flex-1 text-sm font-mono text-ink-800">{t.ip_address}</p>
                <p className="text-xs text-ink-500">{t.actors} actor{t.actors !== 1 ? "s" : ""}</p>
                <span className="text-xs font-semibold text-navy bg-gold/10 px-2 py-1 rounded-lg">{t.total_time_human}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-ink-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colors[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-display font-bold text-ink-800">{value ?? "—"}</p>
        <p className="text-xs text-ink-500">{label}</p>
      </div>
    </div>
  );
}
