import React, { useState, useEffect, useMemo } from "react";
import { MessageSquare, Star, Filter, Send, Edit2, Trash2, X,
         CheckCircle2, AlertCircle, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { toast } from "react-toastify";
import { reviewsAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import StarRating from "../components/StarRating";

/**
 * Lodge-side Review Management.
 *
 * Lets the lodge admin:
 *   - See every review their lodge has received (incl. flagged)
 *   - Filter by rating (5★ down to 1★) and "Unresponded only"
 *   - Reply to a review (one reply per review; editable)
 *   - Remove a previous reply
 *
 * Admins CANNOT delete or flag customer reviews — that's super-admin
 * territory (and not exposed in this round). Responding gives the lodge
 * agency to acknowledge feedback without litigating it.
 */
export default function RustoReviewsAdmin() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState({ summary: {}, reviews: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ rating: "", unrespondedOnly: false,
                                              includeHidden: false });
  const [responding, setResponding] = useState(null);    // review object

  const refresh = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.rating) params.rating = +filters.rating;
      if (filters.unrespondedOnly) params.unresponded_only = true;
      if (filters.includeHidden) params.include_hidden = true;
      const r = await reviewsAPI.lodgeList(params);
      setData(r.data);
    } catch {
      toast.error("Failed to load reviews");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filters]);

  if (!isAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Admin access required</h2>
    </div>
  );

  const summary = data.summary || {};

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <MessageSquare size={22} className="text-gold"/> Guest Reviews
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            See what guests are saying and respond directly.
          </p>
        </div>
        <button onClick={refresh} className="btn-icon" title="Refresh">
          <RefreshCw size={16}/>
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard label="Average rating"
                      value={summary.avg_rating ? summary.avg_rating.toFixed(1) : "—"}
                      sub={summary.avg_rating != null
                            ? <StarRating value={summary.avg_rating} size="sm"/>
                            : null}/>
        <SummaryCard label="Total reviews"
                      value={summary.total_published ?? 0}/>
        <SummaryCard label="Awaiting response"
                      value={summary.unresponded ?? 0}
                      highlight={(summary.unresponded || 0) > 0}/>
      </div>

      {/* Filters */}
      <div className="card flex items-center gap-3 flex-wrap">
        <Filter size={14} className="text-gold"/>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-600">Rating</span>
          <select value={filters.rating}
                  onChange={e => setFilters(f => ({...f, rating: e.target.value}))}
                  className="input-field text-sm py-1.5 px-2 w-auto">
            <option value="">All</option>
            <option value="5">5 stars</option>
            <option value="4">4 stars</option>
            <option value="3">3 stars</option>
            <option value="2">2 stars</option>
            <option value="1">1 star</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={filters.unrespondedOnly}
                 onChange={e => setFilters(f => ({...f, unrespondedOnly: e.target.checked}))}
                 className="rounded"/>
          <span className="text-ink-700">Unresponded only</span>
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={filters.includeHidden}
                 onChange={e => setFilters(f => ({...f, includeHidden: e.target.checked}))}
                 className="rounded"/>
          <span className="text-ink-700">Include hidden / removed</span>
        </label>
      </div>

      {/* Review list */}
      {loading ? (
        <div className="text-center py-12 text-ink-400">
          <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
          <p className="text-sm">Loading…</p>
        </div>
      ) : data.reviews.length === 0 ? (
        <div className="card text-center py-12">
          <MessageSquare size={36} className="mx-auto text-ink-300 mb-3"/>
          <h3 className="font-display text-lg font-bold text-navy">No reviews yet</h3>
          <p className="text-ink-500 mt-1 text-sm">
            Your first published guest will be able to leave a review after their stay.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.reviews.map((r, i) => (
            <ReviewRow key={r.review_id} r={r}
                        style={{ animationDelay: `${i * 30}ms` }}
                        onRespond={() => setResponding(r)}
                        onRefresh={refresh}/>
          ))}
        </div>
      )}

      {responding && (
        <RespondModal r={responding} onClose={() => setResponding(null)}
                       onSaved={() => { setResponding(null); refresh(); }}/>
      )}
    </div>
  );
}


// ── Summary + Row + Modal ─────────────────────────────────────────

function SummaryCard({ label, value, sub, highlight }) {
  return (
    <div className={`card ${highlight ? "bg-gold-50 border-gold/30" : ""}`}>
      <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-3xl font-bold text-navy">{value}</div>
        {sub}
      </div>
    </div>
  );
}

