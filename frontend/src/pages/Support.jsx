import React, { useState, useEffect, useRef } from "react";
import { LifeBuoy, Plus, MessageSquare, Send, X, CheckCircle2,
         Clock, AlertCircle, Hash, Building2, User, RefreshCw,
         ArrowLeft } from "lucide-react";
import { toast } from "react-toastify";
import { supportAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Support tickets — adapts UI by viewer role.
 *
 * Lodge admin / staff:  "Reach Out" — list their tickets + "New ticket"
 *                       form. Cannot change priority or assignee.
 * Super-admin:          Full inbox across all lodges. Filter by status,
 *                       category, priority. Can update priority/assignee.
 *
 * A selected ticket opens a chat-style thread on the right (desktop) or
 * full-screen (mobile). Both sides can post messages; the backend
 * automatically transitions status (open → awaiting_lodge → open) so
 * neither side has to think about workflow.
 */

const CATEGORIES = [
  { value: "technical", label: "Technical", icon: "🔧" },
  { value: "billing", label: "Billing", icon: "💰" },
  { value: "feature_request", label: "Feature Request", icon: "💡" },
  { value: "account", label: "Account", icon: "👤" },
  { value: "other", label: "Other", icon: "📋" },
];

const PRIORITIES = [
  { value: "low", label: "Low", cls: "bg-ink-100 text-ink-700" },
  { value: "normal", label: "Normal", cls: "bg-blue-50 text-blue-700" },
  { value: "high", label: "High", cls: "bg-amber-50 text-amber-700" },
  { value: "urgent", label: "Urgent", cls: "bg-red-50 text-red-700" },
];

const STATUS_CFG = {
  open:            { label: "Open",            cls: "bg-amber-50  text-amber-800  ring-amber-200",  icon: <AlertCircle size={11}/> },
  awaiting_lodge:  { label: "Awaiting Lodge",  cls: "bg-blue-50   text-blue-800   ring-blue-200",   icon: <Clock size={11}/> },
  resolved:        { label: "Resolved",        cls: "bg-green-50  text-green-800  ring-green-200",  icon: <CheckCircle2 size={11}/> },
  closed:          { label: "Closed",          cls: "bg-ink-100   text-ink-700    ring-ink-200",    icon: <X size={11}/> },
};

export default function Support() {
  const { user, isSuperAdmin } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "", category: "", priority: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);     // full ticket with messages
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [listR, statsR] = await Promise.all([
        supportAPI.list({
          ...(filter.status   ? { status:   filter.status }   : {}),
          ...(filter.category ? { category: filter.category } : {}),
          ...(filter.priority ? { priority: filter.priority } : {}),
        }),
        supportAPI.stats(),
      ]);
      setTickets(listR.data || []);
      setStats(statsR.data || {});
    } catch (e) {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ },
    [filter.status, filter.category, filter.priority]);

  // Load full ticket when selected.
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let cancelled = false;
    supportAPI.get(selectedId).then(r => { if (!cancelled) setSelected(r.data); })
      .catch(() => toast.error("Failed to load ticket"));
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <LifeBuoy size={22} className="text-gold"/>
            {isSuperAdmin ? "Support Inbox" : "Reach Out"}
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {isSuperAdmin
              ? "Tickets raised by lodges across the platform."
              : "Hit a snag? Raise a ticket and our team will respond."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="btn-icon" title="Refresh"><RefreshCw size={16}/></button>
          {!isSuperAdmin && (
            <button onClick={() => setShowCreate(true)} className="btn-gold flex items-center gap-1.5">
              <Plus size={14}/> New Ticket
            </button>
          )}
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {["open", "awaiting_lodge", "resolved", "closed"].map(s => {
          const cfg = STATUS_CFG[s];
          return (
            <button key={s}
                    onClick={() => setFilter(f => ({ ...f, status: f.status === s ? "" : s }))}
                    className={`p-3 rounded-xl border transition-all text-left ${
                      filter.status === s
                        ? "border-gold shadow-soft bg-gold-50"
                        : "border-ink-100 bg-white hover:border-ink-300"
                    }`}>
              <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600 flex items-center gap-1">
                {cfg.icon} {cfg.label}
              </div>
              <div className="font-display text-2xl font-bold text-navy mt-0.5">{stats[s] || 0}</div>
            </button>
          );
        })}
      </div>

      {/* Optional category + priority filters (super-admin uses heavily) */}
      {isSuperAdmin && (
        <div className="flex flex-wrap gap-2">
          <select value={filter.category} onChange={e => setFilter(f => ({...f, category: e.target.value}))}
                  className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm">
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          <select value={filter.priority} onChange={e => setFilter(f => ({...f, priority: e.target.value}))}
                  className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm">
            <option value="">All priorities</option>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      )}

      {/* Two-pane layout: list | thread */}
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
        {/* List */}
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-ink-400">Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare size={36} className="mx-auto text-ink-300 mb-3"/>
              <p className="text-ink-500 text-sm">No tickets here.</p>
              {!isSuperAdmin && (
                <button onClick={() => setShowCreate(true)} className="btn-gold mt-4 inline-flex items-center gap-1.5">
                  <Plus size={14}/> Raise your first ticket
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-ink-100 max-h-[70vh] overflow-y-auto">
              {tickets.map((t, i) => (
                <button key={t.ticket_id}
                        onClick={() => setSelectedId(t.ticket_id)}
                        style={{ animationDelay: `${i * 25}ms` }}
                        className={`w-full text-left p-4 hover:bg-gold/5 transition-colors animate-slide-up ${
                          selectedId === t.ticket_id ? "bg-gold/10 border-l-4 border-gold" : "border-l-4 border-transparent"
                        }`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-2xs font-mono text-ink-400">{t.ticket_ref}</span>
                    <StatusPill status={t.status}/>
                  </div>
                  <h3 className="font-semibold text-navy text-sm line-clamp-1">{t.subject}</h3>
                  <div className="flex items-center gap-2 mt-1.5 text-2xs text-ink-500 flex-wrap">
                    {isSuperAdmin && t.lodge_name && (
                      <span className="flex items-center gap-1"><Building2 size={10}/> {t.lodge_name}</span>
                    )}
                    <PriorityPill priority={t.priority}/>
                    <span className="text-ink-400">·</span>
                    <span>{new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Thread */}
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden min-h-[400px]">
          {selected
            ? <TicketThread ticket={selected} isSuperAdmin={isSuperAdmin}
                            currentUserId={user?.user_id}
                            onClose={() => setSelectedId(null)}
                            onUpdated={(t) => { setSelected(t); refresh(); }}/>
            : (
              <div className="h-full flex items-center justify-center p-12 text-center">
                <div>
                  <MessageSquare size={48} className="mx-auto text-ink-200 mb-3"/>
                  <p className="text-ink-400">Select a ticket to view the conversation.</p>
                </div>
              </div>
            )
          }
        </div>
      </div>

      {/* Create ticket modal */}
      {showCreate && (
        <CreateTicketModal onClose={() => setShowCreate(false)}
                            onCreated={(t) => { setShowCreate(false); setSelectedId(t.ticket_id); refresh(); }}/>
      )}
    </div>
  );
}


// ── Sub-components ────────────────────────────────────────────────

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: "bg-ink-100 text-ink-700 ring-ink-200" };
  return (
    <span className={`badge ring-1 ring-inset ${cfg.cls} flex-shrink-0`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function PriorityPill({ priority }) {
  const cfg = PRIORITIES.find(p => p.value === priority);
  if (!cfg || priority === "normal") return null;
  return (
    <span className={`text-2xs font-bold uppercase px-1.5 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function TicketThread({ ticket, isSuperAdmin, currentUserId, onClose, onUpdated }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ticket.messages?.length]);

  const send = async (statusChange = null) => {
    if (!reply.trim() && !statusChange) return;
    setSending(true);
    try {
      const r = await supportAPI.reply(ticket.ticket_id, {
        body: reply.trim() || (statusChange === "resolved" ? "Marking as resolved." : "Status update."),
        ...(statusChange ? { status_change: statusChange } : {}),
      });
      onUpdated(r.data);
      setReply("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reply failed");
    } finally {
      setSending(false);
    }
  };

  const changePriority = async (priority) => {
    try {
      const r = await supportAPI.update(ticket.ticket_id, { priority });
      onUpdated(r.data);
      toast.success(`Priority set to ${priority}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Update failed");
    }
  };

  const isClosed = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      {/* Header */}
      <div className="p-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <button onClick={onClose} className="lg:hidden btn-icon -ml-1">
              <ArrowLeft size={16}/>
            </button>
            <span className="text-2xs font-mono text-ink-400">{ticket.ticket_ref}</span>
            <StatusPill status={ticket.status}/>
          </div>
          <h2 className="font-display text-lg font-bold text-navy">{ticket.subject}</h2>
          <div className="flex items-center gap-3 text-xs text-ink-500 mt-1 flex-wrap">
            {isSuperAdmin && ticket.lodge_name && (
              <span className="flex items-center gap-1"><Building2 size={11}/> {ticket.lodge_name}</span>
            )}
            <span className="flex items-center gap-1"><User size={11}/> {ticket.raised_by_full_name || ticket.raised_by_username}</span>
            {isSuperAdmin && (
              <select value={ticket.priority}
                      onChange={e => changePriority(e.target.value)}
                      className="text-2xs border border-ink-200 rounded px-1.5 py-0.5">
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            )}
            {!isSuperAdmin && <PriorityPill priority={ticket.priority}/>}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-ink-50/30">
        {(ticket.messages || []).map(m => {
          const own = m.author_user_id === currentUserId;
          const fromSuper = m.author_role === "super_admin";
          return (
            <div key={m.message_id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-soft animate-slide-up ${
                own
                  ? "bg-navy text-white"
                  : fromSuper
                    ? "bg-gradient-to-br from-gold-50 to-white border border-gold/30 text-navy"
                    : "bg-white border border-ink-200 text-navy"
              }`}>
                <div className={`text-2xs font-bold uppercase tracking-eyebrow mb-1 ${own ? "text-white/60" : "text-ink-500"}`}>
                  {m.author_full_name || m.author_username}
                  {fromSuper && " · Support"}
                </div>
                <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                <div className={`text-2xs mt-1 ${own ? "text-white/40" : "text-ink-400"}`}>
                  {new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  {m.status_change && (
                    <span className={`ml-2 font-semibold ${own ? "text-gold-light" : "text-gold-700"}`}>
                      · status → {m.status_change}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef}/>
      </div>

      {/* Reply box */}
      {!isClosed ? (
        <div className="p-3 border-t border-ink-100 bg-white">
          <div className="flex gap-2">
            <textarea value={reply} onChange={e => setReply(e.target.value)}
                      placeholder="Type your reply..."
                      rows={2}
                      className="input-field flex-1 resize-none"
                      onKeyDown={e => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                      }}/>
            <div className="flex flex-col gap-2">
              <button onClick={() => send()} disabled={sending || !reply.trim()}
                      className="btn-gold flex items-center justify-center gap-1.5 w-24">
                <Send size={14}/> Reply
              </button>
              <button onClick={() => send("resolved")} disabled={sending}
                      className="btn-outline border-green-300 text-green-700 hover:bg-green-50 hover:border-green-500 text-xs">
                Resolve
              </button>
            </div>
          </div>
          <p className="text-2xs text-ink-400 mt-1.5">Ctrl/Cmd+Enter to send</p>
        </div>
      ) : (
        <div className="p-4 border-t border-ink-100 bg-ink-50 text-center">
          <p className="text-sm text-ink-600 mb-2">
            This ticket is {ticket.status}.
          </p>
          {(isSuperAdmin || ticket.status === "resolved") && (
            <button onClick={async () => {
              try {
                const r = await supportAPI.update(ticket.ticket_id, { status: "open" });
                onUpdated(r.data);
                toast.success("Ticket reopened");
              } catch { toast.error("Failed to reopen"); }
            }} className="btn-outline text-sm">
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    subject: "", description: "", category: "technical", priority: "normal",
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.subject.trim().length < 3 || form.description.trim().length < 10) {
      toast.error("Subject (3+ chars) and description (10+ chars) required");
      return;
    }
    setSubmitting(true);
    try {
      const r = await supportAPI.create(form);
      toast.success(`Ticket ${r.data.ticket_ref} raised`);
      onCreated(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="modal-box max-w-lg">
        <div className="p-5 border-b border-ink-100 flex justify-between items-center">
          <h2 className="font-display text-lg font-bold text-navy">Raise a Support Ticket</h2>
          <button type="button" onClick={onClose} className="btn-icon"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Category</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {CATEGORIES.map(c => (
                <button key={c.value} type="button"
                        onClick={() => setForm(f => ({...f, category: c.value}))}
                        className={`p-2 rounded-lg border-2 text-center text-xs transition-all ${
                          form.category === c.value
                            ? "border-gold bg-gold-50 text-navy font-semibold"
                            : "border-ink-200 hover:border-ink-300 text-ink-600"
                        }`}>
                  <div className="text-xl mb-0.5">{c.icon}</div>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button key={p.value} type="button"
                        onClick={() => setForm(f => ({...f, priority: p.value}))}
                        className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                          form.priority === p.value
                            ? "border-navy bg-navy text-white"
                            : "border-ink-200 text-ink-600 hover:border-ink-300"
                        }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Subject *</label>
            <input type="text" value={form.subject}
                   onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                   placeholder="One-line summary of the issue"
                   maxLength={200}
                   className="input-field"/>
          </div>
          <div>
            <label className="label">Description *</label>
            <textarea rows={6} value={form.description}
                      onChange={e => setForm(f => ({...f, description: e.target.value}))}
                      placeholder="Describe the issue in detail. Include steps to reproduce, error messages, and what you expected to happen."
                      maxLength={10000}
                      className="input-field"/>
            <div className="text-2xs text-ink-400 mt-1 text-right">
              {form.description.length}/10000
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-gold">
            {submitting ? "Submitting..." : "Submit Ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
