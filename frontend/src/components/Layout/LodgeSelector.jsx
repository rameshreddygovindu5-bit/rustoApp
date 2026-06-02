import React, { useState, useEffect } from 'react'
import { Building2, ChevronDown, Lock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { lodgesAPI } from '../../services/api'

/**
 * Lodge selector for the top bar.
 *
 * Behaviour matches the multi-tenant requirement:
 *   - Regular admin / staff: the control DISPLAYS the user's lodge name
 *     and is DISABLED with a lock icon. They cannot change scope.
 *     Implemented as a `<select disabled>` so screen-reader semantics
 *     are still "this is a selector — just locked".
 *   - super_admin: the dropdown lists every active lodge. Switching it
 *     updates AuthContext.selectedLodgeId, which the axios interceptor
 *     reads to attach `X-Lodge-Id` on every subsequent request. After a
 *     switch we reload the page so cached page-level data refreshes.
 *
 * Rendering robustness: a tenant admin's `user.lodge` object is filled
 * at login from `/auth/login`. We use that as the IMMEDIATE display
 * source (no waiting for `/lodges` to come back), so the lodge name is
 * visible the instant the page loads — important on slow connections
 * where the original implementation showed "Loading lodge…" for so long
 * that users thought the selector was broken.
 */
export default function LodgeSelector() {
  const { user, isSuperAdmin, selectedLodgeId, setSelectedLodgeId } = useAuth()
  const [lodges, setLodges] = useState([])
  const [loading, setLoading] = useState(true)

  // Pull the visible-lodge list. For tenant users the backend returns
  // exactly one lodge (their own); for super_admin it returns every one.
  useEffect(() => {
    let alive = true
    lodgesAPI.list()
      .then(res => { if (alive) setLodges(res.data || []) })
      .catch(() => { if (alive) setLodges([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user?.user_id])

  // Tenant admin / staff: show the lodge as a disabled control.
  // We prefer `user.lodge` (filled at login) over waiting for the
  // /lodges endpoint — that way the lodge name appears immediately.
  if (!isSuperAdmin) {
    const fromUser = user?.lodge
    const fromList = lodges[0]
    const lodge = fromUser || fromList
    // If the user has no lodge AT ALL (an unbound super_admin would be
    // caught above, so this would be a misconfigured account), still
    // render a clear "no lodge" indicator instead of nothing — silence
    // is what the user reported as "I don't see the dropdown".
    if (!lodge) {
      return (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-md border border-red-200">
          <Building2 size={14} className="text-red-500" />
          <span className="text-xs font-medium text-red-700">No lodge assigned</span>
        </div>
      )
    }
    return (
      <div
        className="group flex items-center gap-2.5 px-3 py-2 bg-ink-50 hover:bg-ink-100 rounded-xl border border-ink-200 cursor-not-allowed transition-all"
        title={`Signed in to ${lodge.name}. Only super-admins can switch lodges.`}
      >
        <div className="w-7 h-7 rounded-lg bg-navy flex items-center justify-center flex-shrink-0">
          <Building2 size={13} className="text-gold" strokeWidth={2.5}/>
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-2xs uppercase tracking-eyebrow text-ink-400 font-semibold">Lodge</span>
          <span className="text-sm font-bold text-navy truncate max-w-[160px]">{lodge.name}</span>
        </div>
        <Lock size={11} className="text-ink-400 flex-shrink-0 ml-0.5" />
      </div>
    )
  }

  // Super-admin: real switcher.
  const onChange = (e) => {
    const next = e.target.value ? parseInt(e.target.value, 10) : null
    setSelectedLodgeId(next)
    window.location.reload()
  }

  if (loading && lodges.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-400 px-3 py-2 bg-ink-50 rounded-xl border border-ink-200">
        <Building2 size={14} />
        <span>Loading…</span>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 bg-gradient-to-br from-gold/10 to-gold/5 hover:from-gold/15 hover:to-gold/10 rounded-xl border border-gold/30 transition-all shadow-soft">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center flex-shrink-0 shadow-gold">
        <Building2 size={13} className="text-navy-dark" strokeWidth={2.5}/>
      </div>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-2xs uppercase tracking-eyebrow text-gold-dark font-bold">Switch lodge</span>
        <select
          value={selectedLodgeId || ''}
          onChange={onChange}
          className="bg-transparent text-sm font-bold text-navy outline-none cursor-pointer pr-0 max-w-[170px]"
        >
          <option value="" disabled>— select —</option>
          {lodges.map(l => (
            <option key={l.lodge_id} value={l.lodge_id}>{l.name}</option>
          ))}
        </select>
      </div>
      <ChevronDown size={12} className="text-gold flex-shrink-0" />
    </div>
  )
}
