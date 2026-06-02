import React, { useState, useEffect, useMemo, useRef } from 'react'
import { bookingsAPI, customersAPI } from '../../services/api'
import { toast } from 'react-toastify'
import {
  X, User, Phone, Mail, CreditCard, Clipboard, BedDouble, Wallet,
  MapPin, Star, Edit2, Ban, ShieldCheck, Search,
} from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'

const TARIFF_KEY_BY_TYPE = {
  deluxe_ac: 'tariff_deluxe_ac',
  ac:        'tariff_ac',
  non_ac:    'tariff_non_ac',
  house:     'tariff_house',
}

const ROOM_TYPES = [
  { value: 'deluxe_ac', label: 'Deluxe AC' },
  { value: 'ac', label: 'AC' },
  { value: 'non_ac', label: 'Non-AC' },
  { value: 'house', label: 'House' },
]

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'upi', label: 'UPI / PhonePe' },
  { value: 'online', label: 'Online Transfer' },
]

const ID_TYPES = [
  { value: 'aadhar', label: 'Aadhar Card', placeholder: '12-digit number' },
  { value: 'driving_license', label: 'Driving License', placeholder: 'KA0120XXXXXXXXXXX' },
  { value: 'voter_id', label: 'Voter ID', placeholder: 'ABC1234567' },
  { value: 'passport', label: 'Passport', placeholder: 'A1234567' },
  { value: 'pan', label: 'PAN Card', placeholder: 'ABCDE1234F' },
]

/**
 * BookingModal — create OR edit an advance reservation.
 * Mirrors the CheckinModal guest experience: phone autocomplete,
 * returning-guest recognition, first/last name split, ID fields, address, etc.
 */
