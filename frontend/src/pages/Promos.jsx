import React, { useState, useEffect } from 'react'
import { Percent, Plus, Edit3, Trash2, X, ToggleLeft, ToggleRight, Copy } from 'lucide-react'
import { toast } from 'react-toastify'
import { promosAPI } from '../services/api'

/**
 * Promo Codes admin page.
 *
 * Codes are per-lodge. Their validation + redemption happens at checkout
 * time — the checkout endpoint accepts a `promo_code` field and applies
 * the discount BEFORE GST so guests aren't taxed on the savings.
 */
export default function Promos() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [activeOnly, setActiveOnly] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const res = await promosAPI.list({ active_only: activeOnly })
      setRows(res.data || [])
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { fetch() /* eslint-disable-next-line */ }, [activeOnly])

  const handleToggle = async (p) => {
    try {
      await promosAPI.update(p.promo_id, { is_active: !p.is_active })
      fetch()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
  }
  const handleDelete = async (p) => {
    if (!window.confirm(`Delete code "${p.code}"?`)) return
    try { await promosAPI.delete(p.promo_id); toast.success('Deleted'); fetch() }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed') }
  }
  const handleCopy = async (code) => {
    try { await navigator.clipboard.writeText(code); toast.success(`Copied "${code}"`) }
    catch { toast.info(code) }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Promo Codes</h1>
          <p className="text-gray-500 text-sm mt-1">
            Discount codes redeemable at checkout. Applied before GST so guests aren't taxed on savings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={activeOnly}
                   onChange={e => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <button onClick={() => setEditing({})}
                  className="bg-gold hover:bg-gold/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm">
            <Plus size={16}/> New Code
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Percent size={40} className="mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500">No promo codes yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-right px-4 py-3">Discount</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Min Bill</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Validity</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Uses</th>
                <th className="text-center px-4 py-3">Active</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.promo_id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5">
                    <button onClick={() => handleCopy(p.code)}
                            className="font-mono font-bold text-navy flex items-center gap-1 hover:text-gold">
                      {p.code} <Copy size={11} className="opacity-50"/>
                    </button>
                    {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-600">
                    {p.discount_type === 'percent'
                      ? `${p.discount_value}%${p.max_discount_amount ? ` (max ₹${p.max_discount_amount})` : ''}`
                      : `₹${Number(p.discount_value).toLocaleString('en-IN')}`}
                  </td>
                  <td className="px-4 py-2.5 text-right hidden md:table-cell text-gray-600">
                    {p.amount_min > 0 ? `₹${Number(p.amount_min).toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell text-xs text-gray-500">
                    {(p.valid_from || p.valid_to)
                      ? `${p.valid_from || '…'} → ${p.valid_to || '…'}`
                      : 'No expiry'}
                  </td>
                  <td className="px-4 py-2.5 text-right hidden sm:table-cell text-gray-700">
                    {p.times_used}{p.max_uses !== null ? `/${p.max_uses}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button onClick={() => handleToggle(p)}>
                      {p.is_active
                        ? <ToggleRight className="text-green-500" size={28}/>
                        : <ToggleLeft className="text-gray-300" size={28}/>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => setEditing(p)} className="text-navy/60 hover:text-navy"><Edit3 size={14}/></button>
                      <button onClick={() => handleDelete(p)} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && (
        <PromoModal promo={editing.promo_id ? editing : null}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); fetch() }} />
      )}
    </div>
  )
}

function PromoModal({ promo = null, onClose, onSaved }) {
  const isEdit = !!promo
  const [f, setF] = useState({
    code: promo?.code || '',
    description: promo?.description || '',
    discount_type: promo?.discount_type || 'percent',
    discount_value: promo?.discount_value ?? 10,
    max_discount_amount: promo?.max_discount_amount ?? '',
    amount_min: promo?.amount_min ?? 0,
    valid_from: promo?.valid_from || '',
    valid_to: promo?.valid_to || '',
    max_uses: promo?.max_uses ?? '',
    is_active: promo?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const dv = parseFloat(f.discount_value)
    if (!dv || dv <= 0) { toast.error('Discount value must be > 0'); return }
    if (!isEdit && !f.code.trim()) { toast.error('Code required'); return }
    setSaving(true)
    try {
      const payload = {
        description: f.description || null,
        discount_value: dv,
        max_discount_amount: f.max_discount_amount === '' ? null : parseFloat(f.max_discount_amount),
        amount_min: parseFloat(f.amount_min) || 0,
        valid_from: f.valid_from || null,
        valid_to: f.valid_to || null,
        max_uses: f.max_uses === '' ? null : parseInt(f.max_uses, 10),
        is_active: f.is_active,
      }
      if (isEdit) {
        await promosAPI.update(promo.promo_id, payload)
      } else {
        await promosAPI.create({ ...payload, code: f.code.trim().toUpperCase(), discount_type: f.discount_type })
      }
      toast.success(`Promo ${isEdit ? 'updated' : 'created'}`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">
            {isEdit ? `Edit "${promo.code}"` : 'New Promo Code'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Code * <span className="text-gray-400 normal-case">(uppercase, no spaces)</span>
            </label>
            <input type="text" value={f.code} disabled={isEdit}
                   onChange={e => setF(s => ({ ...s, code: e.target.value.toUpperCase().replace(/\s+/g, '') }))}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono uppercase disabled:bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Description</label>
            <input type="text" value={f.description}
                   onChange={e => setF(s => ({ ...s, description: e.target.value }))}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                   placeholder="e.g. Welcome 10% off" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Type</label>
                <select value={f.discount_type}
                        onChange={e => setF(s => ({ ...s, discount_type: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="percent">Percent (%)</option>
                  <option value="flat">Flat (₹)</option>
                </select>
              </div>
            )}
            <div className={isEdit ? 'col-span-2' : ''}>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Value *</label>
              <input type="number" min="0" step="0.01" value={f.discount_value}
                     onChange={e => setF(s => ({ ...s, discount_value: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Max Discount (₹) <span className="text-gray-400 normal-case">(cap for %)</span>
              </label>
              <input type="number" min="0" step="0.01" value={f.max_discount_amount}
                     onChange={e => setF(s => ({ ...s, max_discount_amount: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Min Bill (₹)</label>
              <input type="number" min="0" step="0.01" value={f.amount_min}
                     onChange={e => setF(s => ({ ...s, amount_min: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Valid From</label>
              <input type="date" value={f.valid_from}
                     onChange={e => setF(s => ({ ...s, valid_from: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Valid To</label>
              <input type="date" value={f.valid_to}
                     onChange={e => setF(s => ({ ...s, valid_to: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Max Uses <span className="text-gray-400 normal-case">(blank = ∞)</span>
              </label>
              <input type="number" min="1" value={f.max_uses}
                     onChange={e => setF(s => ({ ...s, max_uses: e.target.value }))}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
              <input type="checkbox" checked={f.is_active}
                     onChange={e => setF(s => ({ ...s, is_active: e.target.checked }))} />
              Active
            </label>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Code')}
          </button>
        </div>
      </form>
    </div>
  )
}
