import React, { useState, useEffect } from 'react'
import { Receipt, Plus, Trash2, X, TrendingDown, Calendar } from 'lucide-react'
import { toast } from 'react-toastify'
import { expensesAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

const CATEGORIES = [
  ['salary', 'Salary'],
  ['utilities', 'Utilities'],
  ['supplies', 'Supplies'],
  ['maintenance', 'Maintenance'],
  ['food_beverage', 'Food & Beverage'],
  ['laundry', 'Laundry'],
  ['rent', 'Rent'],
  ['tax_fees', 'Tax / Fees'],
  ['marketing', 'Marketing'],
  ['other', 'Other'],
]

const PAYMENT_METHODS = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['bank_transfer', 'Bank Transfer'],
  ['cheque', 'Cheque'],
  ['card', 'Card'],
]

/**
 * Expenses page — daily operational expense tracking.
 *
 * Two views in one page:
 *  - Left: list of expense rows with filters (date range + category)
 *  - Right: summary chart by category for the same window
 *
 * Admins create + delete; everyone else is read-only via the page (the
 * backend's `require_admin` enforces this — the page just doesn't show
 * the action buttons).
 */
export default function Expenses() {
  const { isAdmin } = useAuth()
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 29*86400_000).toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(monthAgo)
  const [toDate, setToDate] = useState(today)
  const [category, setCategory] = useState('')
  const [data, setData] = useState({ data: [], total: 0, total_amount: 0 })
  const [summary, setSummary] = useState({ by_category: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const params = { from_date: fromDate, to_date: toDate, limit: 200 }
      if (category) params.category = category
      const [list, sum] = await Promise.all([
        expensesAPI.list(params),
        expensesAPI.summary({ from_date: fromDate, to_date: toDate }),
      ])
      setData(list.data || { data: [], total: 0, total_amount: 0 })
      setSummary(sum.data || { by_category: [], total: 0 })
    } catch (e) {
      toast.error('Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetch() /* eslint-disable-next-line */ }, [fromDate, toDate, category])

  const handleDelete = async (e) => {
    if (!window.confirm(`Delete expense "${e.description}" (₹${e.amount})?`)) return
    try {
      await expensesAPI.delete(e.expense_id)
      toast.success('Deleted')
      fetch()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Expenses</h1>
          <p className="text-ink-500 text-sm mt-1">
            Track operational expenses — feeds the net-profit calculation in Reports.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-gold hover:bg-gold/90 text-navy-dark px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm"
          >
            <Plus size={16} /> New Expense
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                 className="px-3 py-2 border border-ink-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                 className="px-3 py-2 border border-ink-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
                  className="px-3 py-2 border border-ink-300 rounded-lg text-sm min-w-[140px]">
            <option value="">All</option>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
          <div className="flex items-center gap-2 text-ink-500 text-xs uppercase tracking-wide">
            <TrendingDown size={14}/> Total ({fromDate.slice(5)} → {toDate.slice(5)})
          </div>
          <div className="text-2xl font-bold text-red-600 mt-1">
            ₹{Number(summary.total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
          <div className="text-ink-500 text-xs uppercase tracking-wide">Number of Expenses</div>
          <div className="text-2xl font-bold text-navy mt-1">{data.total || 0}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
          <div className="text-ink-500 text-xs uppercase tracking-wide">Top Category</div>
          <div className="text-lg font-semibold text-navy mt-1">
            {summary.by_category?.[0]?.category
              ? CATEGORIES.find(c => c[0] === summary.by_category.slice().sort((a,b)=>b.amount-a.amount)[0].category)?.[1] || '—'
              : '—'}
          </div>
        </div>
      </div>

      {/* By-category breakdown */}
      {summary.by_category?.length > 0 && (
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-4">
          <h3 className="font-semibold text-navy mb-3">By Category</h3>
          <div className="space-y-2">
            {[...summary.by_category].sort((a, b) => b.amount - a.amount).map(row => {
              const pct = summary.total > 0 ? (row.amount / summary.total * 100) : 0
              const label = CATEGORIES.find(c => c[0] === row.category)?.[1] || row.category
              return (
                <div key={row.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink-700">{label}</span>
                    <span className="font-semibold text-navy">
                      ₹{Number(row.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      <span className="text-xs text-ink-400 ml-2">{pct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gold" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Expense list */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="text-ink-400 text-center py-12">Loading…</div>
        ) : data.data?.length === 0 ? (
          <div className="text-center py-12">
            <Receipt size={40} className="mx-auto text-ink-300 mb-3" />
            <p className="text-ink-500">No expenses in this range.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Vendor</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Paid By</th>
                {isAdmin && <th className="text-right px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {data.data.map(e => (
                <tr key={e.expense_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                  <td className="px-4 py-2.5 text-ink-600">{e.expense_date}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-ink-100 text-ink-700">
                      {CATEGORIES.find(c => c[0] === e.category)?.[1] || e.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-navy">{e.description}</div>
                    {e.notes && <div className="text-xs text-ink-400 mt-0.5">{e.notes}</div>}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-ink-600">{e.vendor || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">
                    ₹{Number(e.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-xs text-ink-500">
                      {PAYMENT_METHODS.find(p => p[0] === e.payment_method)?.[1] || e.payment_method}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => handleDelete(e)}
                              className="text-red-400 hover:text-red-600">
                        <Trash2 size={14}/>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateExpenseModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); fetch() }}
        />
      )}
    </div>
  )
}

function CreateExpenseModal({ onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    expense_date: today,
    category: 'utilities',
    description: '',
    vendor: '',
    amount: '',
    payment_method: 'cash',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!form.description.trim()) { toast.error('Description required'); return }
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) { toast.error('Amount must be > 0'); return }
    setSaving(true)
    try {
      await expensesAPI.create({
        ...form,
        amount,
        vendor: form.vendor || null,
        notes: form.notes || null,
      })
      toast.success('Expense recorded')
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">New Expense</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-600">
            <X size={20}/>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Date *</label>
              <input type="date" value={form.expense_date}
                     onChange={e => setForm(s => ({ ...s, expense_date: e.target.value }))}
                     className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Category *</label>
              <select value={form.category}
                      onChange={e => setForm(s => ({ ...s, category: e.target.value }))}
                      className="input-field">
                {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Description *</label>
            <input type="text" value={form.description}
                   onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
                   className="input-field"
                   placeholder="e.g. Electricity bill — April" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Vendor</label>
              <input type="text" value={form.vendor}
                     onChange={e => setForm(s => ({ ...s, vendor: e.target.value }))}
                     className="input-field"
                     placeholder="optional" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Amount *</label>
              <input type="number" min="0" step="0.01" value={form.amount}
                     onChange={e => setForm(s => ({ ...s, amount: e.target.value }))}
                     className="input-field"
                     placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Payment Method</label>
            <select value={form.payment_method}
                    onChange={e => setForm(s => ({ ...s, payment_method: e.target.value }))}
                    className="input-field">
              {PAYMENT_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {form.payment_method === 'cash' && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                If you have a shift open, this cash expense will be linked to it and deducted from the closing balance.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Notes</label>
            <textarea value={form.notes}
                      onChange={e => setForm(s => ({ ...s, notes: e.target.value }))}
                      rows={2}
                      className="input-field" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Expense'}
          </button>
        </div>
      </form>
    </div>
  )
}
