import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, Search, Filter, RefreshCw, ExternalLink, X, Building2, LogIn, Edit2 } from 'lucide-react'
import { toast } from 'react-toastify'
import { bookingsAPI } from '../services/api'
import BookingModal from '../components/bookings/BookingModal'
import GuestSearchInput from '../components/GuestSearchInput'

const STATUS_COLORS = {
  pending:    'bg-amber-100 text-amber-800',
  confirmed:  'bg-blue-100 text-blue-800',
  checked_in: 'bg-green-100 text-green-800',
  completed:  'bg-gray-100 text-gray-700',
  cancelled:  'bg-red-100 text-red-800',
  no_show:    'bg-red-100 text-red-700',
}

const SOURCE_COLORS = {
  walk_in:   'text-gray-600',
  direct:    'text-blue-600',
  agency:    'text-purple-600',
  corporate: 'text-amber-700',
}

export default function Bookings() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Allow ?date=YYYY-MM-DD to deep-link a single check-in day from the dashboard.
  const dateParam = searchParams.get('date') || ''
  // Allow ?search=foo (booking ref / guest name) so the TapeChart can
  // deep-link to a specific booking when an admin clicks a cell.
  const searchParam = searchParams.get('search') || ''
  const [bookings, setBookings] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filters, setFilters]   = useState({ status: '', source: '', search: searchParam, date: dateParam })
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [selected, setSelected] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editBooking, setEditBooking] = useState(null)
  const limit = 25

  // Keep the date + search filters in sync if the URL changes (e.g., the
  // user clicks a different cell on the TapeChart while this tab is open).
  useEffect(() => {
    setFilters(f => {
      if (f.date === dateParam && f.search === searchParam) return f
      return { ...f, date: dateParam, search: searchParam }
    })
    setPage(1)
  }, [dateParam, searchParam])

  const load = async () => {
    setLoading(true)
    try {
      const params = { page, limit }
      if (filters.status) params.status = filters.status
      if (filters.source) params.source = filters.source
      if (filters.search) params.search = filters.search
      if (filters.date) {
        params.from_date = filters.date
        params.to_date = filters.date
      }
      const res = await bookingsAPI.list(params)
      setBookings(res.data.data || [])
      setTotal(res.data.total || 0)
    } catch (e) {
      toast.error('Failed to load bookings')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filters, page])

  // Refetch when the AI agent creates/cancels/edits a booking.
  useEffect(() => {
    const onAgentChange = () => load()
    window.addEventListener('lms:agent:data_changed', onAgentChange)
    return () => window.removeEventListener('lms:agent:data_changed', onAgentChange)
  }, [filters, page])

  const clearDateFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('date')
    setSearchParams(next, { replace: true })
  }

  const cancelBooking = async (id) => {
    const reason = window.prompt('Cancellation reason?')
    if (!reason) return
    try {
      await bookingsAPI.cancel(id, { reason })
      toast.success('Booking cancelled')
      setSelected(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel')
    }
  }

  const totalPages = Math.ceil(total / limit) || 1

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-navy">Bookings & Reservations</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {total} bookings
            {filters.date
              ? ` · check-in on ${filters.date}`
              : ' · all sources combined'}
          </p>
          {filters.date && (
            <button
              onClick={clearDateFilter}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-100 text-amber-800 px-3 py-1 rounded-full hover:bg-amber-200 transition-colors"
            >
              <Calendar size={12} />
              Showing {filters.date}
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={() => setShowCreateModal(true)} className="flex-1 sm:flex-none px-4 py-2.5 bg-navy text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-navy-dark transition-all shadow-lg shadow-navy/20 text-sm">
            <Calendar size={16} /> New Booking
          </button>
          <button onClick={load} className="p-2.5 border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px]">
            <GuestSearchInput
              value={filters.search}
              onChange={v => setFilters({ ...filters, search: v })}
              onSelect={(customer) => { setFilters({ ...filters, search: customer.phone }); setPage(1) }}
              placeholder="Search ref, guest name, phone..."
            />
          </div>
          <select className="input-field" value={filters.status}
                  onChange={e => { setFilters({ ...filters, status: e.target.value }); setPage(1) }}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="checked_in">Checked In</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
          <select className="input-field" value={filters.source}
                  onChange={e => { setFilters({ ...filters, source: e.target.value }); setPage(1) }}>
            <option value="">All sources</option>
            <option value="walk_in">Walk-in</option>
            <option value="direct">Direct</option>
            <option value="agency">Agency / OTA</option>
            <option value="corporate">Corporate</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 border-navy border-t-gold rounded-full animate-spin" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">No bookings match your filters.</div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {bookings.map(b => (
              <div key={b.booking_id} onClick={() => setSelected(b)} 
                   className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm active:bg-gray-50">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs font-mono text-gray-400">{b.booking_ref}</p>
                    <p className="font-bold text-navy">{b.guest_name}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_COLORS[b.status] || ''}`}>
                    {b.status.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-gray-400">Stay</p>
                    <p className="font-medium">{b.checkin_date} ({b.nights}n)</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Total</p>
                    <p className="font-bold text-navy">₹{b.total_amount.toLocaleString('en-IN')}</p>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                  <span className={`text-[10px] font-medium ${SOURCE_COLORS[b.source] || ''}`}>
                    {b.agency_name || (b.source || '').replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                    Room {b.room_number || 'Unassigned'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block card overflow-x-auto p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Booking Ref</th>
                  <th>Guest</th>
                  <th>Source</th>
                  <th>Stay</th>
                  <th>Room</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b, i) => (
                  <tr key={b.booking_id} onClick={() => setSelected(b)}
                      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                      className="cursor-pointer group animate-slide-up">
                    <td className="font-mono text-xs">{b.booking_ref}</td>
                    <td>
                      <div className="font-medium">{b.guest_name}</div>
                      <div className="text-xs text-gray-500">{b.guest_phone}</div>
                    </td>
                    <td>
                      <span className={`text-xs font-semibold ${SOURCE_COLORS[b.source] || ''}`}>
                        {b.agency_name || (b.source || '').replace('_', ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="text-xs">
                      {b.checkin_date} → {b.checkout_date}<br/>
                      <span className="text-gray-500">{b.nights}n · {b.adults}A {b.children > 0 && `${b.children}C`}</span>
                    </td>
                    <td>
                      {b.room_number || <span className="text-gray-400">unassigned</span>}
                      <div className="text-[10px] text-gray-500">{b.room_type_requested?.replace('_', ' ')}</div>
                    </td>
                    <td>
                      <div className="font-semibold">₹{b.total_amount.toLocaleString('en-IN')}</div>
                      {b.advance_amount > 0 && (
                        <div className="text-[10px] text-green-600">
                          ₹{b.advance_amount.toLocaleString('en-IN')} advance
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold ${STATUS_COLORS[b.status] || ''}`}>
                        {b.status}
                      </span>
                    </td>
                    <td><ExternalLink size={14} className="text-gray-400 group-hover:text-gold group-hover:translate-x-0.5 transition-all" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex justify-center gap-2 text-sm mt-4">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Prev</button>
            <span className="self-center text-gray-500">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Next</button>
          </div>
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <BookingModal 
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => { setShowCreateModal(false); load(); }}
        />
      )}

      {/* Edit Modal */}
      {editBooking && (
        <BookingModal
          booking={editBooking}
          onClose={() => setEditBooking(null)}
          onSuccess={() => { setEditBooking(null); load(); }}
        />
      )}

      {/* Detail modal */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h3 className="text-xl font-display font-bold text-navy">{selected.guest_name}</h3>
                <p className="text-xs text-gray-500 font-mono">{selected.booking_ref}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-navy"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <Field label="Status">
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${STATUS_COLORS[selected.status] || ''}`}>
                  {selected.status}
                </span>
              </Field>
              <Field label="Source">
                {selected.agency_name
                  ? <><Building2 size={12} className="inline mr-1" /> {selected.agency_name} <code className="text-xs text-gray-500 ml-2">{selected.agency_booking_ref}</code></>
                  : selected.source}
              </Field>
              <Field label="Phone">{selected.guest_phone}</Field>
              <Field label="Email">{selected.guest_email || '—'}</Field>
              <Field label="Stay">
                {selected.checkin_date} → {selected.checkout_date} ({selected.nights} nights)
              </Field>
              <Field label="Guests">{selected.adults} adults · {selected.children} children</Field>
              <Field label="Rooms">
                {selected.rooms_count || 1} × {selected.room_type_requested?.replace('_', ' ')}
                {selected.room_number ? ` · Room ${selected.room_number}` : ''}
              </Field>
              <Field label="Tariff/Night">₹{selected.tariff_per_night?.toLocaleString('en-IN')}</Field>
              <Field label="Total">₹{selected.total_amount?.toLocaleString('en-IN')}</Field>
              <Field label="Advance Paid">
                <span className="text-green-700 font-semibold">
                  ₹{(selected.advance_amount || 0).toLocaleString('en-IN')}
                </span>
                {selected.advance_amount > 0 && (
                  <span className="text-gray-400 text-xs ml-1">via {selected.advance_payment_mode}</span>
                )}
              </Field>
              <Field label="Balance Due">
                <span className="font-bold text-navy">
                  ₹{(selected.balance_due ?? (selected.total_amount - (selected.advance_amount || 0))).toLocaleString('en-IN')}
                </span>
              </Field>
              {selected.commission_amount > 0 && <Field label="Commission">₹{selected.commission_amount?.toLocaleString('en-IN')}</Field>}
              <Field label="Payment">{selected.payment_status}</Field>
              {selected.special_requests && <Field label="Notes">{selected.special_requests}</Field>}
              {selected.cancellation_reason && (
                <Field label="Cancellation">
                  <span className="text-red-600">{selected.cancellation_reason}</span>
                </Field>
              )}
            </div>
            <div className="p-6 border-t flex flex-wrap justify-end gap-3">
              {/* Convert to Check-in — for confirmed/pending bookings not yet checked in. */}
              {['pending', 'confirmed'].includes(selected.status) && (
                <button
                  onClick={() => {
                    // Hand off to the Check-ins page which opens the CheckinModal
                    // pre-filled from this booking (SPA navigation, no reload).
                    navigate(`/checkins?booking=${selected.booking_id}`)
                  }}
                  className="btn-gold flex items-center gap-2"
                >
                  <LogIn size={15} /> Check In Guest
                </button>
              )}
              {/* Edit — only while still pending/confirmed. */}
              {['pending', 'confirmed'].includes(selected.status) && (
                <button onClick={() => { setEditBooking(selected); setSelected(null); }} className="btn-outline flex items-center gap-2">
                  <Edit2 size={15} /> Edit
                </button>
              )}
              {!['cancelled', 'completed', 'no_show', 'checked_in'].includes(selected.status) && (
                <button onClick={() => cancelBooking(selected.booking_id)} className="btn-danger">
                  Cancel Booking
                </button>
              )}
              <button onClick={() => setSelected(null)} className="btn-outline">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className="flex">
      <div className="w-32 text-gray-500">{label}</div>
      <div className="flex-1 text-navy">{children}</div>
    </div>
  )
}
