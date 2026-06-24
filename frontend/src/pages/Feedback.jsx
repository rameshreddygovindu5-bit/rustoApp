import React, { useState, useEffect } from 'react'
import { MessageSquare, Star, ThumbsUp, ThumbsDown, Plus, X, Copy, Send } from 'lucide-react'
import { toast } from 'react-toastify'
import { feedbackAPI, checkinsAPI } from '../services/api'

/**
 * Feedback admin page — view + create guest reviews.
 *
 * Tabs: All / Submitted / Pending.
 * Stats cards show avg rating, response rate, would-recommend %.
 * Staff can manually enter feedback (phone call recordings) or generate
 * a public submission link for any past check-in.
 */
export default function Feedback() {
  const [tab, setTab] = useState('all')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showStaffEntry, setShowStaffEntry] = useState(false)
  const [showRequest, setShowRequest] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const params = {}
      if (tab === 'pending') params.pending_only = true
      if (tab === 'submitted') params.submitted_only = true
      const [list, st] = await Promise.all([
        feedbackAPI.list(params),
        feedbackAPI.stats(),
      ])
      setRows(list.data || [])
      setStats(st.data)
    } catch {
      toast.error('Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() /* eslint-disable-next-line */ }, [tab])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Guest Feedback</h1>
          <p className="text-ink-500 text-sm mt-1">
            Post-stay surveys auto-requested on checkout. Submission links expire in 30 days.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRequest(true)}
                  className="bg-white hover:bg-ink-50 border border-ink-300 text-navy px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
            <Send size={14}/> Send link
          </button>
          <button onClick={() => setShowStaffEntry(true)}
                  className="bg-gold hover:bg-gold/90 text-navy-dark px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-medium shadow-sm">
            <Plus size={14}/> Manual entry
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Avg Rating"
                    value={stats.avg_overall ? `${stats.avg_overall.toFixed(1)} ★` : '—'}
                    subtitle={`${stats.submitted} submissions`}
                    accent={stats.avg_overall >= 4 ? 'green' : stats.avg_overall >= 3 ? 'amber' : 'red'} />
          <StatCard label="Response Rate"
                    value={`${stats.response_rate_pct}%`}
                    subtitle={`${stats.submitted}/${stats.total_requests_sent}`} />
          <StatCard label="Would Recommend"
                    value={`${stats.would_recommend_pct}%`}
                    subtitle="NPS-lite"
                    accent={stats.would_recommend_pct >= 70 ? 'green' : 'amber'} />
          <StatCard label="Pending"
                    value={stats.pending}
                    subtitle="awaiting submission" />
        </div>
      )}

      {/* Rating distribution */}
      {stats && stats.submitted > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
          <h3 className="font-semibold text-navy mb-3 text-sm">Rating Distribution</h3>
          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map(n => {
              const c = stats.rating_distribution?.[n] || 0
              const pct = stats.submitted > 0 ? (c / stats.submitted * 100) : 0
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-6 font-medium">{n} ★</span>
                  <div className="flex-1 h-3 bg-ink-100 rounded overflow-hidden">
                    <div className={`h-full ${n >= 4 ? 'bg-green-500' : n >= 3 ? 'bg-amber-500' : 'bg-red-500'}`}
                         style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-12 text-right text-ink-500">{c} ({pct.toFixed(0)}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-ink-200">
        {[['all', 'All'], ['submitted', 'Submitted'], ['pending', 'Pending']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${
                    tab === k ? 'border-gold text-gold' : 'border-transparent text-ink-500 hover:text-navy'
                  }`}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <MessageSquare size={40} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">No feedback in this view.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map(r => <FeedbackCard key={r.feedback_id} row={r} onResent={fetchAll} />)}
        </div>
      )}

      {showRequest && (
        <RequestLinkModal onClose={() => setShowRequest(false)}
                           onSent={() => { setShowRequest(false); fetchAll() }} />
      )}
      {showStaffEntry && (
        <StaffEntryModal onClose={() => setShowStaffEntry(false)}
                          onSaved={() => { setShowStaffEntry(false); fetchAll() }} />
      )}
    </div>
  )
}

function StatCard({ label, value, subtitle, accent }) {
  const accentClass = {
    green: 'text-green-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  }[accent] || 'text-navy'
  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accentClass}`}>{value}</div>
      {subtitle && <div className="text-[11px] text-ink-400 mt-0.5">{subtitle}</div>}
    </div>
  )
}

/** Star row + content — Submitted feedback shows ratings + comments;
 *  Pending feedback shows the submission link with a copy button. */
function FeedbackCard({ row, onResent }) {
  const submitted = !!row.submitted_at

  return (
    <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-semibold text-navy">{row.guest_name || '(unnamed guest)'}</div>
          <div className="text-[11px] text-ink-400">
            {submitted
              ? `Submitted ${new Date(row.submitted_at).toLocaleString()}`
              : `Pending — requested ${new Date(row.created_at).toLocaleDateString()}`}
            {submitted && row.submission_source && (
              <span className="ml-2 px-1.5 py-0.5 bg-ink-100 rounded text-[10px] uppercase">{row.submission_source}</span>
            )}
          </div>
        </div>
        {submitted && row.would_recommend !== null && (
          row.would_recommend
            ? <ThumbsUp size={16} className="text-green-500" title="Would recommend"/>
            : <ThumbsDown size={16} className="text-red-500" title="Would NOT recommend"/>
        )}
      </div>

      {submitted ? (
        <>
          <Stars n={row.overall_rating}/>
          {row.comment && (
            <p className="text-sm text-ink-600 mt-2 italic">"{row.comment}"</p>
          )}
          {(row.cleanliness_rating || row.service_rating || row.value_rating || row.location_rating) && (
            <div className="mt-3 pt-3 border-t border-ink-100 grid grid-cols-2 gap-1 text-xs">
              {row.cleanliness_rating && <div><span className="text-ink-500">Cleanliness:</span> <strong>{row.cleanliness_rating}★</strong></div>}
              {row.service_rating && <div><span className="text-ink-500">Service:</span> <strong>{row.service_rating}★</strong></div>}
              {row.value_rating && <div><span className="text-ink-500">Value:</span> <strong>{row.value_rating}★</strong></div>}
              {row.location_rating && <div><span className="text-ink-500">Location:</span> <strong>{row.location_rating}★</strong></div>}
            </div>
          )}
        </>
      ) : (
        <PendingRow row={row} onResent={onResent}/>
      )}
    </div>
  )
}

function Stars({ n }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={18}
              className={i <= (n || 0) ? 'text-amber-400 fill-amber-400' : 'text-ink-200'} />
      ))}
      <span className="ml-2 font-semibold text-ink-700">{n}/5</span>
    </div>
  )
}

