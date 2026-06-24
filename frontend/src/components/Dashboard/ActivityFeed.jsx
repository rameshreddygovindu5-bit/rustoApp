import React, { useState, useEffect } from 'react'
import { Activity, Users, LogIn, LogOut, Sparkles, Wrench, Receipt, Tag, Award, Star, BedDouble, Wallet } from 'lucide-react'
import { auditAPI } from '../../services/api'

/**
 * Activity feed — recent operational events for the Dashboard widget.
 *
 * Polls every 60 seconds. Maps audit-log action codes to friendly icons
 * + human-readable summaries.
 *
 * Available to all authenticated users (uses /api/audit/activity, the
 * staff-visible feed, not the admin-only /api/audit endpoint).
 */
const ACTION_META = {
  'checkin.created':      { icon: LogIn, color: 'text-green-500', label: 'Check-in' },
  'checkin.checked_out':  { icon: LogOut, color: 'text-blue-500', label: 'Checkout' },
  'booking.created':      { icon: Users, color: 'text-purple-500', label: 'New booking' },
  'booking.cancelled':    { icon: Users, color: 'text-red-500', label: 'Booking cancelled' },
  'housekeeping.completed': { icon: Sparkles, color: 'text-amber-500', label: 'Room cleaned' },
  'housekeeping.inspected': { icon: Sparkles, color: 'text-green-500', label: 'Inspection done' },
  'maintenance.created':  { icon: Wrench, color: 'text-orange-500', label: 'Maintenance ticket' },
  'maintenance.updated':  { icon: Wrench, color: 'text-blue-500', label: 'Maintenance update' },
  'expense.created':      { icon: Receipt, color: 'text-red-500', label: 'Expense' },
  'promo.created':        { icon: Tag, color: 'text-amber-500', label: 'New promo code' },
  'loyalty.adjusted':     { icon: Award, color: 'text-purple-500', label: 'Loyalty adjusted' },
  'feedback.staff_entered': { icon: Star, color: 'text-amber-500', label: 'Feedback recorded' },
  'shift.opened':         { icon: Wallet, color: 'text-green-500', label: 'Shift opened' },
  'shift.closed':         { icon: Wallet, color: 'text-blue-500', label: 'Shift closed' },
  'room.created':         { icon: BedDouble, color: 'text-amber-500', label: 'Room added' },
  'room.status_changed':  { icon: BedDouble, color: 'text-blue-500', label: 'Room status' },
}

function describe(row) {
  const d = row.details || {}
  switch (row.action) {
    case 'checkin.created':
      return `${row.actor_username} checked in ${d.customer_name || 'guest'} → Room ${d.room_number}`
    case 'checkin.checked_out':
      return `${row.actor_username} checked out invoice ${d.invoice_number || ''} (₹${d.total_amount || 0})`
    case 'booking.created':
      return `Booking #${row.entity_id} created`
    case 'booking.cancelled':
      return `Booking #${row.entity_id} cancelled`
    case 'housekeeping.completed':
      return `Cleaning task #${row.entity_id} completed`
    case 'housekeeping.inspected':
      return `Inspection ${d.passed ? 'passed' : 'failed'} (task #${row.entity_id})`
    case 'maintenance.created':
      return `${d.priority || ''} priority — "${d.title || 'Ticket'}"`
    case 'maintenance.updated':
      return `Ticket #${row.entity_id}: ${d.prev_status || ''} → ${d.new_status || ''}`
    case 'expense.created':
      return `${d.category || 'Expense'} — ₹${d.amount || 0} ${d.vendor ? `to ${d.vendor}` : ''}`
    case 'promo.created':
      return `Code "${d.code}" — ${d.type === 'percent' ? `${d.value}%` : `₹${d.value}`}`
    case 'loyalty.adjusted':
      return `${d.points > 0 ? '+' : ''}${d.points} points (${d.reason || 'no reason'})`
    case 'feedback.staff_entered':
      return `Recorded — ${d.rating}★`
    case 'shift.opened':
      return `Opening cash ₹${d.opening_balance || 0}`
    case 'shift.closed': {
      const disc = d.discrepancy
      return `Closed — discrepancy ₹${disc?.toFixed?.(2) ?? disc ?? 0}`
    }
    case 'room.created':
      return `Room ${d.room_number} added (${d.type || ''})`
    case 'room.status_changed':
      return `Room ${d.room_number}: ${d.old_status} → ${d.new_status}`
    default:
      return row.action
  }
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function ActivityFeed({ limit = 20 }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await auditAPI.activity(limit)
        if (!cancelled) setRows(res.data || [])
      } catch {
        // Quietly skip — the feed is a "nice to have", not critical UI.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [limit])

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <div className="px-4 py-3 border-b border-ink-100 flex items-center gap-2">
        <Activity size={16} className="text-gold"/>
        <h3 className="font-semibold text-navy text-sm">Recent Activity</h3>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {loading ? (
          <div className="text-ink-400 text-center py-8 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-ink-400 text-center py-8 text-sm">No recent activity.</div>
        ) : (
          rows.map(r => {
            const meta = ACTION_META[r.action] || { icon: Activity, color: 'text-ink-400', label: r.action }
            const Icon = meta.icon
            return (
              <div key={r.id} className="px-4 py-2.5 border-b border-ink-100 last:border-0 flex items-start gap-3 text-sm">
                <Icon size={14} className={`${meta.color} mt-1 flex-shrink-0`}/>
                <div className="flex-1 min-w-0">
                  <div className="text-ink-700 truncate">{describe(r)}</div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    {meta.label} · {timeAgo(r.created_at)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
