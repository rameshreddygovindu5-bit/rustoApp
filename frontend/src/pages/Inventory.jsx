import React, { useState, useEffect } from 'react'
import { Package, Plus, AlertTriangle, X, TrendingUp, TrendingDown, History } from 'lucide-react'
import { toast } from 'react-toastify'
import { inventoryAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = [
  'toiletries', 'linen', 'cleaning_supplies', 'stationery',
  'food_beverage', 'kitchen', 'electrical', 'consumables', 'other'
]
const UNITS = ['piece', 'pack', 'box', 'bottle', 'kg', 'g', 'litre', 'ml', 'metre', 'roll']

export default function Inventory() {
  const { isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [filter, setFilter] = useState({ category: '', lowStockOnly: false })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [movementFor, setMovementFor] = useState(null)
  const [historyFor, setHistoryFor] = useState(null)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const params = {}
      if (filter.category) params.category = filter.category
      if (filter.lowStockOnly) params.low_stock_only = true
      const [it, sm] = await Promise.all([
        inventoryAPI.listItems(params),
        inventoryAPI.summary(),
      ])
      setItems(it.data || [])
      setSummary(sm.data)
    } catch {
      toast.error('Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() /* eslint-disable-next-line */ }, [filter.category, filter.lowStockOnly])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Inventory</h1>
          <p className="text-ink-500 text-sm mt-1">
            Supplies & consumables stock. Stock changes recorded as immutable movements.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)}
                  className="bg-gold hover:bg-gold/90 text-navy-dark px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm">
            <Plus size={16}/> New Item
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500">Active Items</div>
            <div className="text-2xl font-bold text-navy mt-1">{summary.total_active_items}</div>
          </div>
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500">Total Stock Value</div>
            <div className="text-2xl font-bold text-navy mt-1">
              ₹{Number(summary.total_stock_value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500 flex items-center gap-1">
              <AlertTriangle size={12}/> Low Stock
            </div>
            <div className={`text-2xl font-bold mt-1 ${summary.low_stock_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {summary.low_stock_count}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Category</label>
          <select value={filter.category}
                  onChange={e => setFilter(s => ({ ...s, category: e.target.value }))}
                  className="px-3 py-2 border border-ink-300 rounded-lg text-sm min-w-[160px]">
            <option value="">All</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={filter.lowStockOnly}
                 onChange={e => setFilter(s => ({ ...s, lowStockOnly: e.target.checked }))} />
          <span>Show only low-stock items</span>
        </label>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="text-ink-400 text-center py-12">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12">
            <Package size={40} className="mx-auto text-ink-300 mb-3"/>
            <p className="text-ink-500">No items yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Category</th>
                <th className="text-right px-4 py-3">Stock</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Threshold</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">Value</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.item_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-navy">{it.name}</div>
                    {it.sku && <div className="text-[11px] text-ink-400 font-mono">{it.sku}</div>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-ink-100 text-ink-700">
                      {it.category.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-bold ${it.below_threshold ? 'text-red-600' : 'text-navy'}`}>
                    {it.current_stock} <span className="text-xs font-normal text-ink-400">{it.unit}</span>
                    {it.below_threshold && (
                      <AlertTriangle size={12} className="inline-block ml-1 text-red-500"/>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right hidden sm:table-cell text-ink-500 text-xs">
                    {it.reorder_threshold} {it.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right hidden md:table-cell text-ink-700">
                    {it.unit_price ? `₹${Number(it.stock_value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setMovementFor(it)}
                              className="px-2 py-1 bg-gold/10 hover:bg-gold/20 text-gold rounded text-xs font-medium">
                        ± Stock
                      </button>
                      <button onClick={() => setHistoryFor(it)}
                              className="px-2 py-1 text-ink-400 hover:text-navy"
                              title="History">
                        <History size={14}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <ItemModal onClose={() => setShowCreate(false)}
                   onSaved={() => { setShowCreate(false); fetchAll() }} />
      )}
      {movementFor && (
        <MovementModal item={movementFor} onClose={() => setMovementFor(null)}
                       onSaved={() => { setMovementFor(null); fetchAll() }} />
      )}
      {historyFor && (
        <HistoryModal item={historyFor} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  )
}

function ItemModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', sku: '', category: 'consumables', unit: 'piece',
    initial_stock: '0', reorder_threshold: '0', unit_price: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      await inventoryAPI.createItem({
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        category: form.category,
        unit: form.unit,
        initial_stock: parseFloat(form.initial_stock) || 0,
        reorder_threshold: parseFloat(form.reorder_threshold) || 0,
        unit_price: form.unit_price === '' ? null : parseFloat(form.unit_price),
        notes: form.notes || null,
      })
      toast.success('Item created')
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">New Inventory Item</h2>
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
                   placeholder="e.g. Bath soap (small)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
                SKU <span className="text-ink-400 normal-case">(optional)</span>
              </label>
              <input type="text" value={form.sku}
                     onChange={e => setForm(s => ({ ...s, sku: e.target.value }))}
                     className="input-field font-mono uppercase"
                     placeholder="SOAP-S" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Category</label>
              <select value={form.category}
                      onChange={e => setForm(s => ({ ...s, category: e.target.value }))}
                      className="input-field">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Unit</label>
              <select value={form.unit}
                      onChange={e => setForm(s => ({ ...s, unit: e.target.value }))}
                      className="input-field">
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Initial</label>
              <input type="number" min="0" step="0.01" value={form.initial_stock}
                     onChange={e => setForm(s => ({ ...s, initial_stock: e.target.value }))}
                     className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Reorder ≤</label>
              <input type="number" min="0" step="0.01" value={form.reorder_threshold}
                     onChange={e => setForm(s => ({ ...s, reorder_threshold: e.target.value }))}
                     className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
              Unit Price (₹) <span className="text-ink-400 normal-case">(optional, for stock value)</span>
            </label>
            <input type="number" min="0" step="0.01" value={form.unit_price}
                   onChange={e => setForm(s => ({ ...s, unit_price: e.target.value }))}
                   className="input-field" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Item'}
          </button>
        </div>
      </form>
    </div>
  )
}

function MovementModal({ item, onClose, onSaved }) {
  const [type, setType] = useState('purchase')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const q = parseFloat(quantity)
    if (!q || q <= 0) { toast.error('Quantity must be > 0'); return }
    setSaving(true)
    try {
      const res = await inventoryAPI.recordMovement({
        item_id: item.item_id,
        movement_type: type,
        quantity: q,
        reason: reason || null,
      })
      toast.success(`Stock updated → ${res.data.item.current_stock} ${item.unit}`)
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">Stock Movement</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-ink-50 rounded-lg p-3 text-sm">
            <div className="font-semibold text-navy">{item.name}</div>
            <div className="text-xs text-ink-500">
              Current: <strong>{item.current_stock} {item.unit}</strong>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Movement Type</label>
            <select value={type} onChange={e => setType(e.target.value)}
                    className="input-field">
              <option value="purchase">Purchase (+ stock)</option>
              <option value="consumption">Consumption (− stock)</option>
              <option value="damage">Damage / Write-off (− stock)</option>
              <option value="return_">Return to supplier (− stock)</option>
              <option value="adjustment">Adjustment (± based on reason)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Quantity *</label>
            <input type="number" min="0" step="0.01" value={quantity} autoFocus
                   onChange={e => setQuantity(e.target.value)}
                   className="input-field text-base" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Reason</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
                   className="input-field"
                   placeholder="e.g. Monthly purchase, Room 101 stock, Broken in transit" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record Movement'}
          </button>
        </div>
      </form>
    </div>
  )
}

function HistoryModal({ item, onClose }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    inventoryAPI.listMovements({ item_id: item.item_id, limit: 200 })
      .then(r => setMovements(r.data || []))
      .catch(() => toast.error('Failed to load history'))
      .finally(() => setLoading(false))
  }, [item.item_id])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <div>
            <h2 className="font-display font-bold text-navy text-lg">Stock History</h2>
            <p className="text-xs text-ink-500">{item.name} · current: {item.current_stock} {item.unit}</p>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600"><X size={20}/></button>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          {loading ? (
            <div className="text-center text-ink-400 py-8">Loading…</div>
          ) : movements.length === 0 ? (
            <div className="text-center text-ink-400 py-8">No movements yet.</div>
          ) : (
            <div className="space-y-1.5">
              {movements.map(m => {
                const positive = parseFloat(m.change) > 0
                const Icon = positive ? TrendingUp : TrendingDown
                return (
                  <div key={m.movement_id} className="bg-ink-50 rounded p-2.5 flex items-start gap-3">
                    <Icon size={16} className={positive ? 'text-green-500' : 'text-red-500'}/>
                    <div className="flex-1">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs font-bold uppercase text-ink-500">{m.movement_type}</span>
                        <span className={`font-bold ${positive ? 'text-green-600' : 'text-red-600'}`}>
                          {positive ? '+' : ''}{m.change} {item.unit}
                        </span>
                      </div>
                      {m.reason && <div className="text-xs text-ink-600 mt-0.5">{m.reason}</div>}
                      <div className="text-[10px] text-ink-400 mt-0.5">
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