function ReviewRow({ r, style, onRespond, onRefresh }) {
  const statusBadge = {
    published: null,
    hidden:    { label: "Hidden by guest", cls: "bg-ink-100 text-ink-600", Icon: EyeOff },
    flagged:   { label: "Removed by Rusto", cls: "bg-red-50 text-red-700",  Icon: AlertCircle },
  }[r.status];

  return (
    <div className="card-interactive animate-slide-up" style={style}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display font-bold text-navy">{r.customer_name}</span>
            <span className="badge bg-green-50 text-green-700 ring-1 ring-inset ring-green-200 text-2xs">
              <CheckCircle2 size={9}/> Verified
            </span>
            {statusBadge && (
              <span className={`badge ${statusBadge.cls} text-2xs ring-1 ring-inset ring-current/20`}>
                <statusBadge.Icon size={9}/> {statusBadge.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StarRating value={r.rating} size="sm"/>
            <span className="text-2xs text-ink-500">
              {new Date(r.created_at).toLocaleDateString("en-IN",
                  { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <span className="text-2xs text-ink-400 font-mono">Booking #{r.booking_id}</span>
          </div>
        </div>
      </div>
      {r.title && <h4 className="font-display font-bold text-navy text-base">{r.title}</h4>}
      {r.body && <p className="text-ink-700 mt-1 whitespace-pre-wrap leading-relaxed">{r.body}</p>}

      {r.lodge_response ? (
        <ResponseBlock body={r.lodge_response.body} at={r.lodge_response.at}
                        onEdit={onRespond}
                        onDelete={async () => {
                          if (!window.confirm("Remove your response?")) return;
                          try {
                            await reviewsAPI.removeResponse(r.review_id);
                            toast.success("Response removed");
                            onRefresh();
                          } catch (e) {
                            toast.error(e.response?.data?.detail || "Failed");
                          }
                        }}/>
      ) : r.status === "published" ? (
        <div className="mt-3 pt-3 border-t border-ink-100">
          <button onClick={onRespond}
                  className="btn-outline text-sm flex items-center gap-1.5">
            <Send size={13}/> Write a response
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ResponseBlock({ body, at, onEdit, onDelete }) {
  return (
    <div className="mt-3 pl-3 border-l-2 border-gold/40 bg-gold-50/40 rounded-r-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-2xs uppercase tracking-eyebrow font-bold text-gold-700">
          Your response · {at && new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="btn-icon text-2xs" title="Edit">
            <Edit2 size={11}/>
          </button>
          <button onClick={onDelete} className="btn-icon text-2xs hover:text-red-600" title="Remove">
            <Trash2 size={11}/>
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-700 whitespace-pre-wrap">{body}</p>
    </div>
  );
}


function RespondModal({ r, onClose, onSaved }) {
  const [body, setBody] = useState(r.lodge_response?.body || "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (body.trim().length < 2) { toast.error("Write a few words"); return; }
    setBusy(true);
    try {
      await reviewsAPI.respond(r.review_id, { body: body.trim() });
      toast.success(r.lodge_response ? "Response updated" : "Response posted");
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't post response");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="modal-box max-w-lg">
        <div className="p-5 border-b border-ink-100 flex justify-between items-start">
          <div>
            <h2 className="font-display text-lg font-bold text-navy">
              {r.lodge_response ? "Edit your response" : "Respond to review"}
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Replying to <span className="font-semibold">{r.customer_name}</span>'s {r.rating}★ review
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-3">
          {/* Show the original review for context */}
          <div className="bg-ink-50 rounded-xl p-3 text-sm text-ink-700">
            <div className="flex items-center gap-2 mb-1">
              <StarRating value={r.rating} size="sm"/>
              {r.title && <span className="font-display font-bold text-navy">{r.title}</span>}
            </div>
            {r.body && <p className="text-xs whitespace-pre-wrap leading-relaxed">{r.body}</p>}
          </div>
          <label className="block">
            <span className="label">Your response</span>
            <textarea value={body} rows={5} maxLength={2000}
                      onChange={e => setBody(e.target.value)}
                      placeholder="Thank the guest. Address specific points. Stay professional."
                      className="input-field"/>
            <div className="text-2xs text-ink-400 text-right mt-1">{body.length}/2000</div>
          </label>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-gold flex items-center gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin"/> : <Send size={13}/>}
            {r.lodge_response ? "Update response" : "Post response"}
          </button>
        </div>
      </form>
    </div>
  );
}
