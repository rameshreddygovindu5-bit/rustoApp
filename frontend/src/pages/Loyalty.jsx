import React, { useState, useEffect } from 'react'
import { Award, Plus, X, TrendingUp, TrendingDown, Star } from 'lucide-react'
import { toast } from 'react-toastify'
import { loyaltyAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

const TIER_META = {
  bronze:   { label: 'Bronze',   color: 'bg-amber-100 text-amber-700 border-amber-300' },
  silver:   { label: 'Silver',   color: 'bg-gray-100 text-gray-700 border-gray-300' },
  gold:     { label: 'Gold',     color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
  platinum: { label: 'Platinum', color: 'bg-purple-100 text-purple-700 border-purple-300' },
}

/**
 * Loyalty admin page.
 *
 * Shows: tier distribution stats, all loyalty accounts ordered by lifetime
 * points (top members first), with quick-action to adjust points or
 * inspect transaction history.
 *
 * Points earned automatically at checkout (1 point per ₹100 spent by
 * default; configurable via setting `loyalty_earn_rate_per_100`).
 */
export default function Loyalty() {
  const { isAdmin } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState({ tier: '' })
  const [loading, setLoading] = useState(true)
  const [adjusting, setAdjusting] = useState(null)
  const [viewing, setViewing] = useState(null)

  const fetch = async () => {
    setLoading(true)
    try {
      const params = filter.tier ? { tier: filter.tier } : {}
      const [a, s] = await Promise.all([
        loyaltyAPI.listAccounts(params),
        loyaltyAPI.stats(),
      ])
      setAccounts(a.data || [])
      setStats(s.data)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }
  useEffect(() => { fetch() /* eslint-disable-next-line */ }, [filter.tier])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Loyalty Program</h1>
          <p className="text-gray-500 text-sm mt-1">
            Points auto-earned at checkout. Tiers: Bronze → Silver (1000) → Gold (5000) → Platinum (15000).
          </p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Total Accounts</div>
            <div className="text-2xl font-bold text-navy mt-1">{stats.total_accounts}</div>
          </div>
          {Object.entries(TIER_META).map(([tier, meta]) => (
            <div key={tier} className="bg-white rounded-xl shadow-sm p-4">
              <div className={`inline-block text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${meta.color}`}>
                {meta.label}
              </div>
              <div className="text-2xl font-bold text-navy mt-1">{stats.by_tier?.[tier] || 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Tier</label>
          <select value={filter.tier}
                  onChange={e => setFilter(s => ({ ...s, tier: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[140px]">
            <option value="">All</option>
            {Object.keys(TIER_META).map(k => <option key={k} value={k}>{TIER_META[k].label}</option>)}
          </select>
        </div>
      </div>

      {/* Accounts table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-12">
            <Award size={40} className="mx-auto text-gray-300 mb-3"/>
            <p className="text-gray-500">No loyalty accounts yet.</p>
            <p className="text-xs text-gray-400 mt-1">Accounts open automatically on first checkout.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Phone</th>
                <th className="text-center px-4 py-3">Tier</th>
                <th className="text-right px-4 py-3">Current</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Lifetime</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.account_id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 font-semibold text-navy">{a.customer_name || `#${a.customer_id}`}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-gray-500 text-xs">{a.customer_phone || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${TIER_META[a.tier].color}`}>
                      {TIER_META[a.tier].label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-navy">{a.current_balance.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right hidden sm:table-cell text-gray-500">{a.lifetime_points.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setViewing(a)}
                              className="px-2 py-1 text-navy/60 hover:text-navy text-xs">
                        History
                      </button>
                      {isAdmin && (
                        <button onClick={() => setAdjusting(a)}
                                className="px-2 py-1 bg-gold/10 hover:bg-gold/20 text-gold rounded text-xs font-medium">
                          ± Points
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adjusting && (
        <AdjustModal account={adjusting} onClose={() => setAdjusting(null)}
                     onSaved={() => { setAdjusting(null); fetch() }} />
      )}
      {viewing && (
        <HistoryModal customerId={viewing.customer_id} customerName={viewing.customer_name}
                      onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function AdjustModal({ account, onClose, onSaved }) {
  const [points, setPoints] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const p = parseInt(points, 10)
    if (!p || p === 0) { toast.error('Enter non-zero points'); return }
    if (!reason.trim()) { toast.error('Reason required'); return }
    setSaving(true)
    try {
      await loyaltyAPI.adjust({
        customer_id: account.customer_id,
        points: p, reason: reason.trim(),
      })
      toast.success('Adjusted')
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">Adjust Points</h2>
          <p className="text-xs text-gray-500 mt-1">
            {account.customer_name} · current: <strong>{account.current_balance}</strong>
          </p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Points (use negative to deduct) *
            </label>
            <input type="number" value={points} autoFocus
                   onChange={e => setPoints(e.target.value)}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                   placeholder="e.g. 500 or -200" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Reason *</label>
            <input type="text" value={reason}
                   onChange={e => setReason(e.target.value)}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                   placeholder="e.g. Goodwill gesture, Correction" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? '…' : 'Apply'}
          </button>
        </div>
      </form>
    </div>
  )
}

function HistoryModal({ customerId, customerName, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    loyaltyAPI.getAccount(customerId)
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed'))
      .finally(() => setLoading(false))
  }, [customerId])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-display font-bold text-navy text-lg">Transactions — {customerName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="overflow-y-auto p-3 flex-1">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading…</div>
          ) : !data?.transactions?.length ? (
            <div className="text-center text-gray-400 py-8">No transactions yet.</div>
          ) : (
            data.transactions.map(t => (
              <div key={t.txn_id} className="bg-gray-50 rounded p-2.5 mb-2 flex items-start gap-3">
                {t.points > 0
                  ? <TrendingUp size={16} className="text-green-500 mt-0.5"/>
                  : <TrendingDown size={16} className="text-red-500 mt-0.5"/>}
                <div className="flex-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs uppercase font-bold text-gray-500">{t.txn_type}</span>
                    <span className={`font-bold ${t.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {t.points > 0 ? '+' : ''}{t.points} pts
                    </span>
                  </div>
                  {t.reason && <div className="text-xs text-gray-600 mt-0.5">{t.reason}</div>}
                  <div className="text-[10px] text-gray-400 mt-0.5">{new Date(t.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