function PendingRow({ row, onResent }) {
  const handleResend = async () => {
    try {
      // Calling /feedback/request with the same checkin_id reuses the
      // existing pending row and returns its URL — we display + can copy it.
      if (!row.checkin_id) {
        toast.error('No check-in linked — cannot generate link')
        return
      }
      const res = await feedbackAPI.request({ checkin_id: row.checkin_id })
      const url = window.location.origin + res.data.url
      try {
        await navigator.clipboard.writeText(url)
        toast.success('Submission link copied to clipboard')
      } catch {
        toast.info(url)
      }
      onResent()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    }
  }
  return (
    <div className="text-xs text-ink-500 space-y-2">
      <p>Awaiting guest submission. Link expires {row.token_expires_at ? new Date(row.token_expires_at).toLocaleDateString() : 'in 30 days'}.</p>
      <button onClick={handleResend}
              className="px-2.5 py-1 bg-gold/10 hover:bg-gold/20 text-gold rounded text-xs font-medium inline-flex items-center gap-1">
        <Copy size={12}/> Copy submission link
      </button>
    </div>
  )
}

function RequestLinkModal({ onClose, onSent }) {
  const [checkinId, setCheckinId] = useState('')
  const [days, setDays] = useState('30')
  const [generated, setGenerated] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const cid = parseInt(checkinId, 10)
    if (!cid) { toast.error('Check-in ID required'); return }
    setSaving(true)
    try {
      const res = await feedbackAPI.request({ checkin_id: cid, expires_in_days: parseInt(days, 10) || 30 })
      const url = window.location.origin + res.data.url
      setGenerated(url)
      try { await navigator.clipboard.writeText(url); toast.success('Link copied') } catch {}
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">Generate Feedback Link</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Check-in ID *</label>
            <input type="number" value={checkinId} onChange={e => setCheckinId(e.target.value)}
                   className="input-field"
                   placeholder="e.g. 142" autoFocus />
            <p className="text-[11px] text-ink-400 mt-1">Find this in Check-ins → click the row to see its ID.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Expires in (days)</label>
            <input type="number" min="1" max="90" value={days} onChange={e => setDays(e.target.value)}
                   className="input-field" />
          </div>
          {generated && (
            <div className="bg-green-50 border border-green-200 rounded p-3">
              <p className="text-xs text-green-700 font-medium mb-1">Link generated (copied to clipboard):</p>
              <code className="text-[11px] text-green-900 break-all">{generated}</code>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={() => { generated ? onSent() : onClose() }}
                  className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">
            {generated ? 'Done' : 'Cancel'}
          </button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? '…' : 'Generate'}
          </button>
        </div>
      </form>
    </div>
  )
}

function StaffEntryModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    guest_name: '', overall: 0, cleanliness: 0, service: 0, value: 0, location: 0,
    comment: '', would_recommend: null, checkin_id: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.overall) { toast.error('Overall rating required'); return }
    setSaving(true)
    try {
      await feedbackAPI.staffEntry({
        guest_name: form.guest_name || null,
        overall_rating: form.overall,
        cleanliness_rating: form.cleanliness || null,
        service_rating: form.service || null,
        value_rating: form.value || null,
        location_rating: form.location || null,
        comment: form.comment || null,
        would_recommend: form.would_recommend,
        checkin_id: form.checkin_id ? parseInt(form.checkin_id, 10) : null,
      })
      toast.success('Feedback recorded')
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">Manual Feedback Entry</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Guest Name</label>
              <input type="text" value={form.guest_name}
                     onChange={e => set('guest_name', e.target.value)}
                     className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Check-in ID</label>
              <input type="number" value={form.checkin_id}
                     onChange={e => set('checkin_id', e.target.value)}
                     className="input-field"
                     placeholder="optional" />
            </div>
          </div>
          <StarPicker label="Overall *" value={form.overall} onChange={n => set('overall', n)} />
          <div className="grid grid-cols-2 gap-3">
            <StarPicker label="Cleanliness" value={form.cleanliness} onChange={n => set('cleanliness', n)} small />
            <StarPicker label="Service" value={form.service} onChange={n => set('service', n)} small />
            <StarPicker label="Value" value={form.value} onChange={n => set('value', n)} small />
            <StarPicker label="Location" value={form.location} onChange={n => set('location', n)} small />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Comment</label>
            <textarea value={form.comment} onChange={e => set('comment', e.target.value)}
                      rows={3} className="input-field" />
          </div>
          <div className="flex gap-2 items-center text-sm">
            <span className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Would recommend?</span>
            <button type="button" onClick={() => set('would_recommend', true)}
                    className={`px-3 py-1 rounded text-xs flex items-center gap-1 ${form.would_recommend === true ? 'bg-green-500 text-white' : 'bg-ink-100 text-ink-600'}`}>
              <ThumbsUp size={12}/> Yes
            </button>
            <button type="button" onClick={() => set('would_recommend', false)}
                    className={`px-3 py-1 rounded text-xs flex items-center gap-1 ${form.would_recommend === false ? 'bg-red-500 text-white' : 'bg-ink-100 text-ink-600'}`}>
              <ThumbsDown size={12}/> No
            </button>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Feedback'}
          </button>
        </div>
      </form>
    </div>
  )
}

function StarPicker({ label, value, onChange, small = false }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)}>
            <Star size={small ? 16 : 22}
                  className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-ink-200 hover:text-amber-200'} />
          </button>
        ))}
      </div>
    </div>
  )
}
