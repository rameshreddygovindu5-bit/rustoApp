import React, { useState, useEffect } from 'react'
import { Sparkles, Play, CheckCircle, AlertOctagon, Plus, Filter, BedDouble, X, User, Clock } from 'lucide-react'
import { toast } from 'react-toastify'
import { housekeepingAPI, roomsAPI, authAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Housekeeping page — daily cleaning workflow.
 *
 * Tabs: Pending / In Progress / Completed / Inspection Failed.
 * Admin can create tasks (deep clean, maintenance) and assign housekeepers.
 * Staff can start / complete their assigned tasks.
 * Admin can inspect completed tasks (pass/fail) — failed rolls back to pending.
 */
const STATUS_META = {
  pending: { label: 'Pending', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  in_progress: { label: 'In Progress', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  completed: { label: 'Completed', color: 'bg-green-50 text-green-700 border-green-200' },
  inspection_failed: { label: 'Inspection Failed', color: 'bg-red-50 text-red-700 border-red-200' },
}

export default function Housekeeping() {
  const { isAdmin, user } = useAuth()
  const [tab, setTab] = useState('pending')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const res = await housekeepingAPI.list({ status: tab })
      setTasks(res.data || [])
    } catch {
      toast.error('Failed to load housekeeping tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTasks() /* eslint-disable-next-line */ }, [tab])

  const handleStart = async (t) => {
    try {
      await housekeepingAPI.start(t.task_id)
      toast.success(`Started cleaning room ${t.room_number}`)
      fetchTasks()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start')
    }
  }

  const handleComplete = async (t) => {
    const notes = window.prompt('Completion notes (optional):') || ''
    try {
      await housekeepingAPI.complete(t.task_id, notes)
      toast.success(`Room ${t.room_number} marked clean`)
      fetchTasks()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to complete')
    }
  }

  const handleInspect = async (t, passed) => {
    let notes = ''
    if (!passed) {
      notes = window.prompt('What needs to be redone?') || ''
      if (!notes) return
    }
    try {
      await housekeepingAPI.inspect(t.task_id, passed, notes)
      toast.success(passed ? 'Inspection passed' : 'Task sent back to pending')
      fetchTasks()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to inspect')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Housekeeping</h1>
          <p className="text-ink-500 text-sm mt-1">
            Cleaning workflow. Tasks auto-created on checkout; admins can also schedule maintenance + deep cleans.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-gold hover:bg-gold/90 text-navy-dark px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm"
          >
            <Plus size={16} /> New Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-ink-200">
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-gold text-gold'
                : 'border-transparent text-ink-500 hover:text-navy'
            }`}
          >
            {meta.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Sparkles size={40} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-500">No {STATUS_META[tab].label.toLowerCase()} tasks.</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map(t => (
            <div key={t.task_id} className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BedDouble size={18} className="text-gold" />
                  <span className="font-bold text-navy">Room {t.room_number}</span>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_META[t.status].color}`}>
                  {STATUS_META[t.status].label}
                </span>
              </div>

              <p className="text-xs text-ink-500 mb-1">
                <strong className="text-ink-700">Type:</strong> {t.task_type.replace(/_/g, ' ')}
              </p>
              {t.assignee_name && (
                <p className="text-xs text-ink-500 mb-1 flex items-center gap-1">
                  <User size={11} /> {t.assignee_name}
                </p>
              )}
              {t.notes && (
                <p className="text-xs text-ink-600 mt-2 bg-ink-50 p-2 rounded">
                  {t.notes}
                </p>
              )}
              {t.completion_notes && (
                <p className="text-xs text-ink-600 mt-2 bg-green-50 border border-green-100 p-2 rounded">
                  ✓ {t.completion_notes}
                </p>
              )}
              {t.started_at && (
                <p className="text-[11px] text-ink-400 mt-2 flex items-center gap-1">
                  <Clock size={10} />
                  Started {new Date(t.started_at).toLocaleString()}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-ink-100">
                {t.status === 'pending' && (
                  <button
                    onClick={() => handleStart(t)}
                    className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center justify-center gap-1"
                  >
                    <Play size={12} /> Start
                  </button>
                )}
                {t.status === 'in_progress' && (
                  <button
                    onClick={() => handleComplete(t)}
                    className="flex-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium flex items-center justify-center gap-1"
                  >
                    <CheckCircle size={12} /> Complete
                  </button>
                )}
                {t.status === 'completed' && isAdmin && (
                  <>
                    <button
                      onClick={() => handleInspect(t, true)}
                      className="flex-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium"
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => handleInspect(t, false)}
                      className="flex-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <AlertOctagon size={12} /> Fail
                    </button>
                  </>
                )}
                {t.status === 'inspection_failed' && (
                  <button
                    onClick={() => handleStart(t)}
                    className="flex-1 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded text-xs font-medium"
                  >
                    Redo
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchTasks() }}
        />
      )}
    </div>
  )
}

function CreateTaskModal({ onClose, onCreated }) {
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ room_id: '', task_type: 'deep_clean', notes: '', assigned_to: '' })
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
    if (!form.room_id) { toast.error('Pick a room'); return }
    setSaving(true)
    try {
      await housekeepingAPI.create({
        room_id: parseInt(form.room_id, 10),
        task_type: form.task_type,
        notes: form.notes || null,
        assigned_to: form.assigned_to ? parseInt(form.assigned_to, 10) : null,
      })
      toast.success('Task created')
      onCreated()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">New Task</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X size={20}/>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Room *</label>
            <select
              value={form.room_id}
              onChange={e => setForm(s => ({ ...s, room_id: e.target.value }))}
              className="w-full px-3 py-2 border border-ink-300 rounded-lg"
            >
              <option value="">— select —</option>
              {rooms.map(r => (
                <option key={r.room_id} value={r.room_id}>
                  Room {r.room_number} ({r.room_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Task Type</label>
            <select
              value={form.task_type}
              onChange={e => setForm(s => ({ ...s, task_type: e.target.value }))}
              className="w-full px-3 py-2 border border-ink-300 rounded-lg"
            >
              <option value="checkout_clean">Checkout Clean</option>
              <option value="daily_turnover">Daily Turnover</option>
              <option value="deep_clean">Deep Clean</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
              Assign to <span className="text-ink-400 normal-case">(optional)</span>
            </label>
            <select
              value={form.assigned_to}
              onChange={e => setForm(s => ({ ...s, assigned_to: e.target.value }))}
              className="w-full px-3 py-2 border border-ink-300 rounded-lg"
            >
              <option value="">Unassigned</option>
              {users.filter(u => u.is_active).map(u => (
                <option key={u.user_id} value={u.user_id}>{u.full_name} (@{u.username})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(s => ({ ...s, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-ink-300 rounded-lg"
              placeholder="e.g. AC making noise — needs technician"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}
