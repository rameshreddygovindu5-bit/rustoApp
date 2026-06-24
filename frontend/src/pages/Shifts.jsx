import React, { useState, useEffect } from 'react'
import { Wallet, Play, Square, IndianRupee, TrendingUp, TrendingDown, AlertCircle, CheckCircle, History } from 'lucide-react'
import { toast } from 'react-toastify'
import { shiftsAPI } from '../services/api'

/**
 * Shifts page — front-desk cash drawer / shift handover.
 *
 * Each staffer can have at most one open shift. The page shows:
 *   - If no shift is open: an "Open shift" form (enter physical cash count)
 *   - If open: live totals (cash in/out from invoices + expenses) + Close button
 *   - Recent closed shifts (history) so the next person can see the handover notes
 */
export default function Shifts() {
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const [cur, hist] = await Promise.all([
        shiftsAPI.current(),
        shiftsAPI.list(),
      ])
      setCurrent(cur.data)
      setHistory(hist.data || [])
    } catch {
      toast.error('Failed to load shifts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    // Poll every 30s while the page is open so live totals stay fresh
    // even while invoices and expenses are being recorded elsewhere.
    const t = setInterval(fetch, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Shifts & Cash Drawer</h1>
          <p className="text-ink-500 text-sm mt-1">
            Track opening/closing balance per shift. Cash invoices + expenses auto-reconcile.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : current ? (
        // ── Open shift card ───────────────────────────────────────────
        <div className="bg-gradient-to-br from-navy to-navy-light text-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 rounded-full bg-green-500/30 flex items-center justify-center">
              <Play size={20} className="text-green-200" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-white/60">Shift Open</div>
              <div className="text-lg font-semibold">{current.staff_name}</div>
              <div className="text-xs text-white/50">since {new Date(current.opened_at).toLocaleString()}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <div className="bg-white/10 rounded-lg p-4">
              <div className="text-xs text-white/60 uppercase tracking-wide flex items-center gap-1">
                <IndianRupee size={12}/> Opening
              </div>
              <div className="text-xl font-bold">₹{Number(current.opening_balance).toLocaleString('en-IN')}</div>
            </div>
            <div className="bg-green-500/20 rounded-lg p-4">
              <div className="text-xs text-green-200 uppercase tracking-wide flex items-center gap-1">
                <TrendingUp size={12}/> Cash In
              </div>
              <div className="text-xl font-bold">₹{Number(current.live_cash_in || 0).toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-white/40">from cash invoices</div>
            </div>
            <div className="bg-red-500/20 rounded-lg p-4">
              <div className="text-xs text-red-200 uppercase tracking-wide flex items-center gap-1">
                <TrendingDown size={12}/> Cash Out
              </div>
              <div className="text-xl font-bold">₹{Number(current.live_cash_out || 0).toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-white/40">from cash expenses</div>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-white/10 flex items-center justify-between">
            <div>
              <div className="text-xs text-white/60 uppercase tracking-wide">Expected in drawer right now</div>
              <div className="text-3xl font-bold text-gold">
                ₹{Number(current.live_expected_closing || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </div>
            </div>
            <button
              onClick={() => setShowClose(true)}
              className="bg-gold hover:bg-gold/90 text-navy-dark font-semibold px-5 py-3 rounded-lg flex items-center gap-2"
            >
              <Square size={16}/> Close Shift
            </button>
          </div>
        </div>
      ) : (
        // ── No open shift ────────────────────────────────────────────
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Wallet size={40} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-500 mb-4">No shift open. Open one to start your cash drawer.</p>
          <button
            onClick={() => setShowOpen(true)}
            className="bg-gold hover:bg-gold/90 text-navy-dark px-5 py-2.5 rounded-lg font-medium inline-flex items-center gap-2"
          >
            <Play size={14}/> Open Shift
          </button>
        </div>
      )}

      {/* History */}
      <div>
        <h2 className="font-display font-bold text-navy text-lg flex items-center gap-2 mb-3">
          <History size={18}/> Recent Shifts
        </h2>
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
          {history.length === 0 ? (
            <div className="text-ink-400 text-center py-8 text-sm">No prior shifts yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-ink-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Staff</th>
                  <th className="text-left px-4 py-3">Opened</th>
                  <th className="text-left px-4 py-3">Closed</th>
                  <th className="text-right px-4 py-3">Opening</th>
                  <th className="text-right px-4 py-3">Expected</th>
                  <th className="text-right px-4 py-3">Actual</th>
                  <th className="text-right px-4 py-3">Discrepancy</th>
                </tr>
              </thead>
              <tbody>
                {history.map(s => {
                  const disc = s.discrepancy ?? null
                  const discColor = disc === null ? 'text-ink-400'
                    : Math.abs(disc) < 1 ? 'text-green-600'
                    : disc > 0 ? 'text-amber-600' : 'text-red-600'
                  return (
                    <tr key={s.shift_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                      <td className="px-4 py-2.5 font-semibold text-navy">{s.staff_name}</td>
                      <td className="px-4 py-2.5 text-ink-600 text-xs">{new Date(s.opened_at).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-ink-600 text-xs">
                        {s.closed_at ? new Date(s.closed_at).toLocaleString()
                          : <span className="text-green-600 font-medium">— open —</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">₹{Number(s.opening_balance).toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2.5 text-right">
                        {s.expected_closing_balance !== null
                          ? `₹${Number(s.expected_closing_balance).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {s.closing_balance !== null
                          ? `₹${Number(s.closing_balance).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${discColor}`}>
                        {disc === null ? '—'
                          : `${disc >= 0 ? '+' : ''}₹${Number(disc).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showOpen && (
        <OpenShiftModal
          onClose={() => setShowOpen(false)}
          onOpened={() => { setShowOpen(false); fetch() }}
        />
      )}
      {showClose && current && (
        <CloseShiftModal
          shift={current}
          onClose={() => setShowClose(false)}
          onClosed={() => { setShowClose(false); fetch() }}
        />
      )}
    </div>
  )
}

function OpenShiftModal({ onClose, onOpened }) {
  const [opening, setOpening] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const amount = parseFloat(opening)
    if (isNaN(amount) || amount < 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    try {
      await shiftsAPI.open({ opening_balance: amount })
      toast.success('Shift opened')
      onOpened()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to open shift')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">Open Shift</h2>
          <p className="text-xs text-ink-500 mt-1">
            Count the cash physically in the drawer right now and enter that amount.
          </p>
        </div>
        <div className="p-5">
          <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
            Opening Cash Balance (₹) *
          </label>
          <input type="number" min="0" step="0.01" value={opening}
                 onChange={e => setOpening(e.target.value)}
                 autoFocus
                 className="input-field text-base"
                 placeholder="0.00" />
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-gold text-navy-dark rounded-lg hover:bg-gold/90 disabled:opacity-50">
            {saving ? 'Opening…' : 'Open Shift'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CloseShiftModal({ shift, onClose, onClosed }) {
  const expected = shift.live_expected_closing || 0
  const [closing, setClosing] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Live discrepancy preview as the user types — helps spot data-entry
  // mistakes ("wait, why is that ₹3,000 off?") before the staffer commits.
  const closingNum = parseFloat(closing)
  const liveDiscrepancy = isNaN(closingNum) ? null : closingNum - expected

  const submit = async (e) => {
    e.preventDefault()
    if (isNaN(closingNum) || closingNum < 0) { toast.error('Enter actual cash in drawer'); return }
    setSaving(true)
    try {
      const res = await shiftsAPI.close({
        closing_balance: closingNum,
        handover_notes: notes || null,
      })
      const disc = res.data.discrepancy
      if (Math.abs(disc) < 1) toast.success('Shift closed — cash reconciled')
      else toast.warning(`Shift closed with discrepancy of ₹${Math.abs(disc).toFixed(2)} (${disc > 0 ? 'extra' : 'short'})`)
      onClosed()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to close shift')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-ink-100">
          <h2 className="font-display font-bold text-navy text-lg">Close Shift</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-ink-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-ink-500">Opening</span>
              <span className="font-medium">₹{Number(shift.opening_balance).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-green-600">+ Cash In</span>
              <span className="font-medium">₹{Number(shift.live_cash_in || 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-red-600">− Cash Out</span>
              <span className="font-medium">₹{Number(shift.live_cash_out || 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="border-t border-ink-200 mt-2 pt-2 flex justify-between font-bold text-navy">
              <span>Expected</span>
              <span>₹{Number(expected).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">
              Actual Cash Counted (₹) *
            </label>
            <input type="number" min="0" step="0.01" value={closing}
                   onChange={e => setClosing(e.target.value)}
                   autoFocus
                   className="input-field text-base"
                   placeholder="0.00" />
            {liveDiscrepancy !== null && (
              <p className={`text-xs mt-1 font-medium ${
                Math.abs(liveDiscrepancy) < 1 ? 'text-green-600'
                  : liveDiscrepancy > 0 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {Math.abs(liveDiscrepancy) < 1
                  ? '✓ Reconciles'
                  : `Discrepancy: ${liveDiscrepancy > 0 ? '+' : ''}₹${liveDiscrepancy.toFixed(2)} (${liveDiscrepancy > 0 ? 'over' : 'short'})`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1">Handover Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      rows={3}
                      className="input-field"
                      placeholder="Anything the next shift needs to know..." />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50">
            {saving ? 'Closing…' : 'Close Shift'}
          </button>
        </div>
      </form>
    </div>
  )
}
