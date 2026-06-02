import React, { useState, useEffect } from 'react'
import { Wrench, Plus, X, AlertTriangle, CheckCircle2, Clock, PauseCircle, XCircle } from 'lucide-react'
import { toast } from 'react-toastify'
import { maintenanceAPI, roomsAPI, authAPI } from '../services/api'

const PRIORITY_META = {
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-300' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  medium: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  low: { label: 'Low', color: 'bg-gray-100 text-gray-600 border-gray-300' },
}

const STATUS_META = {
  open: { label: 'Open', icon: AlertTriangle, color: 'text-amber-600' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-blue-600' },
  awaiting_parts: { label: 'Awaiting Parts', icon: PauseCircle, color: 'text-purple-600' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'text-green-600' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-gray-400' },
}

const CATEGORIES = [
  'electrical', 'plumbing', 'ac_hvac', 'furniture', 'appliances',
  'structural', 'painting', 'networking', 'pest_control', 'other'
]

export default function Maintenance() {
  const [tickets, setTickets] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState('open')   // 'open' = open|in_progress|awaiting_parts
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filter && filter !== 'all') params.status = filter === 'open' ? undefined : filter
      const [tk, st] = await Promise.all([
        maintenanceAPI.list(params),
        maintenanceAPI.stats(),
      ])
      let rows = tk.data || []
      // "Open" filter means anything not yet resolved/cancelled.
      if (filter === 'open') {
        rows = rows.filter(r => !['resolved', 'cancelled'].includes(r.status))
      }
      setTickets(rows)
      setStats(st.data)
    } catch {
      toast.error('Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() /* eslint-disable-next-line */ }, [filter])

  const handleQuickStatus = async (t, status) => {
    try {
      await maintenanceAPI.update(t.ticket_id, { status })
      toast.success(`Marked ${STATUS_META[status].label.toLowerCase()}`)
      fetchAll()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to update')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Maintenance</h1>
          <p className="text-gray-500 text-sm mt-1">
            Building & equipment work-orders. Distinct from housekeeping cleaning rotation.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
                className="bg-gold hover:bg-gold/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm">
          <Plus size={16}/> New Ticket
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(STATUS_META).map(([k, m]) => {
            const Icon = m.icon
            const n = stats.by_status?.[k] ?? 0
            return (
              <div key={k} className="bg-white rounded-xl shadow-sm p-3 flex items-center gap-3">
                <Icon size={20} className={m.color}/>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</div>
                  <div className="text-xl font-bold text-navy">{n}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {[['open', 'Open & Active'], ['resolved', 'Resolved'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    filter === k ? 'border-gold text-gold' : 'border-transparent text-gray-500 hover:text-navy'
                  }`}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Wrench size={40} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500">No tickets in this view.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {tickets.map(t => {
            const Status = STATUS_META[t.status] || STATUS_META.open
            const StatusIcon = Status.icon
            return (
              <div key={t.ticket_id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-navy flex-1">{t.title}</h3>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${PRIORITY_META[t.priority]?.color}`}>
                    {PRIORITY_META[t.priority]?.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <StatusIcon size={12} className={Status.color}/>
                  <span>{Status.label}</span>
                  <span>·</span>
                  <span className="capitalize">{t.category.replace(/_/g, ' ')}</span>
                  {t.room_number && (<><span>·</span><span>Room {t.room_number}</span></>)}
                  {t.location && (<><span>·</span><span>{t.location}</span></>)}
                </div>
                {t.description && <p className="text-sm text-gray-600 mb-2">{t.description}</p>}
                {t.blocks_room_availability && t.room_number && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5 mb-2">
                    🚫 Room blocked until resolved
                  </p>
                )}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {t.assignee_name && <>👤 {t.assignee_name}</>}
                    {t.vendor_name && <span className="ml-2">🔧 {t.vendor_name}</span>}
                  </span>
                  {(t.estimated_cost !== null || t.actual_cost !== null) && (
                    <span>
                      {t.actual_cost !== null
                        ? <>₹{Number(t.actual_cost).toLocaleString('en-IN')}</>
                        : <>est. ₹{Number(t.estimated_cost).toLocaleString('en-IN')}</>}
                    </span>
                  )}
                </div>
                {/* Quick actions */}
                {!['resolved', 'cancelled'].includes(t.status) && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2 flex-wrap">
                    {t.status === 'open' && (
                      <button onClick={() => handleQuickStatus(t, 'in_progress')}
                              className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs">
                        Start work
                      </button>
                    )}
                    {t.status === 'in_progress' && (
                      <button onClick={() => handleQuickStatus(t, 'awaiting_parts')}
                              className="px-2.5 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-xs">
                        Awaiting parts
                      </button>
                    )}
                    <button onClick={() => setEditing(t)}
                            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs">
                      Edit / Resolve
                    </button>
                    <button onClick={() => handleQuickStatus(t, 'cancelled')}
                            className="px-2.5 py-1 text-gray-500 hover:text-red-600 text-xs ml-auto">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <TicketModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); fetchAll() }} />
      )}
      {editing && (
        <TicketModal ticket={editing} onClose={() => setEditing(null)}
                     onSaved={() => { setEditing(null); fetchAll() }} />
      )}
    </div>
  )
}

function TicketModal({ ticket = null, onClose, onSaved }) {
  const isEdit = !!ticket
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({
    title: ticket?.title || '',
    description: ticket?.description || '',
    category: ticket?.category || 'other',
    priority: ticket?.priority || 'medium',
    room_id: ticket?.room_id || '',
    location: ticket?.location || '',
    blocks_room_availability: ticket?.blocks_room_availability || false,
    estimated_cost: ticket?.estimated_cost ?? '',
    actual_cost: ticket?.actual_cost ?? '',
    assigned_to: ticket?.assigned_to || '',
    vendor_name: ticket?.vendor_name || '',
    resolution_notes: ticket?.resolution_notes || '',
    status: ticket?.status || 'open',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      roomsAPI.list({ page_size: 200 }).catch(() => ({ data: { data: [] } })),
      authAPI.listUsers().catch(() => ({ data: [] })),
    ]).then(([r, u]) => {
      setRooms(r.data?.data || r.data || [])
      setUsers(u.data || [])
    })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title required'); return }
    setSaving(true)
    try {
      if (isEdit) {
        const payload = {
          status: form.status,
          priority: form.priority,
          assigned_to: form.assigned_to ? parseInt(form.assigned_to, 10) : null,
          vendor_name: form.vendor_name || null,
          estimated_cost: form.estimated_cost === '' ? null : parseFloat(form.estimated_cost),
          actual_cost: form.actual_cost === '' ? null : parseFloat(form.actual_cost),
          resolution_notes: form.resolution_notes || null,
          blocks_room_availability: !!form.blocks_room_availability,
        }
        await maintenanceAPI.update(ticket.ticket_id, payload)
        toast.success('Ticket updated')
      } else {
        await maintenanceAPI.create({
          title: form.title.trim(),
          description: form.description || null,
          category: form.category,
          priority: form.priority,
          room_id: form.room_id ? parseInt(form.room_id, 10) : null,
          location: form.location || null,
          blocks_room_availability: !!form.blocks_room_availability,
          estimated_cost: form.estimated_cost === '' ? null : parseFloat(form.estimated_cost),
          assigned_to: form.assigned_to ? parseInt(form.assigned_to, 10) : null,
          vendor_name: form.vendor_name || null,
        })
        toast.success('Ticket created')
      }
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">
            {isEdit ? 'Edit Ticket' : 'New Maintenance Ticket'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20}/>
          </button>
        </div>
        <div className="p-5 space-y-3">
          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Title *</label>
              <input type="text" value={form.title}
                     onChange={e => setForm(s => ({ ...s, title: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                     placeholder="e.g. AC compressor not cooling" />
            </div>
          )}
          {!isEdit && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Description</label>
              <textarea value={form.description}
                        onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Category</label>
                <select value={form.category}
                        onChange={e => setForm(s => ({ ...s, category: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Priority</label>
              <select value={form.priority}
                      onChange={e => setForm(s => ({ ...s, priority: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Status</label>
                <select value={form.status}
                        onChange={e => setForm(s => ({ ...s, status: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="awaiting_parts">Awaiting Parts</option>
                  <option value="resolved">Resolved</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            )}
          </div>
          {!isEdit && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Room</label>
                <select value={form.room_id}
                        onChange={e => setForm(s => ({ ...s, room_id: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">— common area —</option>
                  {rooms.map(r => <option key={r.room_id} value={r.room_id}>Room {r.room_number}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Location</label>
                <input type="text" value={form.location}
                       onChange={e => setForm(s => ({ ...s, location: e.target.value }))}
                       className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                       placeholder="e.g. lobby, rooftop" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Assignee</label>
              <select value={form.assigned_to}
                      onChange={e => setForm(s => ({ ...s, assigned_to: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Unassigned</option>
                {users.filter(u => u.is_active).map(u => (
                  <option key={u.user_id} value={u.user_id}>{u.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Vendor</label>
              <input type="text" value={form.vendor_name}
                     onChange={e => setForm(s => ({ ...s, vendor_name: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                     placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Estimated Cost (₹)</label>
              <input type="number" min="0" step="0.01" value={form.estimated_cost}
                     onChange={e => setForm(s => ({ ...s, estimated_cost: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Actual Cost (₹)</label>
                <input type="number" min="0" step="0.01" value={form.actual_cost}
                       onChange={e => setForm(s => ({ ...s, actual_cost: e.target.value }))}
                       className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.blocks_room_availability}
                   onChange={e => setForm(s => ({ ...s, blocks_room_availability: e.target.checked }))} />
            <span>Block this room from being sold until resolved</span>
          </label>
          {isEdit && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Resolution Notes</label>
              <textarea value={form.resolution_notes}
                        onChange={e => setForm(s => ({ ...s, resolution_notes: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        placeholder="What was actually done to resolve it..." />
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : (isEdit ? 'Save' : 'Create Ticket')}
          </button>
        </div>
      </form>
    </div>
  )
}
