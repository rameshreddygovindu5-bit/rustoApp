import React, { useState, useEffect } from 'react'
import { Megaphone, Plus, X, Send, Users, Eye, Trash2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { campaignsAPI } from '../services/api'

const STATUS_META = {
  draft:     { label: 'Draft',     color: 'bg-gray-100 text-gray-700' },
  queued:    { label: 'Queued',    color: 'bg-blue-100 text-blue-700' },
  sending:   { label: 'Sending',   color: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-700' },
}

const AUDIENCE_LABELS = {
  all_customers: 'All Customers',
  vip_only: 'VIP Customers',
  by_tier: 'By Loyalty Tier',
  recently_checked_out: 'Recently Checked Out',
  upcoming_bookings: 'Upcoming Bookings',
  custom_list: 'Custom Phone List',
}

/**
 * SMS Campaigns admin page.
 *
 * Workflow: create draft → preview audience → send. Sends are dispatched
 * via a background task; each recipient creates an Alert row using the
 * existing SMS plumbing (so retry/Twilio integration is reused).
 */
export default function Campaigns() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [previewing, setPreviewing] = useState(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const res = await campaignsAPI.list()
      setRows(res.data || [])
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { fetch() }, [])

  const handleSend = async (c) => {
    if (!window.confirm(
      `Send "${c.name}" to ~${c.estimated_recipients} recipient${c.estimated_recipients !== 1 ? 's' : ''}? ` +
      `This costs SMS credits and cannot be undone.`
    )) return
    try {
      const res = await campaignsAPI.send(c.campaign_id)
      toast.success(res.data?.message || 'Queued')
      fetch()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    }
  }
  const handleDelete = async (c) => {
    if (!window.confirm(`Delete campaign "${c.name}"?`)) return
    try { await campaignsAPI.delete(c.campaign_id); toast.success('Deleted'); fetch() }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">SMS Campaigns</h1>
          <p className="text-gray-500 text-sm mt-1">
            Bulk promotional / announcement messages. Uses the existing SMS provider configured in Settings.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
                className="bg-gold hover:bg-gold/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm">
          <Plus size={16}/> New Campaign
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Megaphone size={40} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500">No campaigns yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map(c => {
            const status = STATUS_META[c.status] || STATUS_META.draft
            return (
              <div key={c.campaign_id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-navy">{c.name}</h3>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  → {AUDIENCE_LABELS[c.audience_type] || c.audience_type}
                  {' · ~'}{c.estimated_recipients} recipient{c.estimated_recipients !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded p-2.5 italic">"{c.message}"</p>
                {c.status === 'completed' && (
                  <div className="text-xs text-gray-500 mt-2 flex gap-4">
                    <span className="text-green-600">✓ {c.actual_sent} sent</span>
                    {c.actual_failed > 0 && <span className="text-red-600">✗ {c.actual_failed} failed</span>}
                    <span>{new Date(c.sent_at).toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                  <button onClick={() => setPreviewing(c)}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs flex items-center gap-1">
                    <Eye size={12}/> Preview audience
                  </button>
                  {c.status === 'draft' && (
                    <button onClick={() => handleSend(c)}
                            className="px-2.5 py-1 bg-gold hover:bg-gold/90 text-white rounded text-xs flex items-center gap-1 font-medium">
                      <Send size={12}/> Send now
                    </button>
                  )}
                  {(c.status === 'draft' || c.status === 'cancelled' || c.status === 'completed') && (
                    <button onClick={() => handleDelete(c)}
                            className="ml-auto text-red-400 hover:text-red-600">
                      <Trash2 size={14}/>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetch() }} />
      )}
      {previewing && (
        <PreviewModal campaign={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  )
}

function CreateModal({ onClose, onSaved }) {
  const [f, setF] = useState({
    name: '', message: '', audience_type: 'all_customers', params: {},
  })
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!f.name.trim() || !f.message.trim()) { toast.error('Name + message required'); return }
    setSaving(true)
    try {
      const res = await campaignsAPI.create({
        name: f.name.trim(),
        message: f.message.trim(),
        audience_type: f.audience_type,
        audience_params: f.params || {},
      })
      toast.success(`Draft created — estimated ${res.data.estimated_recipients} recipients`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">New Campaign</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Name *</label>
            <input type="text" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                   placeholder="e.g. Diwali Promo, October Newsletter" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Message *</label>
            <textarea value={f.message} onChange={e => setF(s => ({ ...s, message: e.target.value }))}
                      rows={4} maxLength={500}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      placeholder="Hi! 20% off your next stay this Diwali. Book by Nov 15." />
            <p className="text-[11px] text-gray-400 mt-1">{f.message.length}/500 chars (multi-part SMS may cost more)</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Audience</label>
            <select value={f.audience_type}
                    onChange={e => setF(s => ({ ...s, audience_type: e.target.value, params: {} }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {Object.entries(AUDIENCE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {/* Audience-specific params */}
          {f.audience_type === 'by_tier' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Tier</label>
              <select value={f.params.tier || 'gold'}
                      onChange={e => setF(s => ({ ...s, params: { tier: e.target.value }}))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
              </select>
            </div>
          )}
          {f.audience_type === 'recently_checked_out' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Checked out within last N days
              </label>
              <input type="number" min="1" value={f.params.since_days || 30}
                     onChange={e => setF(s => ({ ...s, params: { since_days: parseInt(e.target.value, 10) || 30 }}))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          )}
          {f.audience_type === 'upcoming_bookings' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Booking arriving within N days
              </label>
              <input type="number" min="1" value={f.params.within_days || 7}
                     onChange={e => setF(s => ({ ...s, params: { within_days: parseInt(e.target.value, 10) || 7 }}))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          )}
          {f.audience_type === 'custom_list' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Phone numbers <span className="text-gray-400 normal-case">(one per line)</span>
              </label>
              <textarea value={(f.params.phones || []).join('\n')}
                        onChange={e => setF(s => ({ ...s, params: { phones: e.target.value.split('\n').map(p => p.trim()).filter(Boolean) }}))}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                        placeholder="+91 9876543210" />
            </div>
          )}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            Campaign is saved as a draft. You'll see the exact recipient count before sending.
          </p>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PreviewModal({ campaign, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    campaignsAPI.previewAudience(campaign.campaign_id)
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to preview'))
  }, [campaign.campaign_id])
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h2 className="font-display font-bold text-navy text-lg">Audience Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">{campaign.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="overflow-y-auto p-4 flex-1">
          {!data ? <div className="text-gray-400 text-center py-8">Loading…</div> :
            data.count === 0 ? (
              <div className="text-gray-500 text-center py-8 flex flex-col items-center gap-2">
                <Users size={32} className="text-gray-300"/> No recipients match this audience filter.
              </div>
            ) : (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl font-bold text-navy">{data.count}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">recipients</div>
                </div>
                <div className="text-xs text-gray-500 mb-1">First {data.sample.length}:</div>
                <div className="bg-gray-50 rounded p-2 text-xs font-mono space-y-0.5">
                  {data.sample.map((p, i) => <div key={i}>{p}</div>)}
                </div>
                {data.truncated && (
                  <p className="text-[11px] text-gray-400 mt-1">…and more not shown</p>
                )}
              </>
            )}
        </div>
      </div>
    </div>
  )
}
