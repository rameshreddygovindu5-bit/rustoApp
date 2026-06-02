import { useState, useEffect, useCallback } from "react";
import { Bell, Send, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Filter, Search, MessageSquare, Mail, Info } from "lucide-react";
import { api } from "../services/api";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";

const EVENT_TYPES = [
  { value: "", label: "All Events" },
  { value: "checkin", label: "Check-in" },
  { value: "checkout", label: "Checkout" },
  { value: "booking", label: "Booking" },
  { value: "booking_cancelled", label: "Booking Cancelled" },
  { value: "reminder", label: "Reminder" },
  { value: "overdue", label: "Overdue" },
  { value: "daily_summary", label: "Daily Summary" },
  { value: "custom", label: "Custom / Test" },
];

export default function Alerts() {
  const { user, isAdmin } = useAuth();

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCompose, setShowCompose] = useState(false);
  const [stats, setStats] = useState(null);
  const pageSize = 20;

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: pageSize });
      if (search) params.set("search", search);
      if (typeFilter) params.set("event_type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      const data = await api.get(`/alerts?${params}`);
      setAlerts(data.data || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, statusFilter]);

  const fetchStats = async () => {
    try {
      const data = await api.get("/alerts/stats");
      setStats(data);
    } catch {}
  };

  useEffect(() => {
    fetchAlerts();
    fetchStats();
  }, [fetchAlerts]);

  // Refetch when the AI agent queues a custom SMS/email alert.
  useEffect(() => {
    const onAgentChange = () => { fetchAlerts(); fetchStats(); };
    window.addEventListener('lms:agent:data_changed', onAgentChange);
    return () => window.removeEventListener('lms:agent:data_changed', onAgentChange);
  }, [fetchAlerts]);

  const handleRetry = async (alertId) => {
    try {
      await api.post(`/alerts/${alertId}/retry`);
      toast.success("Alert queued for retry");
      fetchAlerts();
    } catch {
      toast.error("Retry failed");
    }
  };

  const handleRetryAll = async () => {
    try {
      const result = await api.post("/alerts/retry-failed");
      if (result.queued === 0) {
        toast.info("No failed alerts to retry");
      } else {
        toast.success(`Retried ${result.queued} alert(s) — ${result.sent || 0} sent`);
      }
      fetchAlerts();
    } catch {
      toast.error("Bulk retry failed");
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-2xl font-bold text-navy">Alert Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor and manage all notifications</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRetryAll}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} /> Retry Failed
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowCompose(true)}
              className="btn-gold flex items-center gap-2"
            >
              <Send size={14} /> Send Alert
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Sent" value={stats.reduce((a, b) => a + b.count, 0)} icon={<Bell size={18} />} color="blue" />
          <StatCard label="Delivered" value={stats.filter(s => s.status === "sent").reduce((a, b) => a + b.count, 0)} icon={<CheckCircle size={18} />} color="green" />
          <StatCard label="Failed" value={stats.filter(s => s.status === "failed").reduce((a, b) => a + b.count, 0)} icon={<XCircle size={18} />} color="red" />
          <StatCard label="Skipped" value={stats.filter(s => s.status === "skipped").reduce((a, b) => a + b.count, 0)} icon={<AlertTriangle size={18} />} color="amber" />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search alerts..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white"
          >
            {EVENT_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white"
          >
            <option value="">All Status</option>
            <option value="sent">Delivered</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="pending">Pending</option>
          </select>
          <button
            onClick={fetchAlerts}
            className="px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Alert Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Type</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Channel</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Recipient</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Message</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Time</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array(6).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-gray-100 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    <Bell size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No alerts found</p>
                  </td>
                </tr>
              ) : (
                alerts.map(alert => (
                  <tr key={alert.alert_id} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-6 py-4">
                      <span className="text-xs font-medium text-gray-700 bg-gray-100 px-2 py-1 rounded-lg">
                        {alert.event_type?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <ChannelBadge channel={alert.alert_type} />
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-800">{alert.recipient || "—"}</p>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-sm text-gray-600 truncate">{alert.message_content}</p>
                    </td>
                    <td className="px-6 py-4">
                      <AlertStatusBadge status={alert.status} error={alert.error_message} />
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
                      {new Date(alert.created_at).toLocaleString("en-IN", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                      })}
                    </td>
                    <td className="px-6 py-4">
                      {alert.status === "failed" && isAdmin && (
                        <button
                          onClick={() => handleRetry(alert.alert_id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <RefreshCw size={11} /> Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">Page {page} of {totalPages} · {total} total</p>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Compose Alert Modal */}
      {showCompose && (
        <ComposeAlertModal onClose={() => setShowCompose(false)} onSent={() => { setShowCompose(false); fetchAlerts(); fetchStats(); }} />
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colors[color]}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-playfair font-bold text-gray-800">{value ?? "—"}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

function ChannelBadge({ channel }) {
  if (channel === "sms") return (
    <span className="flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded-lg">
      <MessageSquare size={11} /> SMS
    </span>
  );
  if (channel === "email") return (
    <span className="flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 px-2 py-1 rounded-lg">
      <Mail size={11} /> Email
    </span>
  );
  return <span className="text-xs text-gray-400 italic">{channel || "—"}</span>;
}

function AlertStatusBadge({ status, error }) {
  const map = {
    sent: { cls: "bg-green-100 text-green-700", icon: <CheckCircle size={11} />, label: "Sent" },
    failed: { cls: "bg-red-100 text-red-700", icon: <XCircle size={11} />, label: "Failed" },
    skipped: { cls: "bg-gray-100 text-gray-600", icon: <AlertTriangle size={11} />, label: "Skipped" },
    pending: { cls: "bg-amber-100 text-amber-700", icon: <Clock size={11} />, label: "Pending" },
  };
  const s = map[status] || { cls: "bg-gray-100 text-gray-600", icon: null, label: status };
  return (
    <div className="flex items-center gap-1.5">
      <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg ${s.cls}`}>
        {s.icon} {s.label}
      </span>
      {error && (
        <div className="group relative">
          <Info
            size={12}
            className={`cursor-help ${status === "sent" ? "text-gray-400" : "text-red-400"}`}
          />
          <div className="absolute bottom-full left-0 mb-1 w-64 bg-gray-800 text-white text-xs rounded-lg p-2 hidden group-hover:block z-10 shadow-lg break-words">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeAlertModal({ onClose, onSent }) {
  const [form, setForm] = useState({ channel: "sms", recipient: "", subject: "", message: "" });
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!form.recipient || !form.message) {
      toast.error("Recipient and message are required");
      return;
    }
    setSending(true);
    try {
      // Backend endpoint is POST /alerts/custom and expects `type` (not
      // `channel`). Map the form to the backend's contract.
      await api.post("/alerts/custom", {
        type: form.channel,
        recipient: form.recipient,
        message: form.message,
        subject: form.channel === "email" ? (form.subject || "Message from Hotel") : undefined,
      });
      toast.success("Alert sent successfully!");
      onSent();
    } catch (err) {
      toast.error(err.message || err?.data?.detail || "Failed to send alert");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-slide-up">
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between">
          <h3 className="font-playfair text-lg font-bold">Send Custom Alert</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XCircle size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Channel</label>
            <div className="flex gap-3">
              {[["sms", "SMS", <MessageSquare size={14} />], ["email", "Email", <Mail size={14} />]].map(([val, label, icon]) => (
                <button
                  key={val}
                  onClick={() => setForm(f => ({ ...f, channel: val }))}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${
                    form.channel === val
                      ? "border-navy bg-navy text-white"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              {form.channel === "sms" ? "Phone Number" : "Email Address"}
            </label>
            <input
              type={form.channel === "email" ? "email" : "tel"}
              placeholder={form.channel === "sms" ? "+91 XXXXXXXXXX" : "guest@example.com"}
              value={form.recipient}
              onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
            />
          </div>
          {form.channel === "email" && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Subject</label>
              <input
                type="text"
                placeholder="Message from Hotel"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Message</label>
            <textarea
              rows={4}
              placeholder="Enter alert message..."
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold resize-none"
            />
            {form.channel === "sms" && (
              <p className="text-xs text-gray-400 mt-1">{form.message.length} chars</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-700 text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex-1 py-2.5 bg-navy text-white rounded-xl text-sm font-semibold hover:bg-navy/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {sending ? "Sending..." : <><Send size={14} /> Send</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
