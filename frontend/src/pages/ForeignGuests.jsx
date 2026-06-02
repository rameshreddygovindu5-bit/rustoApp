import React, { useState, useEffect } from 'react'
import { Flag, AlertTriangle, Download, X, CheckCircle, Clock, Edit3 } from 'lucide-react'
import { toast } from 'react-toastify'
import { foreignGuestsAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

const STATUS_META = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700 border-amber-300', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700 border-blue-300', icon: CheckCircle },
  confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-700 border-green-300', icon: CheckCircle },
  not_required: { label: 'Not Required', color: 'bg-gray-100 text-gray-600 border-gray-300', icon: X },
}

/**
 * Foreign Guests page — India FRRO / C-Form compliance.
 *
 * Rows auto-created at check-in when the guest's id_type is 'passport'.
 * Hotels must file the C-Form within 24 hours; the page flags any pending
 * registration older than 24 hours as overdue (regulatory red flag).
 */
export default function ForeignGuests() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const [list, st] = await Promise.all([
        foreignGuestsAPI.list(tab === 'all' ? {} : { status: tab }),
        foreignGuestsAPI.stats(),
      ])
      setRows(list.data || [])
      setStats(st.data)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { fetch() /* eslint-disable-next-line */ }, [tab])

  const handleExport = async () => {
    try {
      const res = await foreignGuestsAPI.exportCsv({})
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `foreign-guests-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Export failed') }
  }

  const isOverdue = (r) => {
    if (r.status !== 'pending') return false
    const created = new Date(r.created_at).getTime()
    return Date.now() - created > 24 * 3600 * 1000
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Foreign Guests (C-Form)</h1>
          <p className="text-gray-500 text-sm mt-1">
            FRRO compliance — auto-created on check-in of guests with passport ID. File within 24 hours.
          </p>
        </div>
        <button onClick={handleExport}
                className="bg-navy hover:bg-navy/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
          <Download size={14}/> Export CSV
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(STATUS_META).map(([k, m]) => (
            <div key={k} className="bg-white rounded-xl shadow-sm p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</div>
              <div className="text-2xl font-bold text-navy mt-1">{stats.by_status?.[k] || 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Overdue alert */}
      {stats?.pending_overdue_24h > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5"/>
          <div>
            <h3 className="font-semibold text-red-700">
              {stats.pending_overdue_24h} registration{stats.pending_overdue_24h > 1 ? 's' : ''} overdue
            </h3>
            <p className="text-sm text-red-600 mt-1">
              These are pending more than 24 hours since check-in. FRRO requires submission within 24h.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {[['pending', 'Pending'], ['submitted', 'Submitted'], ['confirmed', 'Confirmed'], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${
                    tab === k ? 'border-gold text-gold' : 'border-transparent text-gray-500 hover:text-navy'
                  }`}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Flag size={40} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500">No registrations in this view.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Guest</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Nationality</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Passport</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Checked In</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const overdue = isOverdue(r)
                const Status = STATUS_META[r.status] || STATUS_META.pending
                return (
                  <tr key={r.registration_id}
                      className={`border-t border-gray-100 ${overdue ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-navy">{r.customer_name || `#${r.customer_id}`}</div>
                      {overdue && (
                        <div className="text-[11px] text-red-600 font-medium mt-0.5 flex items-center gap-1">
                          <AlertTriangle size={10}/> Overdue
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-gray-600">{r.nationality || '—'}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell font-mono text-xs text-gray-600">{r.passport_number || '—'}</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-gray-500 text-xs">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${Status.color}`}>
                        {Status.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setEditing(r)} className="text-navy/60 hover:text-navy">
                        <Edit3 size={14}/>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal reg={editing} onClose={() => setEditing(null)}
                   onSaved={() => { setEditing(null); fetch() }} />
      )}
    </div>
  )
}

function EditModal({ reg, onClose, onSaved }) {
  const [f, setF] = useState({
    passport_number: reg.passport_number || '',
    passport_expiry: reg.passport_expiry || '',
    nationality: reg.nationality || '',
    visa_number: reg.visa_number || '',
    visa_type: reg.visa_type || '',
    visa_expiry: reg.visa_expiry || '',
    arrival_date_in_india: reg.arrival_date_in_india || '',
    arrival_from_country: reg.arrival_from_country || '',
    departure_to_country: reg.departure_to_country || '',
    purpose_of_visit: reg.purpose_of_visit || '',
    status: reg.status || 'pending',
    frro_reference: reg.frro_reference || '',
    notes: reg.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])
      )
      await foreignGuestsAPI.update(reg.registration_id, payload)
      toast.success('Updated')
      onSaved()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
    finally { setSaving(false) }
  }
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">C-Form Details</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Passport Number" value={f.passport_number} onChange={v => set('passport_number', v)} mono/>
            <Field label="Passport Expiry" type="date" value={f.passport_expiry} onChange={v => set('passport_expiry', v)}/>
            <Field label="Nationality" value={f.nationality} onChange={v => set('nationality', v)}/>
            <Field label="Visa Number" value={f.visa_number} onChange={v => set('visa_number', v)} mono/>
            <Field label="Visa Type" value={f.visa_type} onChange={v => set('visa_type', v)} placeholder="tourist, business, …"/>
            <Field label="Visa Expiry" type="date" value={f.visa_expiry} onChange={v => set('visa_expiry', v)}/>
            <Field label="Arrival in India" type="date" value={f.arrival_date_in_india} onChange={v => set('arrival_date_in_india', v)}/>
            <Field label="Arrived From" value={f.arrival_from_country} onChange={v => set('arrival_from_country', v)}/>
            <Field label="Next Destination" value={f.departure_to_country} onChange={v => set('departure_to_country', v)}/>
            <Field label="Purpose" value={f.purpose_of_visit} onChange={v => set('purpose_of_visit', v)} placeholder="tourism, business…"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Status</label>
              <select value={f.status} onChange={e => set('status', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="confirmed">Confirmed</option>
                <option value="not_required">Not Required</option>
              </select>
            </div>
            <Field label="FRRO Reference" value={f.frro_reference} onChange={v => set('frro_reference', v)} mono/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Notes</label>
            <textarea value={f.notes} onChange={e => set('notes', e.target.value)}
                      rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, mono = false }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">{label}</label>
      <input type={type} value={value} placeholder={placeholder}
             onChange={e => onChange(e.target.value)}
             className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${mono ? 'font-mono' : ''}`}/>
    </div>
  )
}
