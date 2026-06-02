import React, { useState, useEffect } from 'react'
import { Plus, RefreshCw, Eye, EyeOff, Copy, Shield, AlertTriangle, X,
         CheckCircle, XCircle, Webhook, Key, Activity } from 'lucide-react'
import { toast } from 'react-toastify'
import { agenciesAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

const STATUS_COLORS = {
  active:    'bg-green-100 text-green-800',
  suspended: 'bg-amber-100 text-amber-800',
  revoked:   'bg-red-100 text-red-800',
}

export default function Agencies() {
  const { isAdmin } = useAuth()
  const [agencies, setAgencies] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [credModal, setCredModal]   = useState(null)  // {api_key, api_secret, ...}
  const [detail, setDetail]         = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await agenciesAPI.list()
      setAgencies(res.data || [])
    } catch (e) {
      toast.error('Failed to load agencies')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const onCreate = async (form) => {
    try {
      const res = await agenciesAPI.create(form)
      toast.success(`Created ${form.name}. Save the credentials now!`)
      setShowCreate(false)
      setCredModal(res.data.credentials)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create agency')
    }
  }

  const setStatus = async (id, status) => {
    if (!window.confirm(`Set status to ${status}?`)) return
    try {
      await agenciesAPI.setStatus(id, status)
      toast.success(`Status updated to ${status}`)
      load()
    } catch (e) { toast.error('Failed to update status') }
  }

  const regenerateSecret = async (id, name) => {
    if (!window.confirm(`Regenerate API secret for ${name}?\nThe old secret will stop working immediately.`)) return
    try {
      const res = await agenciesAPI.regenerateSecret(id)
      setCredModal({ ...res.data, regenerated: true })
    } catch (e) { toast.error('Failed to regenerate') }
  }

  if (!isAdmin) {
    return (
      <div className="card text-center py-12 animate-fade-in">
        <Shield className="mx-auto text-gray-400 mb-3" size={32} />
        <p className="text-gray-500">Admin access required for partner management.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-navy">Agency Partners</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            OTAs and travel agencies that integrate with our booking API.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={load} className="p-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowCreate(true)} className="flex-1 sm:flex-none btn-primary flex items-center justify-center gap-2 text-sm py-2.5 sm:py-2">
            <Plus size={16} /> New Partner
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-navy border-t-gold rounded-full animate-spin" />
        </div>
      ) : agencies.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 mb-4">No agency partners yet.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            Create your first partner
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agencies.map(a => (
            <div key={a.agency_id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-bold text-navy truncate">{a.name}</h3>
                  <p className="text-xs text-gray-500 font-mono">{a.code}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${STATUS_COLORS[a.status] || ''}`}>
                  {a.status}
                </span>
              </div>

              <div className="space-y-1.5 text-sm text-gray-600 mb-3">
                <div className="flex items-center gap-2">
                  <Key size={12} className="text-gray-400" />
                  <code className="text-[11px] truncate flex-1">{a.api_key}</code>
                  <button title="Copy api_key"
                          onClick={() => { navigator.clipboard.writeText(a.api_key); toast.info('API key copied') }}
                          className="text-gray-400 hover:text-navy"><Copy size={12} /></button>
                </div>
                <div className="flex items-center gap-2">
                  <Webhook size={12} className="text-gray-400" />
                  <span className="text-[11px] truncate">
                    {a.webhook_url || <span className="text-gray-400">no webhook configured</span>}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                  <span>Commission: <strong className="text-navy">{a.commission_pct}%</strong></span>
                  <span>Markup: <strong className="text-navy">{a.rate_markup_pct}%</strong></span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500">
                  <span>Bookings: <strong className="text-navy">{a.total_bookings}</strong></span>
                  <span>Revenue: <strong className="text-navy">₹{(a.total_revenue || 0).toLocaleString('en-IN')}</strong></span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                <button onClick={() => setDetail(a)} className="text-xs text-navy hover:underline flex items-center gap-1">
                  <Activity size={12} /> Details
                </button>
                <button onClick={() => regenerateSecret(a.agency_id, a.name)} className="text-xs text-amber-700 hover:underline flex items-center gap-1">
                  <Key size={12} /> Regen Secret
                </button>
                {a.status === 'active'
                  ? <button onClick={() => setStatus(a.agency_id, 'suspended')} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                      <XCircle size={12} /> Suspend
                    </button>
                  : <button onClick={() => setStatus(a.agency_id, 'active')} className="text-xs text-green-700 hover:underline flex items-center gap-1">
                      <CheckCircle size={12} /> Activate
                    </button>
                }
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && <CreateModal onSubmit={onCreate} onClose={() => setShowCreate(false)} />}

      {/* Credentials reveal modal (one-time) */}
      {credModal && <CredentialsModal data={credModal} onClose={() => setCredModal(null)} />}

      {/* Detail modal */}
      {detail && <DetailModal agencyId={detail.agency_id} agency={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}


/* ════════════════════════════════════════════════════════════════════ */
function CreateModal({ onSubmit, onClose }) {
  const [form, setForm] = useState({
    name: '', code: '', contact_email: '', contact_phone: '',
    contact_person: '', website: '', webhook_url: '',
    commission_pct: 10, rate_markup_pct: 0,
    allowed_room_types: 'deluxe_ac,ac,non_ac,house',
    daily_booking_limit: 0, max_advance_days: 180,
  })
  const [submitting, setSubmitting] = useState(false)
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name || !form.code || !form.contact_email) {
      toast.error('Name, code, and contact email are required')
      return
    }
    setSubmitting(true)
    try { await onSubmit(form) } finally { setSubmitting(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-display font-bold text-navy">New Agency Partner</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Agency Name *</label>
              <input className="input-field" value={form.name}
                     onChange={e => update('name', e.target.value)}
                     placeholder="Goibibo" />
            </div>
            <div>
              <label className="label">Code (slug) *</label>
              <input className="input-field font-mono" value={form.code}
                     onChange={e => update('code', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                     placeholder="goibibo" />
            </div>
            <div>
              <label className="label">Contact Email *</label>
              <input type="email" className="input-field" value={form.contact_email}
                     onChange={e => update('contact_email', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact Phone</label>
              <input className="input-field" value={form.contact_phone}
                     onChange={e => update('contact_phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact Person</label>
              <input className="input-field" value={form.contact_person}
                     onChange={e => update('contact_person', e.target.value)} />
            </div>
            <div>
              <label className="label">Website</label>
              <input className="input-field" value={form.website}
                     onChange={e => update('website', e.target.value)} placeholder="https://..." />
            </div>
            <div className="col-span-2">
              <label className="label">Webhook URL (POST endpoint we'll notify)</label>
              <input className="input-field" value={form.webhook_url}
                     onChange={e => update('webhook_url', e.target.value)}
                     placeholder="https://partner.com/lms-webhook" />
            </div>
            <div>
              <label className="label">Commission %</label>
              <input type="number" step="0.5" className="input-field"
                     value={form.commission_pct}
                     onChange={e => update('commission_pct', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label">Rate Markup %</label>
              <input type="number" step="0.5" className="input-field"
                     value={form.rate_markup_pct}
                     onChange={e => update('rate_markup_pct', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label">Daily Booking Limit (0 = unlimited)</label>
              <input type="number" className="input-field"
                     value={form.daily_booking_limit}
                     onChange={e => update('daily_booking_limit', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className="label">Max Advance Days</label>
              <input type="number" className="input-field"
                     value={form.max_advance_days}
                     onChange={e => update('max_advance_days', parseInt(e.target.value) || 180)} />
            </div>
            <div className="col-span-2">
              <label className="label">Allowed Room Types (comma list)</label>
              <input className="input-field font-mono text-xs"
                     value={form.allowed_room_types}
                     onChange={e => update('allowed_room_types', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="p-6 border-t flex justify-end gap-3">
          <button onClick={onClose} className="btn-outline">Cancel</button>
          <button onClick={submit} disabled={submitting} className="btn-primary">
            {submitting ? 'Creating...' : 'Create Partner'}
          </button>
        </div>
      </div>
    </div>
  )
}


/* ════════════════════════════════════════════════════════════════════ */
function CredentialsModal({ data, onClose }) {
  const [revealed, setRevealed] = useState(true)
  const copy = (text, label) => {
    navigator.clipboard.writeText(text)
    toast.info(`${label} copied to clipboard`)
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="bg-amber-50 border-b border-amber-200 p-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <h2 className="text-lg font-display font-bold text-navy">
              {data.regenerated ? 'New API Secret' : 'Save These Credentials Now'}
            </h2>
            <p className="text-sm text-amber-800 mt-1">
              The <strong>API Secret</strong> cannot be retrieved again — only regenerated.
              Send these to the partner over a secure channel.
            </p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <CredField label="API Key (X-API-Key header)" value={data.api_key}
                     onCopy={() => copy(data.api_key, 'API Key')} />
          <CredField label="API Secret (X-API-Secret header)" value={data.api_secret}
                     onCopy={() => copy(data.api_secret, 'API Secret')} sensitive />
          {data.webhook_secret && (
            <CredField label="Webhook Secret (HMAC-SHA256 for signature verification)"
                       value={data.webhook_secret}
                       onCopy={() => copy(data.webhook_secret, 'Webhook Secret')} sensitive />
          )}

          <div className="bg-gray-50 p-4 rounded-lg text-xs">
            <p className="font-semibold text-navy mb-2">Quick start for partner:</p>
            <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap">
{`curl ${window.location.origin}/api/partner/v1/me \\
  -H "X-API-Key: ${data.api_key}" \\
  -H "X-API-Secret: ${data.api_secret || '<the secret you just copied>'}"
`}
            </pre>
          </div>
        </div>
        <div className="p-6 border-t flex justify-end">
          <button onClick={onClose} className="btn-primary">I've saved them</button>
        </div>
      </div>
    </div>
  )
}

function CredField({ label, value, onCopy, sensitive = false }) {
  const [shown, setShown] = useState(!sensitive)
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2 items-center">
        <code className="flex-1 font-mono text-xs bg-gray-100 px-3 py-2 rounded-lg break-all">
          {shown ? value : '••••••••••••••••••••••••••••'}
        </code>
        {sensitive && (
          <button onClick={() => setShown(!shown)} className="text-gray-500 hover:text-navy">
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
        <button onClick={onCopy} className="text-gray-500 hover:text-navy"><Copy size={16} /></button>
      </div>
    </div>
  )
}


/* ════════════════════════════════════════════════════════════════════ */
function DetailModal({ agencyId, agency, onClose }) {
  const [tab, setTab] = useState('info')
  const [calls, setCalls] = useState([])
  const [bookings, setBookings] = useState([])
  const [callsLoading, setCallsLoading] = useState(false)

  useEffect(() => {
    if (tab === 'calls') {
      setCallsLoading(true)
      agenciesAPI.apiCalls(agencyId)
        .then(r => setCalls(r.data || []))
        .catch(() => toast.error('Failed to load API calls'))
        .finally(() => setCallsLoading(false))
    } else if (tab === 'bookings') {
      agenciesAPI.bookings(agencyId)
        .then(r => setBookings(r.data || []))
        .catch(() => toast.error('Failed to load bookings'))
    }
  }, [tab, agencyId])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-display font-bold text-navy">{agency.name}</h2>
            <p className="text-xs text-gray-500 font-mono">{agency.code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="border-b flex">
          {[
            { id: 'info',     label: 'Info' },
            { id: 'calls',    label: 'Recent API Calls' },
            { id: 'bookings', label: 'Bookings' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className={`px-4 py-3 text-sm font-medium ${tab === t.id ? 'border-b-2 border-gold text-navy' : 'text-gray-500'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[500px] overflow-y-auto">
          {tab === 'info' && (
            <div className="space-y-2 text-sm">
              <KV label="Name" value={agency.name} />
              <KV label="Code" value={agency.code} mono />
              <KV label="Email" value={agency.contact_email} />
              <KV label="Phone" value={agency.contact_phone} />
              <KV label="Website" value={agency.website} />
              <KV label="Webhook" value={agency.webhook_url || '— not configured —'} mono />
              <KV label="API Key" value={agency.api_key} mono />
              <KV label="Status" value={agency.status} />
              <KV label="Commission %" value={agency.commission_pct} />
              <KV label="Markup %" value={agency.rate_markup_pct} />
              <KV label="Allowed Types" value={agency.allowed_room_types} mono />
              <KV label="Daily Limit" value={agency.daily_booking_limit || 'Unlimited'} />
              <KV label="Max Advance Days" value={agency.max_advance_days} />
              <KV label="Total Bookings" value={agency.total_bookings} />
              <KV label="Total Revenue" value={`₹${(agency.total_revenue || 0).toLocaleString('en-IN')}`} />
              <KV label="Last Used" value={agency.last_used_at ? new Date(agency.last_used_at).toLocaleString('en-IN') : 'Never'} />
            </div>
          )}

          {tab === 'calls' && (
            callsLoading ? <p className="text-gray-400 text-sm">Loading...</p>
            : calls.length === 0 ? <p className="text-gray-400 text-sm">No API calls yet.</p>
            : <table className="data-table text-xs">
                <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>ms</th></tr></thead>
                <tbody>
                  {calls.map(c => (
                    <tr key={c.id}>
                      <td>{new Date(c.called_at).toLocaleString('en-IN')}</td>
                      <td><code>{c.method}</code></td>
                      <td className="font-mono text-[11px]">{c.path}</td>
                      <td>
                        <span className={c.status_code >= 400 ? 'text-red-600' : 'text-green-600'}>
                          {c.status_code}
                        </span>
                      </td>
                      <td>{c.response_ms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          )}

          {tab === 'bookings' && (
            bookings.length === 0 ? <p className="text-gray-400 text-sm">No bookings yet.</p>
            : <table className="data-table text-xs">
                <thead><tr><th>Ref</th><th>Guest</th><th>Dates</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {bookings.map(b => (
                    <tr key={b.booking_id}>
                      <td className="font-mono text-[11px]">{b.booking_ref}</td>
                      <td>{b.guest_name}</td>
                      <td>{b.checkin_date} → {b.checkout_date}</td>
                      <td>₹{b.total_amount.toLocaleString('en-IN')}</td>
                      <td>{b.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          )}
        </div>
      </div>
    </div>
  )
}

function KV({ label, value, mono = false }) {
  return (
    <div className="flex">
      <div className="w-40 text-gray-500">{label}</div>
      <div className={`flex-1 text-navy ${mono ? 'font-mono text-xs' : ''}`}>{value || '—'}</div>
    </div>
  )
}
