import React, { useState, useEffect } from 'react'
import { Tag, Plus, X, Edit3, Trash2, Calculator, ToggleLeft, ToggleRight } from 'lucide-react'
import { toast } from 'react-toastify'
import { ratePlansAPI } from '../services/api'

/**
 * Rate Plans page — seasonal / weekend / promotional pricing.
 *
 * Multiple plans can stack on the same night (priority order). The
 * "Preview tariff" panel at the top lets staff sanity-check what the
 * effective price will be for a given room type + date + base tariff
 * BEFORE saving a plan that might over- or under-shoot.
 */
const DAYS = [
  ['Mon', 1], ['Tue', 2], ['Wed', 4], ['Thu', 8],
  ['Fri', 16], ['Sat', 32], ['Sun', 64],
]

export default function RatePlans() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // plan object or {} for new
  const [activeOnly, setActiveOnly] = useState(false)

  const fetchPlans = async () => {
    setLoading(true)
    try {
      const res = await ratePlansAPI.list({ active_only: activeOnly })
      setPlans(res.data || [])
    } catch {
      toast.error('Failed to load rate plans')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPlans() /* eslint-disable-next-line */ }, [activeOnly])

  const handleToggle = async (p) => {
    try {
      await ratePlansAPI.update(p.plan_id, { is_active: !p.is_active })
      toast.success(`Plan ${!p.is_active ? 'activated' : 'deactivated'}`)
      fetchPlans()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    }
  }

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete plan "${p.name}"? Past bookings keep their already-resolved tariff.`)) return
    try {
      await ratePlansAPI.delete(p.plan_id)
      toast.success('Plan deleted')
      fetchPlans()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    }
  }

  // Render a human-readable scope summary like "Weekends · ₹2000+ AC rooms · Aug–Sep"
  const summariseScope = (p) => {
    const parts = []
    if (p.day_of_week_mask) {
      const days = DAYS.filter(([, b]) => p.day_of_week_mask & b).map(([d]) => d)
      parts.push(days.length === 7 ? 'Every day' : days.join(', '))
    }
    if (p.room_type) parts.push(`${p.room_type} only`)
    if (p.valid_from || p.valid_to) {
      const a = p.valid_from || '…'
      const b = p.valid_to || '…'
      parts.push(`${a} → ${b}`)
    }
    return parts.length ? parts.join(' · ') : 'All rooms, all dates'
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Rate Plans</h1>
          <p className="text-ink-500 text-sm mt-1">
            Seasonal, weekend, and promotional adjustments applied on top of base tariffs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={activeOnly}
                   onChange={e => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <button onClick={() => setEditing({})}
                  className="bg-gold hover:bg-gold/90 text-navy-dark px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm">
            <Plus size={16}/> New Plan
          </button>
        </div>
      </div>

      <PreviewPanel />

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Tag size={40} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">No rate plans yet.</p>
          <p className="text-ink-400 text-xs mt-1">Without plans, every room sells at its base tariff.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Scope</th>
                <th className="text-right px-4 py-3">Adjustment</th>
                <th className="text-center px-4 py-3 hidden sm:table-cell">Priority</th>
                <th className="text-center px-4 py-3">Active</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.plan_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-navy">{p.name}</div>
                    {p.description && <div className="text-xs text-ink-500 mt-0.5">{p.description}</div>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-xs text-ink-500">
                    {summariseScope(p)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold">
                    {p.adjustment_type === 'percent'
                      ? <span className={p.adjustment_value >= 0 ? 'text-amber-600' : 'text-green-600'}>
                          {p.adjustment_value >= 0 ? '+' : ''}{p.adjustment_value}%
                        </span>
                      : <span className={p.adjustment_value >= 0 ? 'text-amber-600' : 'text-green-600'}>
                          {p.adjustment_value >= 0 ? '+' : '−'}₹{Math.abs(p.adjustment_value).toLocaleString('en-IN')}
                        </span>}
                  </td>
                  <td className="px-4 py-2.5 text-center hidden sm:table-cell text-ink-500">{p.priority}</td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => handleToggle(p)} className="text-2xl">
                      {p.is_active
                        ? <ToggleRight className="text-green-500"/>
                        : <ToggleLeft className="text-ink-300"/>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => setEditing(p)} className="text-navy/60 hover:text-navy" title="Edit">
                        <Edit3 size={14}/>
                      </button>
                      <button onClick={() => handleDelete(p)} className="text-red-400 hover:text-red-600" title="Delete">
                        <Trash2 size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <PlanModal plan={editing.plan_id ? editing : null}
                   onClose={() => setEditing(null)}
                   onSaved={() => { setEditing(null); fetchPlans() }} />
      )}
    </div>
  )
}

/** Live tariff calculator — type a base + date + room type and see the
 *  resolved price after all active plans stack. Useful for verifying a
 *  newly-added plan does what you think it does. */
function PreviewPanel() {
  const today = new Date().toISOString().slice(0, 10)
  const [baseTariff, setBaseTariff] = useState('1500')
  const [roomType, setRoomType] = useState('')
  const [forDate, setForDate] = useState(today)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const calc = async () => {
    const bt = parseFloat(baseTariff)
    if (!bt || bt <= 0) { toast.error('Base tariff must be > 0'); return }
    setLoading(true)
    try {
      const res = await ratePlansAPI.preview({
        base_tariff: bt,
        for_date: forDate,
        room_type: roomType || undefined,
      })
      setResult(res.data)
    } catch (e) {
      toast.error('Preview failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-gradient-to-br from-navy/5 to-gold/5 border border-gold/30 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-navy mb-3 flex items-center gap-2">
        <Calculator size={14}/> Tariff Preview
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-ink-600 uppercase tracking-wide mb-1">Base ₹</label>
          <input type="number" value={baseTariff} onChange={e => setBaseTariff(e.target.value)}
                 className="w-full px-3 py-2 border border-ink-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-600 uppercase tracking-wide mb-1">Room type</label>
          <input type="text" value={roomType} onChange={e => setRoomType(e.target.value)}
                 placeholder="any"
                 className="w-full px-3 py-2 border border-ink-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-ink-600 uppercase tracking-wide mb-1">Date</label>
          <input type="date" value={forDate} onChange={e => setForDate(e.target.value)}
                 className="w-full px-3 py-2 border border-ink-300 rounded-lg text-sm" />
        </div>
        <button onClick={calc} disabled={loading}
                className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
          {loading ? '…' : 'Calculate'}
        </button>
      </div>
      {result && (
        <div className="mt-4 pt-4 border-t border-gold/20">
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-sm text-ink-500">Effective tariff:</span>
            <span className="text-3xl font-bold text-navy">
              ₹{Number(result.effective_tariff).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </span>
          </div>
          {result.applied_plans.length === 0 ? (
            <p className="text-xs text-ink-500">No plans matched — using base tariff.</p>
          ) : (
            <div className="space-y-1">
              {result.applied_plans.map((p, i) => (
                <div key={i} className="text-xs flex justify-between text-ink-600">
                  <span>↳ {p.name} ({p.type === 'percent' ? `${p.value}%` : `₹${p.value}`})</span>
                  <span>₹{p.tariff_before.toLocaleString('en-IN')} → ₹{p.tariff_after.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlanModal({ plan = null, onClose, onSaved }) {
  const isEdit = !!plan
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    room_type: plan?.room_type || '',
    day_of_week_mask: plan?.day_of_week_mask || 0,
    valid_from: plan?.valid_from || '',
    valid_to: plan?.valid_to || '',
    adjustment_type: plan?.adjustment_type || 'percent',
    adjustment_value: plan?.adjustment_value ?? 10,
    priority: plan?.priority ?? 10,
    is_active: plan?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const toggleDay = (bit) => {
    setForm(s => ({ ...s, day_of_week_mask: (s.day_of_week_mask ^ bit) }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name required'); return }
    const value = parseFloat(form.adjustment_value)
    if (isNaN(value)) { toast.error('Adjustment value must be a number'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        room_type: form.room_type || null,
        // Send mask as null when 0/all-days — backend treats both as "any day".
        day_of_week_mask: form.day_of_week_mask || null,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        adjustment_type: form.adjustment_type,
        adjustment_value: value,
        priority: parseInt(form.priority, 10) || 10,
        is_active: form.is_active,
      }
      if (isEdit) await ratePlansAPI.update(plan.plan_id, payload)
      else await ratePlansAPI.create(payload)
      toast.success(`Plan ${isEdit ? 'updated' : 'created'}`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">
            {isEdit ? `Edit "${plan.name}"` : 'New Rate Plan'}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X size={20}/>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Name *</label>
            <input type="text" value={form.name}
                   onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
                   className="input-field"
                   placeholder="e.g. Weekend +20%" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Description</label>
            <textarea value={form.description}
                      onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
                      rows={2}
                      className="input-field"
                      placeholder="Optional notes" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Days of Week</label>
            <div className="flex gap-1 flex-wrap">
              {DAYS.map(([label, bit]) => {
                const on = (form.day_of_week_mask & bit) !== 0
                return (
                  <button key={bit} type="button" onClick={() => toggleDay(bit)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            on ? 'bg-gold border-gold text-navy-dark' : 'bg-white border-ink-300 text-ink-600 hover:bg-ink-50'
                          }`}>
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-ink-400 mt-1">
              Select none = applies every day. Selecting all 7 has the same effect.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Valid From</label>
              <input type="date" value={form.valid_from}
                     onChange={e => setForm(s => ({ ...s, valid_from: e.target.value }))}
                     className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Valid To</label>
              <input type="date" value={form.valid_to}
                     onChange={e => setForm(s => ({ ...s, valid_to: e.target.value }))}
                     className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
              Room Type <span className="text-ink-400 normal-case">(blank = all types)</span>
            </label>
            <input type="text" value={form.room_type}
                   onChange={e => setForm(s => ({ ...s, room_type: e.target.value }))}
                   className="input-field"
                   placeholder="e.g. deluxe_ac" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Adjustment</label>
              <select value={form.adjustment_type}
                      onChange={e => setForm(s => ({ ...s, adjustment_type: e.target.value }))}
                      className="input-field">
                <option value="percent">Percent (%)</option>
                <option value="flat">Flat (₹)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
                Value <span className="text-ink-400 normal-case">(negative = discount)</span>
              </label>
              <input type="number" step="0.01" value={form.adjustment_value}
                     onChange={e => setForm(s => ({ ...s, adjustment_value: e.target.value }))}
                     className="input-field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
                Priority <span className="text-ink-400 normal-case">(lower runs first)</span>
              </label>
              <input type="number" min="0" value={form.priority}
                     onChange={e => setForm(s => ({ ...s, priority: e.target.value }))}
                     className="input-field" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" checked={form.is_active}
                     onChange={e => setForm(s => ({ ...s, is_active: e.target.checked }))} />
              <span>Active</span>
            </label>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Plan')}
          </button>
        </div>
      </form>
    </div>
  )
}
