import React, { useState } from 'react'
import {
  Wrench, CheckCircle2, AlertCircle, Loader, ChevronDown, ChevronRight,
  Building2, BedDouble, User, Receipt, Calendar
} from 'lucide-react'

/**
 * Render a tool call with its result. Hand-tuned formatters per tool name
 * so output looks like a UI component, not raw JSON.
 *
 * Props:
 *   call: {id, name, input, result?, ok?, status: 'running'|'pending'|'done'|'error'}
 *   onConfirm?: () => void
 *   onDecline?: () => void
 */
export default function ToolCallCard({ call, onConfirm, onDecline }) {
  const [expanded, setExpanded] = useState(false)
  const status = call.status || (call.result ? (call.ok === false ? 'error' : 'done') : 'running')

  const Icon = ({
    running: Loader, pending: AlertCircle, done: CheckCircle2,
    error: AlertCircle,
  })[status] || Wrench

  const colorMap = {
    running: 'border-blue-200 bg-blue-50 text-blue-700',
    pending: 'border-amber-300 bg-amber-50 text-amber-800',
    done: 'border-green-200 bg-green-50 text-green-800',
    error: 'border-red-200 bg-red-50 text-red-700',
  }

  const result = call.result || {}
  const summary = renderSummary(call.name, call.input, result, status)

  return (
    <div className={`my-2 rounded-lg border text-xs ${colorMap[status]}`}>
      <div className="px-3 py-2 flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 flex-shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[11px] uppercase tracking-wider opacity-70">
            {prettyName(call.name)}
            {status === 'pending' && ' · awaiting confirmation'}
          </div>
          <div className="mt-1">{summary}</div>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="opacity-50 hover:opacity-100 flex-shrink-0"
          title="Show raw"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {status === 'pending' && (
        <div className="px-3 py-2 border-t border-amber-200 flex items-center justify-end gap-2">
          <button onClick={onDecline}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 hover:bg-amber-100 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-700 text-white hover:bg-amber-800 transition-colors shadow-sm">
            ✓ Confirm & run
          </button>
        </div>
      )}

      {expanded && (
        <div className="px-3 py-2 border-t border-current border-opacity-10 bg-white/30">
          <details>
            <summary className="cursor-pointer text-[10px] opacity-70">Input</summary>
            <pre className="font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(call.input || {}, null, 2)}
            </pre>
          </details>
          {(call.result || call.error) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] opacity-70">Output</summary>
              <pre className="font-mono text-[10px] overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(call.result || { error: call.error }, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function prettyName(name) {
  return (name || '').replace(/_/g, ' ')
}

function rupees(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// ────────────────────────────────────────────────────────────────────────
function renderSummary(name, input, result, status) {
  if (status === 'running') return <span className="opacity-70">Running…</span>
  if (status === 'pending') {
    return (
      <span>
        Wants to run <code className="bg-white/50 px-1 rounded">{prettyName(name)}</code> with{' '}
        <code className="bg-white/50 px-1 rounded font-mono text-[10px]">
          {JSON.stringify(input || {}).slice(0, 80)}
        </code>
      </span>
    )
  }
  if (status === 'error') {
    return <span>{result?.error || result?.detail || 'Tool failed'}</span>
  }

  // ── Per-tool formatters ────────────────────────────────────────────
  switch (name) {
    case 'get_dashboard_stats':
      return (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-0.5">
          <KV k="Occupancy" v={`${result.occupancy_pct}%`} />
          <KV k="Available" v={result.rooms_available} />
          <KV k="Today's check-ins" v={result.checkins_today} />
          <KV k="Overdue" v={result.overdue_checkouts} />
          <KV k="Arrivals (7d)" v={result.upcoming_arrivals_7d} />
          <KV k="Revenue (today)" v={rupees(result.revenue_today)} />
          <KV k="Revenue (MTD)" v={rupees(result.revenue_month_to_date)} />
        </div>
      )

    case 'list_rooms':
    case 'list_available_rooms': {
      const rooms = result.rooms || []
      if (!rooms.length) return <span>No rooms found.</span>
      return (
        <div>
          <div className="font-semibold mb-1">{rooms.length} room{rooms.length > 1 ? 's' : ''}</div>
          <div className="flex flex-wrap gap-1">
            {rooms.slice(0, 30).map(r => (
              <span key={r.room_id}
                    className="bg-white/60 px-1.5 py-0.5 rounded text-[10px] border border-current border-opacity-10">
                {r.room_number} · {(r.type || '').replace('_', ' ')} · {rupees(r.base_tariff)}
              </span>
            ))}
            {rooms.length > 30 && (
              <span className="text-[10px] opacity-70">+{rooms.length - 30} more</span>
            )}
          </div>
        </div>
      )
    }

    case 'list_active_checkins':
    case 'list_overdue_checkins': {
      const items = result.checkins || []
      if (!items.length) return <span>None.</span>
      return (
        <div>
          <div className="font-semibold mb-1">{items.length} check-in{items.length > 1 ? 's' : ''}</div>
          <table className="w-full text-[10px]">
            <tbody>
              {items.slice(0, 12).map(c => (
                <tr key={c.checkin_id} className="border-b border-current border-opacity-5">
                  <td className="py-0.5"><strong>Room {c.room_number}</strong></td>
                  <td className="py-0.5">{c.guest}</td>
                  <td className="py-0.5">→ {c.expected_checkout || '—'}</td>
                  {c.days_overdue !== undefined && (
                    <td className="py-0.5 text-red-600">+{c.days_overdue}d</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 12 && (
            <div className="text-[10px] opacity-70 mt-1">+{items.length - 12} more</div>
          )}
        </div>
      )
    }

    case 'list_upcoming_arrivals':
    case 'list_bookings': {
      const items = result.bookings || []
      if (!items.length) return <span>No bookings.</span>
      return (
        <div>
          <div className="font-semibold mb-1">{items.length} booking{items.length > 1 ? 's' : ''}</div>
          <table className="w-full text-[10px]">
            <tbody>
              {items.slice(0, 10).map(b => (
                <tr key={b.booking_id} className="border-b border-current border-opacity-5">
                  <td className="py-0.5 font-mono text-[10px]">{b.booking_ref}</td>
                  <td className="py-0.5">{b.guest_name}</td>
                  <td className="py-0.5">{b.checkin_date}</td>
                  <td className="py-0.5">{rupees(b.total_amount)}</td>
                  <td className="py-0.5">
                    <span className="px-1 rounded bg-white/60 text-[9px]">{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    case 'search_customers': {
      const items = result.customers || []
      if (!items.length) return <span>No matches.</span>
      return (
        <div>
          <div className="font-semibold mb-1">{items.length} customer{items.length > 1 ? 's' : ''}</div>
          {items.slice(0, 8).map(c => (
            <div key={c.customer_id} className="flex items-center gap-2 py-0.5">
              <User size={10} />
              <span className="font-medium">{c.name}</span>
              <span className="opacity-70">{c.phone}</span>
              {c.is_vip && <span className="text-amber-600">★ VIP</span>}
              {c.blacklisted && <span className="text-red-600">⛔ blacklisted</span>}
              <span className="opacity-60 text-[10px]">#{c.customer_id} · {c.total_visits} stays</span>
            </div>
          ))}
        </div>
      )
    }

    case 'get_customer_detail': {
      const c = result || {}
      return (
        <div>
          <div><strong>{c.name}</strong> · {c.phone} · #{c.customer_id}</div>
          {c.is_vip && <span className="text-amber-700">★ VIP</span>}{' '}
          {c.blacklisted && <span className="text-red-600">⛔ Blacklisted</span>}
          {c.history?.length > 0 && (
            <div className="opacity-70 mt-1">
              {c.history.length} previous stay{c.history.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )
    }

    case 'create_checkin':
      return (
        <div>
          <CheckCircle2 size={12} className="inline mr-1" />
          Checked in to <strong>room {result.checkin?.room_number}</strong> ·
          tariff <strong>{rupees(result.applied_tariff)}/night</strong> ·
          deposit <strong>{rupees(result.applied_deposit)}</strong>
        </div>
      )

    case 'create_booking':
      return (
        <div>
          <Calendar size={12} className="inline mr-1" />
          Booking <strong>{result.booking?.booking_ref}</strong> created for{' '}
          <strong>{result.booking?.guest_name}</strong> · {result.booking?.checkin_date} →{' '}
          {result.booking?.checkout_date} · {rupees(result.booking?.total_amount)}
        </div>
      )

    case 'checkout_guest':
      return (
        <div>
          <Receipt size={12} className="inline mr-1" />
          Invoice <strong>{result.invoice_number}</strong> · {result.nights} night
          {result.nights > 1 ? 's' : ''} · total <strong>{rupees(result.total)}</strong>
          {result.room_freed && <> · room <strong>{result.room_freed}</strong> freed</>}
        </div>
      )

    case 'cancel_booking':
      return <span>Booking <strong>{result.booking_ref}</strong> cancelled.</span>

    case 'set_room_state':
      return (
        <span>
          Room <strong>{result.room_number}</strong> →{' '}
          status <code className="bg-white/50 px-1 rounded">{result.status}</code>
          {result.clean !== undefined && (<>, {result.clean ? 'clean' : 'needs cleaning'}</>)}
        </span>
      )

    case 'create_customer':
      return (
        <span>
          {result.already_exists ? 'Found existing' : 'Created'} customer{' '}
          <strong>{result.customer?.name}</strong> · {result.customer?.phone} · #{result.customer?.customer_id}
        </span>
      )

    case 'send_custom_alert':
      return (
        <span>
          Alert queued (#{result.alert_id}) to <strong>{result.recipient}</strong>
        </span>
      )

    case 'set_customer_vip':
      return <span>VIP {result.is_vip ? 'set' : 'removed'} for customer #{result.customer_id}</span>

    case 'list_agencies': {
      const items = result.agencies || []
      return <span>{items.length} agency partner{items.length === 1 ? '' : 's'}</span>
    }

    case 'set_agency_status':
      return <span>Agency #{result.agency_id} → <strong>{result.status}</strong></span>

    case 'suggest_room':
      return (
        <div>
          <BedDouble size={12} className="inline mr-1" />
          Recommended: <strong>Room {result.recommendation?.room_number}</strong>{' '}
          ({(result.recommendation?.type || '').replace('_', ' ')}) ·{' '}
          {rupees(result.recommendation?.base_tariff)}/night
          <div className="opacity-70 mt-0.5">{result.reason}</div>
        </div>
      )

    case 'find_checkin_for_checkout':
      return (
        <span>
          Active check-in #<strong>{result.checkin_id}</strong> · room{' '}
          <strong>{result.room_number}</strong> · {result.guest}
        </span>
      )

    case 'get_revenue_report':
      return (
        <div>
          <strong>{rupees(result.total_revenue)}</strong> across{' '}
          {result.total_invoices} invoices · avg <strong>{rupees(result.average_per_invoice)}</strong>
        </div>
      )

    default:
      return <span className="opacity-70">Done.</span>
  }
}

function KV({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="opacity-60 text-[10px]">{k}</span>
      <span className="font-semibold">{v ?? '—'}</span>
    </div>
  )
}