export default function BookingModal({ booking, onClose, onSuccess }) {
  const isEdit = !!booking
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const { settings } = useSettings()
  const [guestSearch, setGuestSearch] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [returningGuest, setReturningGuest] = useState(null)
  const [guestEditExpanded, setGuestEditExpanded] = useState(false)
  const phoneRef = useRef()

  // Resolve the default tariff for a room type from Settings
  const tariffForType = (roomType) => {
    const key = TARIFF_KEY_BY_TYPE[roomType]
    const val = key ? parseFloat(settings?.[key]) : NaN
    return !Number.isNaN(val) && val > 0 ? val : 0
  }

  // Parse existing booking guest_name into first/last for edit mode
  const editFirstName = booking?.guest_name?.split(' ')[0] || ''
  const editLastName = booking?.guest_name?.split(' ').slice(1).join(' ') || ''

  // Default tariff from settings for initial room type
  const initialRoomType = booking?.room_type_requested || 'non_ac'

  const [form, setForm] = useState({
    first_name: editFirstName,
    last_name: editLastName,
    phone: booking?.guest_phone || '',
    email: booking?.guest_email || '',
    address: '',
    id_type: 'aadhar',
    id_number: '',
    nationality: 'Indian',
    gender: '',
    room_type: booking?.room_type_requested || 'non_ac',
    rooms_count: booking?.rooms_count || 1,
    checkin_date: booking?.checkin_date || '',
    checkout_date: booking?.checkout_date || '',
    adults: booking?.adults || 1,
    children: booking?.children || 0,
    tariff_per_night: booking?.tariff_per_night || '',
    advance_amount: booking?.advance_amount || '',
    advance_payment_mode: booking?.advance_payment_mode || 'cash',
    special_requests: booking?.special_requests || '',
  })

  // Auto-fill tariff from settings when room type changes (new bookings only)
  useEffect(() => {
    if (isEdit) return
    const def = tariffForType(form.room_type)
    if (def > 0) {
      setForm(f => ({ ...f, tariff_per_night: def }))
    }
  }, [form.room_type, settings]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC closes the modal
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Guest search autocomplete — by phone or name
  useEffect(() => {
    if (guestSearch.length < 3 || isEdit) { setSuggestions([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      customersAPI.autocomplete(guestSearch)
        .then(res => setSuggestions(res.data || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [guestSearch, isEdit])

  async function handleSelectCustomer(cust) {
    setSuggestions([])
    setGuestSearch('')
    try {
      const res = await customersAPI.get(cust.customer_id)
      const c = res.data
      if (c.blacklisted) {
        toast.error(`${c.first_name} ${c.last_name} is blacklisted${c.blacklist_reason ? `: ${c.blacklist_reason}` : ''}. Cannot create booking.`)
        return
      }
      setReturningGuest(c)
      setGuestEditExpanded(false)
      setForm(f => ({
        ...f,
        first_name: c.first_name,
        last_name: c.last_name,
        phone: c.phone,
        email: c.email || '',
        address: c.address || '',
        id_type: c.id_type || 'aadhar',
        id_number: c.id_number || '',
        nationality: c.nationality || 'Indian',
        gender: c.gender || '',
      }))
    } catch {
      toast.error('Could not load guest details')
    }
  }

  // Live derived figures
  const nights = useMemo(() => {
    if (!form.checkin_date || !form.checkout_date) return 0
    const ci = new Date(form.checkin_date)
    const co = new Date(form.checkout_date)
    const d = Math.round((co - ci) / 86400000)
    return d > 0 ? d : 0
  }, [form.checkin_date, form.checkout_date])

  const totalAmount = useMemo(() => (
    Math.round((parseFloat(form.tariff_per_night) || 0) * nights * (parseInt(form.rooms_count) || 1) * 100) / 100
  ), [form.tariff_per_night, nights, form.rooms_count])

  const balanceDue = useMemo(() => (
    Math.max(0, totalAmount - (parseFloat(form.advance_amount) || 0))
  ), [totalAmount, form.advance_amount])

  const todayStr = new Date().toISOString().slice(0, 10)

  const validate = () => {
    if (!form.first_name || form.first_name.trim().length < 2) {
      toast.error('First name is required (min 2 characters)'); return false
    }
    if (!form.last_name || form.last_name.trim().length < 1) {
      toast.error('Last name is required'); return false
    }
    if (!/^\d{10}$/.test(String(form.phone).replace(/\D/g, ''))) {
      toast.error('Phone must be 10 digits'); return false
    }
    if (!form.checkin_date || !form.checkout_date) {
      toast.error('Check-in and check-out dates are required'); return false
    }
    if (nights <= 0) {
      toast.error('Check-out must be after check-in'); return false
    }
    if (!isEdit && form.checkin_date < todayStr) {
      toast.error('Check-in date cannot be in the past'); return false
    }
    if ((parseFloat(form.tariff_per_night) || 0) <= 0) {
      toast.error('Tariff per night must be greater than zero'); return false
    }
    if ((parseInt(form.rooms_count) || 1) < 1) {
      toast.error('At least one room is required'); return false
    }
    if ((parseFloat(form.advance_amount) || 0) > totalAmount) {
      toast.error('Advance cannot exceed the booking total'); return false
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const guestName = `${form.first_name.trim()} ${form.last_name.trim()}`.trim()
      const payload = {
        guest_name: guestName,
        guest_phone: String(form.phone).replace(/\D/g, ''),
        guest_email: form.email || null,
        room_type: form.room_type,
        rooms_count: parseInt(form.rooms_count) || 1,
        checkin_date: form.checkin_date,
        checkout_date: form.checkout_date,
        adults: parseInt(form.adults) || 1,
        children: parseInt(form.children) || 0,
        tariff_per_night: parseFloat(form.tariff_per_night) || 0,
        advance_amount: parseFloat(form.advance_amount) || 0,
        advance_payment_mode: form.advance_payment_mode,
        special_requests: form.special_requests || null,
      }
      if (isEdit) {
        await bookingsAPI.update(booking.booking_id, payload)
        toast.success('Booking updated')
      } else {
        await bookingsAPI.create(payload)
        toast.success('Booking created successfully')
      }
      onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Failed to save booking')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none transition-all"
  const inputWithIconCls = "w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none transition-all"
  const labelCls = "text-[10px] font-bold text-gray-400 uppercase tracking-wider"

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-navy p-6 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold font-playfair text-gold">
              {isEdit ? `Edit Booking ${booking.booking_ref}` : 'New Advance Booking'}
            </h3>
            <p className="text-xs opacity-60 mt-1">
              {isEdit ? 'Update reservation details' : 'Reserve rooms for a phone or walk-in guest'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
            className="hover:bg-white/10 p-2 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-5 max-h-[72vh] overflow-y-auto custom-scrollbar">

          {/* Search existing guest — by phone or name */}
          {!returningGuest && (
            <div className="relative">
              <label className={labelCls}>
                Search Guest <span className="text-gray-300 font-normal normal-case">(type phone or name — min 3 chars)</span>
              </label>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  ref={phoneRef} autoFocus type="text"
                  className={inputWithIconCls}
                  placeholder="Phone number or guest name..."
                  value={guestSearch}
                  onChange={e => setGuestSearch(e.target.value)}
                />
                {searching && <div className="absolute right-3 top-3 w-4 h-4 border-2 border-navy border-t-transparent rounded-full animate-spin" />}
              </div>

              {suggestions.length > 0 && (
                <div className="absolute z-30 w-full bg-white border border-gray-200 rounded-lg shadow-xl mt-1 overflow-hidden max-h-72 overflow-y-auto">
                  {suggestions.map(s => (
                    <button key={s.customer_id} type="button"
                      className={`w-full text-left px-4 py-3 hover:bg-amber-50 transition-colors border-b border-gray-50 last:border-0 ${s.blacklisted ? 'bg-red-50/50' : ''}`}
                      onClick={() => handleSelectCustomer(s)}>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-navy text-sm flex-1">{s.full_name}</p>
                        {s.blacklisted && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                            <Ban size={10} /> Blacklisted
                          </span>
                        )}
                        {s.is_vip && !s.blacklisted && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                            VIP
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">{s.phone} · {s.total_visits} visit{s.total_visits !== 1 ? 's' : ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Phone field (shown always, auto-filled from guest search) */}
          <div>
            <label className={labelCls}>Phone *</label>
            <div className="relative mt-1">
              <Phone size={14} className="absolute left-3 top-3 text-gray-400" />
              <input type="tel" required maxLength={10}
                className={inputWithIconCls}
                placeholder="10-digit mobile number"
                value={form.phone}
                onChange={e => {
                  setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })
                  if (returningGuest) { setReturningGuest(null); setGuestEditExpanded(false) }
                }}
              />
            </div>
          </div>

          {/* Returning guest summary card OR full guest fields */}
          {returningGuest && !guestEditExpanded ? (
            <div className="bg-amber-50 border-2 border-gold rounded-xl p-4 flex items-center gap-3">
              <Star size={20} className="text-gold flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-navy text-sm truncate">
                    Returning guest: {returningGuest.first_name} {returningGuest.last_name}
                  </p>
                  {returningGuest.is_vip && (
                    <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">VIP</span>
                  )}
                  {returningGuest.id_proof_path && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                      <ShieldCheck size={10} /> ID on file
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-xs mt-0.5">
                  {returningGuest.phone} · {returningGuest.total_visits} previous visit{returningGuest.total_visits !== 1 ? 's' : ''}
                  {returningGuest.email ? ` · ${returningGuest.email}` : ''}
                </p>
              </div>
              <button type="button"
                onClick={() => setGuestEditExpanded(true)}
                className="text-xs text-navy font-semibold hover:underline whitespace-nowrap inline-flex items-center gap-1">
                <Edit2 size={12} /> Edit
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* First Name / Last Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>First Name *</label>
                  <div className="relative mt-1">
                    <User size={14} className="absolute left-3 top-3 text-gray-400" />
                    <input type="text" required
                      className={inputWithIconCls}
                      placeholder="First name"
                      value={form.first_name}
                      onChange={e => setForm({ ...form, first_name: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Last Name *</label>
                  <input type="text" required
                    className={`${inputCls} mt-1`}
                    placeholder="Last name"
                    value={form.last_name}
                    onChange={e => setForm({ ...form, last_name: e.target.value })} />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className={labelCls}>Email</label>
                <div className="relative mt-1">
                  <Mail size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input type="email"
                    className={inputWithIconCls}
                    placeholder="guest@email.com (optional)"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              {/* ID Proof */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>ID Type</label>
                  <select className={`${inputCls} mt-1`}
                    value={form.id_type}
                    onChange={e => setForm({ ...form, id_type: e.target.value, id_number: '' })}>
                    {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>ID Number</label>
                  <input type="text"
                    className={`${inputCls} mt-1 uppercase`}
                    value={form.id_number}
                    onChange={e => setForm({ ...form, id_number: e.target.value.toUpperCase() })}
                    placeholder={ID_TYPES.find(t => t.value === form.id_type)?.placeholder} />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className={labelCls}>Address</label>
                <div className="relative mt-1">
                  <MapPin size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input type="text"
                    className={inputWithIconCls}
                    placeholder="City or full address"
                    value={form.address}
                    onChange={e => setForm({ ...form, address: e.target.value })} />
                </div>
              </div>

              {/* Gender + Nationality */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Gender</label>
                  <select className={`${inputCls} mt-1`} value={form.gender}
                    onChange={e => setForm({ ...form, gender: e.target.value })}>
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Nationality</label>
                  <input type="text" className={`${inputCls} mt-1`} value={form.nationality}
                    onChange={e => setForm({ ...form, nationality: e.target.value })} />
                </div>
              </div>

              {returningGuest && guestEditExpanded && (
                <button type="button"
                  onClick={() => setGuestEditExpanded(false)}
                  className="text-xs text-navy font-semibold hover:underline">
                  Collapse guest details
                </button>
              )}
            </div>
          )}

          {/* Reservation Details section */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-4">Reservation Details</h4>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Check-in Date *</label>
                <input type="date" required min={isEdit ? undefined : todayStr}
                  className={`${inputCls} mt-1`}
                  value={form.checkin_date}
                  onChange={e => setForm({ ...form, checkin_date: e.target.value })} />
              </div>

              <div>
                <label className={labelCls}>Check-out Date *</label>
                <input type="date" required min={form.checkin_date || todayStr}
                  className={`${inputCls} mt-1`}
                  value={form.checkout_date}
                  onChange={e => setForm({ ...form, checkout_date: e.target.value })} />
              </div>

              <div>
                <label className={labelCls}>Room Type *</label>
                <select
                  className={`${inputCls} mt-1`}
                  value={form.room_type}
                  onChange={e => setForm({ ...form, room_type: e.target.value })}>
                  {ROOM_TYPES.map(t => {
                    const rate = tariffForType(t.value)
                    return (
                      <option key={t.value} value={t.value}>
                        {t.label}{rate > 0 ? ` — ₹${rate}/night` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label className={labelCls}>No. of Rooms *</label>
                <div className="relative mt-1">
                  <BedDouble size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input type="number" min={1} max={20} required
                    className={inputWithIconCls}
                    value={form.rooms_count}
                    onChange={e => setForm({ ...form, rooms_count: parseInt(e.target.value) || 1 })} />
                </div>
              </div>

              <div>
                <label className={labelCls}>
                  Tariff / Room / Night (₹) *
                  {(() => {
                    const def = tariffForType(form.room_type)
                    const current = parseFloat(form.tariff_per_night) || 0
                    if (def > 0 && current !== def) return (
                      <span className="text-amber-600 font-normal normal-case ml-1">(default: ₹{def})</span>
                    )
                    return null
                  })()}
                </label>
                <div className="relative mt-1">
                  <CreditCard size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input type="number" required min={0}
                    className={inputWithIconCls}
                    value={form.tariff_per_night}
                    onChange={e => setForm({ ...form, tariff_per_night: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Adults</label>
                  <input type="number" min={1}
                    className={`${inputCls} mt-1`}
                    value={form.adults}
                    onChange={e => setForm({ ...form, adults: parseInt(e.target.value) || 1 })} />
                </div>
                <div>
                  <label className={labelCls}>Children</label>
                  <input type="number" min={0}
                    className={`${inputCls} mt-1`}
                    value={form.children}
                    onChange={e => setForm({ ...form, children: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
            </div>
          </div>

          {/* Advance / Payment */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-bold text-navy uppercase tracking-wider mb-4">Advance Payment</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Advance Amount (₹)</label>
                <div className="relative mt-1">
                  <Wallet size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input type="number" min={0}
                    className={inputWithIconCls}
                    value={form.advance_amount}
                    onChange={e => setForm({ ...form, advance_amount: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Advance Paid Via</label>
                <select
                  className={`${inputCls} mt-1`}
                  value={form.advance_payment_mode}
                  onChange={e => setForm({ ...form, advance_payment_mode: e.target.value })}>
                  {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Special Requests */}
          <div>
            <label className={labelCls}>Special Requests</label>
            <div className="relative mt-1">
              <Clipboard size={14} className="absolute left-3 top-3 text-gray-400" />
              <textarea
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none h-20 resize-none transition-all"
                placeholder="Any preferences or notes..."
                value={form.special_requests}
                onChange={e => setForm({ ...form, special_requests: e.target.value })} />
            </div>
          </div>

          {/* Live cost summary */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5">
            <div className="flex justify-between text-xs text-amber-800">
              <span>{form.rooms_count || 1} room(s) × {nights} night(s) × ₹{(parseFloat(form.tariff_per_night) || 0).toLocaleString('en-IN')}</span>
              <span className="font-semibold">₹{totalAmount.toLocaleString('en-IN')}</span>
            </div>
            {(parseFloat(form.advance_amount) || 0) > 0 && (
              <div className="flex justify-between text-xs text-amber-800">
                <span>Advance ({form.advance_payment_mode})</span>
                <span className="font-semibold text-green-700">− ₹{(parseFloat(form.advance_amount) || 0).toLocaleString('en-IN')}</span>
              </div>
            )}
            <div className="flex justify-between pt-1.5 border-t border-amber-300">
              <span className="text-[10px] font-bold uppercase text-amber-700">
                {(parseFloat(form.advance_amount) || 0) > 0 ? 'Balance due at check-in' : 'Total Amount'}
              </span>
              <span className="text-lg font-bold text-amber-900">₹{balanceDue.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-bold hover:bg-gray-50 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-3 bg-navy text-white rounded-xl font-bold hover:bg-navy-dark transition-all disabled:opacity-50 shadow-lg shadow-navy/10">
              {loading ? 'Saving...' : (isEdit ? 'Save Changes' : 'Confirm Booking')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}