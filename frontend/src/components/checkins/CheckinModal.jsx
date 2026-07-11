import React, { useState, useEffect, useMemo, useRef } from 'react'
import { checkinsAPI, customersAPI, roomsAPI, bookingsAPI } from '../../services/api'
import { toast } from 'react-toastify'
import { X, Upload, Star, Plus, Trash2, Edit2, Ban, ShieldCheck } from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'
import SignaturePad from './SignaturePad'
import { PAYMENT_MODES, CollectionHint } from './paymentOptions'
import {
  formatDateTime,
  toDateTimeLocalInput,
  defaultCheckinDatetime,
  defaultExpectedCheckout,
  nightsBetween,
  hoursBetween,
} from '../../utils/datetime'

const PURPOSE_OPTIONS = ['Pilgrimage', 'Tourism', 'Business', 'Family Function', 'Medical', 'Other']

// Fallback shown when the lodge hasn't configured `guest_declaration_text`.
const DEFAULT_DECLARATION =
  'I hereby declare that the details furnished above are true and correct. ' +
  'I agree to abide by the house rules of the lodge and accept responsibility ' +
  'for any damage caused to the room or property during my stay.'

const ID_TYPES = [
  { value: 'aadhar', label: 'Aadhar Card', placeholder: '12-digit number', pattern: /^\d{12}$/ },
  { value: 'driving_license', label: 'Driving License', placeholder: 'KA0120XXXXXXXXXXX', pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{11}$/i },
  { value: 'voter_id', label: 'Voter ID', placeholder: 'ABC1234567', pattern: /^[A-Z]{3}\d{7}$/i },
  { value: 'passport', label: 'Passport', placeholder: 'A1234567', pattern: /^[A-Z]\d{7}$/i },
  { value: 'pan', label: 'PAN Card', placeholder: 'ABCDE1234F', pattern: /^[A-Z]{5}\d{4}[A-Z]$/i },
]

// Map room_type -> the settings key that holds its tariff. Used to surface the
// live-from-Settings rate on the form, so admin's tariff edits show up here
// immediately (R1).
const TARIFF_KEY_BY_TYPE = {
  deluxe_ac: 'tariff_deluxe_ac',
  ac:        'tariff_ac',
  non_ac:    'tariff_non_ac',
  house:     'tariff_house',
}

/**
 * Resolve the *default* rent for a given room. If admin has just changed the
 * tariff in Settings, we honour that immediately — even before the rooms list
 * has been re-fetched — by reading from SettingsContext.
 */
function defaultRentFor(room, settings) {
  if (!room) return 0
  const settingKey = TARIFF_KEY_BY_TYPE[room.room_type]
  const fromSettings = settingKey ? parseFloat(settings?.[settingKey]) : NaN
  if (!Number.isNaN(fromSettings) && fromSettings > 0) return fromSettings
  return parseFloat(room.base_tariff) || 0
}

export default function CheckinModal({ room, customer: initialCustomer, bookingPrefill, onClose, onSuccess }) {
  const { settings, refresh: refreshSettings } = useSettings()

  // When this check-in originates from a confirmed booking, we keep the
  // booking around so we can: pre-fill the form, carry the advance into the
  // stay, link the records, and mark the booking checked-in afterwards.
  const linkedBooking = bookingPrefill?.booking || null

  // ── Multi-room support (R3) ──────────────────────────────────────────
  // `selectedRooms` is the source of truth for which rooms are being checked
  // in. Each row carries its own rent + deposit so admin can override per
  // room (R1). The single-room case is just N=1.
  const [selectedRooms, setSelectedRooms] = useState(() =>
    room ? [{ room_id: String(room.room_id), tariff_per_night: '', deposit_amount: '' }] : []
  )

  // Form state for the *guest* portion of the check-in.
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '', address: '',
    id_type: 'aadhar', id_number: '',
    members_count: 1,
    checkin_datetime: defaultCheckinDatetime(),
    expected_checkout: defaultExpectedCheckout(),
    special_notes: '',
    nationality: 'Indian', gender: '',
    sms_alert_preference: 'yes',
    payment_mode: 'cash',
    purpose_of_visit: '',
    vehicle_number: '',
  })

  const [step, setStep] = useState('form')
  const [idFile, setIdFile] = useState(null)
  // House-rules declaration + digital signature (captured on review step).
  const [declarationAccepted, setDeclarationAccepted] = useState(false)
  const [signature, setSignature] = useState(null)   // base64 PNG data URL
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [returningGuest, setReturningGuest] = useState(null)
  const [guestEditExpanded, setGuestEditExpanded] = useState(false)  // R5
  const [availableRooms, setAvailableRooms] = useState([])
  const [errors, setErrors] = useState({})
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const phoneRef = useRef()

  // ── Pre-load all available rooms for the dropdowns ───────────────────
  useEffect(() => {
    roomsAPI.available().then(res => {
      const list = Array.isArray(res) ? res : res?.data
      setAvailableRooms(list || [])
    }).catch(() => {})
  }, [])

  // ── Refresh public settings on mount so live tariff defaults are current.
  useEffect(() => { refreshSettings && refreshSettings() }, [])  // eslint-disable-line

  // ── Pre-load customer if passed (R8d: "Check In" from Customers page) ──
  useEffect(() => {
    if (initialCustomer) {
      // Treat as a phone-search hit so the same returning-guest path applies.
      handleSelectCustomer(initialCustomer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomer])

  // ── Pre-fill from a booking ("Check In Guest" on the Bookings page) ──
  // The booking gives us guest details, the room type, the tariff, the
  // number of rooms reserved, and the advance already collected.
  useEffect(() => {
    if (!bookingPrefill || !linkedBooking) return
    const b = linkedBooking

    // Guest details from the reservation.
    setForm(f => ({
      ...f,
      first_name: (b.guest_name || '').split(' ')[0] || b.guest_name || '',
      last_name: (b.guest_name || '').split(' ').slice(1).join(' ') || '',
      phone: b.guest_phone || '',
      email: b.guest_email || '',
      members_count: Math.max(1, (b.adults || 1) + (b.children || 0)),
      special_notes: b.special_requests || '',
      payment_mode: b.advance_payment_mode || 'cash',
    }))

    // If the booking guest matches an existing customer, load the full
    // record (collapses guest fields, picks up ID-on-file).
    if (bookingPrefill.matched_customer_id) {
      handleSelectCustomer({ customer_id: bookingPrefill.matched_customer_id })
    }

    // Pre-fill the room rows: one row per reserved room, defaulting the rent
    // to the booking's tariff. Reception still picks which physical rooms.
    const needed = bookingPrefill.rooms_needed || b.rooms_count || 1
    const tariff = String(b.tariff_per_night || '')
    const avail = bookingPrefill.available_rooms || []
    const rows = []
    for (let i = 0; i < needed; i++) {
      const pick = avail[i]
      rows.push({
        room_id: pick ? String(pick.room_id) : '',
        tariff_per_night: tariff,
        deposit_amount: tariff,
      })
    }
    setSelectedRooms(rows.length ? rows : [{ room_id: '', tariff_per_night: tariff, deposit_amount: tariff }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingPrefill])

  // ── Pre-fill rent/deposit on the initial room once we have settings ───
  useEffect(() => {
    if (!room) return
    const def = defaultRentFor(room, settings)
    setSelectedRooms(rs => {
      if (!rs.length) {
        return [{ room_id: String(room.room_id), tariff_per_night: String(def), deposit_amount: String(def) }]
      }
      return rs.map((r, i) => i === 0 ? {
        ...r,
        tariff_per_night: r.tariff_per_night || String(def),
        deposit_amount:   r.deposit_amount   || String(def),
      } : r)
    })
  }, [room, settings])

  // ── ESC closes (with confirmation if dirty) ──────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); attemptClose() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, loading, step, returningGuest, selectedRooms, idFile])

  // ── Phone autocomplete ───────────────────────────────────────────────
  useEffect(() => {
    if (form.phone.length < 3) { setSuggestions([]); return }
    setSearching(true)
    const t = setTimeout(() => {
      customersAPI.autocomplete(form.phone)
        .then(res => setSuggestions(res.data || []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [form.phone])

  async function handleSelectCustomer(cust) {
    setSuggestions([])
    try {
      const res = await customersAPI.get(cust.customer_id)
      const c = res.data
      // R8b: don't let reception accidentally check in a blacklisted guest.
      if (c.blacklisted) {
        toast.error(`⛔ ${c.first_name} ${c.last_name} is blacklisted${c.blacklist_reason ? `: ${c.blacklist_reason}` : ''}. Cannot check in.`)
        return
      }
      setReturningGuest(c)
      setGuestEditExpanded(false)  // R5: collapse the guest section by default
      setForm(f => ({
        ...f,
        first_name: c.first_name, last_name: c.last_name, phone: c.phone,
        email: c.email || '', address: c.address || '',
        id_type: c.id_type || 'aadhar', id_number: c.id_number || '',
        nationality: c.nationality || 'Indian', gender: c.gender || '',
      }))
    } catch {
      toast.error('Could not load guest details')
    }
  }

  // ── Multi-room helpers ──────────────────────────────────────────────
  const addRoomRow = () => {
    setSelectedRooms(rs => [...rs, { room_id: '', tariff_per_night: '', deposit_amount: '' }])
  }
  const removeRoomRow = (idx) => {
    setSelectedRooms(rs => rs.filter((_, i) => i !== idx))
  }
  const updateRoomRow = (idx, patch) => {
    setSelectedRooms(rs => rs.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, ...patch }
      // When room_id changes, re-pre-fill rent/deposit using the live default.
      if ('room_id' in patch) {
        const picked = availableRooms.find(x => String(x.room_id) === String(patch.room_id))
        const def = defaultRentFor(picked, settings)
        if (def > 0) {
          next.tariff_per_night = String(def)
          next.deposit_amount   = String(def)
        }
      }
      return next
    }))
  }

  // ── Dirty-state for "discard?" prompt ───────────────────────────────
  const isFormDirty = () => {
    if (returningGuest) return idFile || selectedRooms.some(r => r.room_id || r.tariff_per_night)
    return Boolean(
      form.first_name || form.last_name || form.phone ||
      form.email || form.address || form.id_number ||
      form.special_notes || idFile ||
      selectedRooms.some(r => r.room_id || r.tariff_per_night)
    )
  }

  const attemptClose = () => {
    if (loading) return
    if (showCloseConfirm) { setShowCloseConfirm(false); return }
    if (step === 'preview' || isFormDirty()) setShowCloseConfirm(true)
    else onClose()
  }

  const handleCheckinChange = (newCheckin) => {
    setForm(prev => {
      const currentCheckin = prev.checkin_datetime;
      const currentCheckout = prev.expected_checkout;
      
      let nextCheckout = currentCheckout;
      
      if (currentCheckin && currentCheckout) {
        const msDiff = new Date(currentCheckout) - new Date(currentCheckin);
        if (msDiff > 0) {
          // Maintain the same duration
          const newCheckoutDate = new Date(new Date(newCheckin).getTime() + msDiff);
          nextCheckout = toDateTimeLocalInput(newCheckoutDate);
        } else {
          // If previous was invalid or 0, set to +24h
          const d = new Date(newCheckin);
          d.setDate(d.getDate() + 1);
          nextCheckout = toDateTimeLocalInput(d);
        }
      } else {
        // Fallback
        const d = new Date(newCheckin);
        d.setDate(d.getDate() + 1);
        nextCheckout = toDateTimeLocalInput(d);
      }
      
      return {
        ...prev,
        checkin_datetime: newCheckin,
        expected_checkout: nextCheckout
      };
    });
  };

  // ── Settings-driven behaviour ────────────────────────────────────────
  const isForeignNational =
    !['indian', 'india', ''].includes((form.nationality || '').trim().toLowerCase())
  const requireSignature =
    String(settings?.require_customer_signature || 'false').toLowerCase() === 'true'
  const declarationText =
    (settings?.guest_declaration_text || '').trim() || DEFAULT_DECLARATION
  const canConfirm = declarationAccepted && (!requireSignature || !!signature)

  // ── Validation ───────────────────────────────────────────────────────
  const validate = () => {
    const errs = {}
    if (!form.first_name || form.first_name.length < 2) errs.first_name = 'Min 2 characters'
    if (!form.last_name  || form.last_name.length  < 2) errs.last_name  = 'Min 2 characters'
    if (!/^\d{10}$/.test(form.phone))                   errs.phone      = 'Must be 10 digits'
    if (!form.id_type)   errs.id_type   = 'Select ID type'
    // Form C / FRRO: foreign nationals must check in on a passport.
    if (isForeignNational && form.id_type !== 'passport') {
      errs.id_type = 'Foreign nationals must use Passport as ID (Form C requirement)'
    }
    if (!form.id_number) errs.id_number = 'ID number required'
    else {
      const def = ID_TYPES.find(t => t.value === form.id_type)
      if (def && !def.pattern.test(form.id_number.toUpperCase()))
        errs.id_number = `Invalid ${def.label} format`
    }
    if (!form.checkin_datetime) errs.checkin_datetime = 'Required'
    if (!form.expected_checkout) errs.expected_checkout = 'Required'
    else if (form.checkin_datetime &&
             hoursBetween(form.checkin_datetime, form.expected_checkout) < 1) {
      errs.expected_checkout = 'Checkout must be at least 1 hour after check-in'
    }
    if (form.members_count < 1 || form.members_count > 6) {
      errs.members_count = 'Guests must be between 1 and 6'
    }

    // Room rows
    if (!selectedRooms.length) {
      errs.rooms = 'Pick at least one room'
    } else {
      const seen = new Set()
      selectedRooms.forEach((r, i) => {
        if (!r.room_id) errs[`room_${i}`] = 'Pick a room'
        else if (seen.has(String(r.room_id))) errs[`room_${i}`] = 'Same room picked twice'
        else seen.add(String(r.room_id))

        const t = parseFloat(r.tariff_per_night)
        if (Number.isNaN(t) || t <= 0) errs[`tariff_${i}`] = 'Required (>0)'
        const d = parseFloat(r.deposit_amount)
        if (Number.isNaN(d) || d < 0) errs[`deposit_${i}`] = 'Required (≥0)'
      })
    }

    // R2: ID file mandatory unless returning guest already has one on file.
    if (!idFile && !returningGuest?.id_proof_path) {
      errs.id_proof = 'ID proof image is mandatory'
    }

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleReview = (e) => {
    e.preventDefault()
    if (!validate()) {
      toast.error('Please fix the highlighted fields')
      return
    }
    setStep('preview')
  }

  const processCheckin = async () => {
    if (!declarationAccepted) {
      toast.error('Guest must accept the house rules / declaration to proceed')
      return
    }
    if (requireSignature && !signature) {
      toast.error('Guest signature is required to complete check-in (lodge policy)')
      return
    }
    setLoading(true)
    try {
      const fd = new FormData()
      // Guest fields
      Object.entries(form).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) fd.append(k, v)
      })
      // Multi-room payload (R3)
      const roomsPayload = selectedRooms.map(r => ({
        room_id: parseInt(r.room_id, 10),
        tariff_per_night: parseFloat(r.tariff_per_night),
        deposit_amount: parseFloat(r.deposit_amount),
      }))
      fd.append('rooms', JSON.stringify(roomsPayload))
      // Back-compat: also send the legacy single-room fields (the backend
      // ignores them when `rooms` is present, but middleware/audit logs
      // sometimes look for them).
      fd.append('room_id', String(roomsPayload[0].room_id))
      fd.append('deposit_amount', String(roomsPayload[0].deposit_amount))
      fd.append('tariff_per_night', String(roomsPayload[0].tariff_per_night))

      // Booking-linked check-in: pass the booking id and the advance already
      // collected, so the backend links the records and credits the bill.
      if (linkedBooking) {
        fd.append('booking_id', String(linkedBooking.booking_id))
        if (linkedBooking.advance_amount > 0) {
          fd.append('advance_paid', String(linkedBooking.advance_amount))
        }
      }

      if (idFile) fd.append('id_proof', idFile)

      // House-rules declaration + digital signature (base64 PNG data URL).
      fd.append('declaration_accepted', declarationAccepted ? 'true' : 'false')
      if (signature) fd.append('signature', signature)

      const res = await checkinsAPI.create(fd)
      const count = res?.data?.count ?? roomsPayload.length

      // Mark the linked booking checked-in (idempotent; the backend also
      // sets this, but this also links the first checkin row explicitly).
      if (linkedBooking) {
        try {
          await bookingsAPI.markCheckedIn(linkedBooking.booking_id, {
            checkin_id: res?.data?.checkin_id,
          })
        } catch (e) {
          // Non-fatal — the booking status is already set server-side during
          // create_checkin. Just log.
          console.warn('mark-checked-in follow-up failed', e)
        }
      }

      toast.success(
        count > 1
          ? `✅ ${count} rooms checked in for ${form.first_name}`
          : `✅ Check-in successful! Room ${res?.data?.room_number || ''} assigned.`
      )
      onSuccess && onSuccess(res?.data)
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Check-in failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // ── Memoized derived bits ────────────────────────────────────────────
  const computedNights = useMemo(() => (
    form.checkin_datetime && form.expected_checkout
      ? nightsBetween(form.checkin_datetime, form.expected_checkout)
      : 0
  ), [form.checkin_datetime, form.expected_checkout])

  const totalDeposit = useMemo(() => (
    selectedRooms.reduce((s, r) => s + (parseFloat(r.deposit_amount) || 0), 0)
  ), [selectedRooms])

  const totalEstimate = useMemo(() => (
    selectedRooms.reduce((s, r) => s + (parseFloat(r.tariff_per_night) || 0) * Math.max(1, computedNights), 0)
  ), [selectedRooms, computedNights])

  // Build the per-row room-options list. Same available list for every row,
  // but we hide rooms already picked in OTHER rows so user can't double-book.
  const roomOptionsFor = (idx) => {
    const otherPicked = new Set(
      selectedRooms.filter((_, i) => i !== idx).map(r => String(r.room_id)).filter(Boolean)
    )
    // If a pre-selected room isn't in availableRooms (race), include it.
    const merged = [...availableRooms]
    if (room && !merged.find(r => r.room_id === room.room_id)) merged.unshift(room)
    return merged.filter(r => !otherPicked.has(String(r.room_id)))
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && attemptClose()}
    >
      <div className="modal-box">
        {/* Sticky header — close button always reachable */}
        <div className="bg-navy p-6 flex items-center justify-between rounded-t-2xl sticky top-0 z-20">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-gold font-bold">
              {step === 'form' ? 'New Check-in' : 'Review Check-in'}
            </h2>
            <p className="text-white/70 text-sm mt-0.5 truncate">
              {selectedRooms.length > 1
                ? `${selectedRooms.length} rooms`
                : selectedRooms[0]?.room_id
                  ? (() => {
                      const r = availableRooms.find(x => String(x.room_id) === String(selectedRooms[0].room_id)) || room
                      return r ? `Room ${r.room_number} · ${r.room_type?.replace('_',' ').toUpperCase()}` : ''
                    })()
                  : 'Select rooms below'}
            </p>
          </div>
          <button type="button" onClick={attemptClose} disabled={loading}
            aria-label="Close" title="Close (Esc)"
            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-1.5 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        {step === 'form' ? (
        <form onSubmit={handleReview} className="p-6 space-y-5 max-h-[68vh] overflow-y-auto custom-scrollbar">

          {/* Booking-linked banner — shown when checking in from a reservation */}
          {linkedBooking && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="font-semibold text-gold text-sm flex items-center gap-2">
                📋 Checking in from booking {linkedBooking.booking_ref}
              </p>
              <p className="text-xs text-white/60 mt-1">
                {linkedBooking.rooms_count || 1} room(s) reserved ·{' '}
                {linkedBooking.checkin_date} → {linkedBooking.checkout_date}
                {linkedBooking.advance_amount > 0 && (
                  <> · <span className="text-green-400 font-semibold">
                    ₹{Number(linkedBooking.advance_amount).toLocaleString('en-IN')} advance
                  </span> will be credited at checkout</>
                )}
              </p>
            </div>
          )}

          {/* ── Phone search (always at top — quickest path) ─────────── */}
          <div className="relative">
            <label className="label">Phone Number * <span className="text-ink-400 font-normal">(autocomplete searches existing guests)</span></label>
            <div className="relative">
              <input
                ref={phoneRef} autoFocus type="tel" maxLength={10}
                className={`input-field pr-8 ${errors.phone ? 'border-red-400' : ''}`}
                placeholder="10-digit mobile number"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
              />
              {searching && <div className="absolute right-3 top-3 w-4 h-4 border-2 border-navy border-t-transparent rounded-full animate-spin" />}
            </div>
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}

            {suggestions.length > 0 && (
              <div className="absolute z-30 w-full bg-white border border-ink-200 rounded-lg shadow-xl mt-1 overflow-hidden max-h-72 overflow-y-auto">
                {suggestions.map(s => (
                  <button key={s.customer_id} type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-amber-50 transition-colors border-b border-ink-100 last:border-0 ${s.blacklisted ? 'bg-red-50/50' : ''}`}
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
                          ⭐ VIP
                        </span>
                      )}
                    </div>
                    <p className="text-ink-500 text-xs mt-0.5">{s.phone} · {s.total_visits} visit{s.total_visits !== 1 ? 's' : ''}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Returning guest summary card OR full guest fields (R5) ─ */}
          {returningGuest && !guestEditExpanded ? (
            <div className="bg-amber-50 border-2 border-gold rounded-xl p-4 flex items-center gap-3">
              <Star size={20} className="text-gold flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-navy text-sm truncate">
                    Returning guest: {returningGuest.first_name} {returningGuest.last_name}
                  </p>
                  {returningGuest.is_vip && (
                    <span className="text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">⭐ VIP</span>
                  )}
                  {returningGuest.id_proof_path && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                      <ShieldCheck size={10} /> ID on file
                    </span>
                  )}
                </div>
                <p className="text-ink-600 text-xs mt-0.5">
                  {returningGuest.phone} · {returningGuest.total_visits} previous visit{returningGuest.total_visits !== 1 ? 's' : ''}
                  {returningGuest.email ? ` · ${returningGuest.email}` : ''}
                </p>
              </div>
              <button type="button"
                onClick={() => setGuestEditExpanded(true)}
                className="text-xs text-navy font-semibold hover:underline whitespace-nowrap inline-flex items-center gap-1">
                <Edit2 size={12} /> Edit details
              </button>
            </div>
          ) : (
            <>
              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">First Name *</label>
                  <input type="text" className={`input-field ${errors.first_name ? 'border-red-400' : ''}`}
                    value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })}
                    placeholder="First name" />
                  {errors.first_name && <p className="text-red-500 text-xs mt-1">{errors.first_name}</p>}
                </div>
                <div>
                  <label className="label">Last Name *</label>
                  <input type="text" className={`input-field ${errors.last_name ? 'border-red-400' : ''}`}
                    value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })}
                    placeholder="Last name" />
                  {errors.last_name && <p className="text-red-500 text-xs mt-1">{errors.last_name}</p>}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="label">Email</label>
                <input type="email" className="input-field" value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })} placeholder="guest@email.com" />
              </div>

              {/* ID Proof */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ID Type *</label>
                  <select className={`input-field ${errors.id_type ? 'border-red-400' : ''}`}
                    value={form.id_type}
                    onChange={e => setForm({ ...form, id_type: e.target.value, id_number: '' })}>
                    {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {errors.id_type && <p className="text-red-500 text-xs mt-1">{errors.id_type}</p>}
                  {isForeignNational && form.id_type !== 'passport' && !errors.id_type && (
                    <p className="text-amber-700 text-xs mt-1">
                      Foreign national — Passport is required (Form C).
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">ID Number *</label>
                  <input type="text"
                    className={`input-field uppercase ${errors.id_number ? 'border-red-400' : ''}`}
                    value={form.id_number}
                    onChange={e => setForm({ ...form, id_number: e.target.value.toUpperCase() })}
                    placeholder={ID_TYPES.find(t => t.value === form.id_type)?.placeholder} />
                  {errors.id_number && <p className="text-red-500 text-xs mt-1">{errors.id_number}</p>}
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="label">Address</label>
                <textarea rows={2} className="input-field resize-none" value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="Full postal address" />
              </div>

              {/* Gender + Nationality */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Gender</label>
                  <select className="input-field" value={form.gender}
                    onChange={e => setForm({ ...form, gender: e.target.value })}>
                    <option value="">Select</option>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">Nationality</label>
                  <input type="text" className="input-field" value={form.nationality}
                    onChange={e => setForm({ ...form, nationality: e.target.value })} />
                </div>
              </div>

              {returningGuest && guestEditExpanded && (
                <button type="button"
                  onClick={() => setGuestEditExpanded(false)}
                  className="text-xs text-navy font-semibold hover:underline">
                  ← Collapse guest details
                </button>
              )}
            </>
          )}

          {/* ── ID proof upload (R2 — mandatory unless on file) ───────── */}
          {!(returningGuest?.id_proof_path && !idFile) && (
            <div>
              <label className="label">
                ID Proof Image *
                <span className="text-ink-400 font-normal"> (JPG/PNG/PDF, max 5MB)</span>
              </label>
              <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:border-navy transition-colors ${errors.id_proof ? 'border-red-400 bg-red-50/30' : 'border-ink-300'}`}>
                <Upload size={18} className="text-ink-400" />
                <span className="text-sm text-ink-600 truncate">{idFile ? idFile.name : 'Click to upload ID proof'}</span>
                <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf"
                  onChange={e => setIdFile(e.target.files[0])} />
              </label>
              {errors.id_proof && <p className="text-red-500 text-xs mt-1">{errors.id_proof}</p>}
            </div>
          )}
          {returningGuest?.id_proof_path && !idFile && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={14} /> Previous ID on file — re-upload only if it needs replacing.
              </span>
              <span className="flex items-center gap-3">
                <a href={`/uploads/${returningGuest.id_proof_path}`} target="_blank" rel="noopener noreferrer"
                  className="text-navy font-semibold hover:underline">View</a>
                <label className="text-navy font-semibold cursor-pointer hover:underline">
                  Replace
                  <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf"
                    onChange={e => setIdFile(e.target.files[0])} />
                </label>
              </span>
            </div>
          )}

          {/* ── Rooms section (R3 multi-room + R1 per-room rent) ──────── */}
          <div className="bg-ink-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-navy text-sm">🛏 Rooms</h4>
              <button type="button" onClick={addRoomRow}
                disabled={!!room && selectedRooms.length === 0}
                className="text-xs font-semibold text-navy hover:underline inline-flex items-center gap-1">
                <Plus size={12} /> Add another room
              </button>
            </div>

            {errors.rooms && <p className="text-red-500 text-xs">{errors.rooms}</p>}

            {selectedRooms.length === 0 && (
              <button type="button" onClick={addRoomRow}
                className="w-full py-3 border-2 border-dashed border-ink-300 rounded-lg text-sm text-ink-500 hover:border-navy hover:text-navy">
                + Pick a room
              </button>
            )}

            {selectedRooms.map((rr, idx) => {
              const picked = availableRooms.find(x => String(x.room_id) === String(rr.room_id))
              const liveDefault = picked ? defaultRentFor(picked, settings) : 0
              const userTariff = parseFloat(rr.tariff_per_night)
              const isOverridden = picked && !Number.isNaN(userTariff) && userTariff !== liveDefault
              return (
                <div key={idx} className="bg-white border border-ink-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
                      Room {idx + 1}
                    </span>
                    {selectedRooms.length > 1 && (
                      <button type="button" onClick={() => removeRoomRow(idx)}
                        className="text-red-500 hover:bg-red-50 rounded p-1"
                        aria-label="Remove room">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <select
                    disabled={!!room && idx === 0}
                    className={`input-field ${errors[`room_${idx}`] ? 'border-red-400' : ''} ${(!!room && idx === 0) ? 'bg-ink-100' : ''}`}
                    value={rr.room_id}
                    onChange={e => updateRoomRow(idx, { room_id: e.target.value })}>
                    <option value="">Select a room…</option>
                    {roomOptionsFor(idx).map(r => (
                      <option key={r.room_id} value={r.room_id}>
                        Room {r.room_number} — {r.room_type?.replace('_',' ')} — ₹{defaultRentFor(r, settings)}/night
                      </option>
                    ))}
                  </select>
                  {errors[`room_${idx}`] && <p className="text-red-500 text-xs">{errors[`room_${idx}`]}</p>}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-ink-500">Rent / night (₹) *</label>
                      <input type="number" min={0} step={1}
                        className={`input-field ${errors[`tariff_${idx}`] ? 'border-red-400' : ''}`}
                        value={rr.tariff_per_night}
                        onChange={e => updateRoomRow(idx, { tariff_per_night: e.target.value })}
                        placeholder={String(liveDefault || '')} />
                      {errors[`tariff_${idx}`] && <p className="text-red-500 text-[10px]">{errors[`tariff_${idx}`]}</p>}
                      {isOverridden && (
                        <p className="text-[10px] text-amber-700 mt-0.5">
                          Overridden — default ₹{liveDefault}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-ink-500">Deposit (₹) *</label>
                      <input type="number" min={0} step={1}
                        className={`input-field ${errors[`deposit_${idx}`] ? 'border-red-400' : ''}`}
                        value={rr.deposit_amount}
                        onChange={e => updateRoomRow(idx, { deposit_amount: e.target.value })} />
                      {errors[`deposit_${idx}`] && <p className="text-red-500 text-[10px]">{errors[`deposit_${idx}`]}</p>}
                    </div>
                  </div>
                </div>
              )
            })}

            {selectedRooms.length > 0 && computedNights > 0 && (
              <p className="text-[10px] text-ink-500 pt-1 border-t border-ink-200">
                Estimated room charges: <strong>₹{totalEstimate.toLocaleString('en-IN')}</strong>
                {' · '}Total deposit: <strong>₹{totalDeposit.toLocaleString('en-IN')}</strong>
              </p>
            )}
          </div>

          {/* ── Members + Dates ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">No. of Guests * <span className="text-ink-400 font-normal">(max 6)</span></label>
              <input type="number" min={1} max={6}
                className={`input-field ${errors.members_count ? 'border-red-400' : ''}`}
                value={form.members_count}
                onChange={e => setForm({ ...form, members_count: parseInt(e.target.value) || 1 })} />
              {errors.members_count && <p className="text-red-500 text-xs mt-1">{errors.members_count}</p>}
            </div>
            <div>
              <label className="label">Payment Method *</label>
              <select className="input-field" value={form.payment_mode}
                onChange={e => setForm({ ...form, payment_mode: e.target.value })}>
                {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <CollectionHint mode={form.payment_mode} />
            </div>
            <div>
              <label className="label">Purpose of Visit</label>
              <select className="input-field" value={form.purpose_of_visit}
                onChange={e => setForm({ ...form, purpose_of_visit: e.target.value })}>
                <option value="">Select…</option>
                {PURPOSE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Vehicle Number</label>
              <input type="text" className="input-field uppercase" value={form.vehicle_number}
                onChange={e => setForm({ ...form, vehicle_number: e.target.value.toUpperCase() })}
                placeholder="e.g. AP09AB1234" maxLength={15} />
            </div>
            <div>
              <label className="label">Check-in Date &amp; Time *</label>
              <input type="datetime-local" step="900"
                className={`input-field ${errors.checkin_datetime ? 'border-red-400' : ''}`}
                value={form.checkin_datetime}
                onChange={e => handleCheckinChange(e.target.value)} />
              {errors.checkin_datetime && <p className="text-red-500 text-xs mt-1">{errors.checkin_datetime}</p>}
            </div>
            <div>
              <label className="label">Expected Checkout *</label>
              <input type="datetime-local" step="900"
                className={`input-field ${errors.expected_checkout ? 'border-red-400' : ''}`}
                value={form.expected_checkout}
                onChange={e => setForm({ ...form, expected_checkout: e.target.value })} />
              {errors.expected_checkout && <p className="text-red-500 text-xs mt-1">{errors.expected_checkout}</p>}
            </div>
            <div className="col-span-2">
              {form.expected_checkout && form.checkin_datetime && !errors.expected_checkout && !errors.checkin_datetime && (
                <p className="text-[10px] text-navy font-bold uppercase">
                  Duration: {computedNights} night{computedNights !== 1 ? 's' : ''}
                  {' · '}
                  Checkout: {formatDateTime(form.expected_checkout)}
                </p>
              )}
              <p className="text-[10px] text-ink-400 mt-0.5">Tariff is calculated on a 24-hour basis.</p>
            </div>
          </div>

          {/* ── Alerts + Notes ──────────────────────────────────────── */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
            <h4 className="font-semibold text-gold text-sm">📱 Alert Preferences</h4>
            <div className="flex items-center justify-between">
              <label className="text-sm text-white/80">SMS Notification</label>
              <select className="input-field w-32" value={form.sms_alert_preference}
                onChange={e => setForm({ ...form, sms_alert_preference: e.target.value })}>
                <option value="yes">Yes - Send SMS</option>
                <option value="no">No - Skip SMS</option>
              </select>
            </div>
            <p className="text-xs text-white/40">Email alerts depend on guest email and system settings.</p>
          </div>

          <div>
            <label className="label">Special Notes</label>
            <textarea rows={2} className="input-field resize-none" value={form.special_notes}
              onChange={e => setForm({ ...form, special_notes: e.target.value })}
              placeholder="Any special requests or notes…" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={attemptClose} className="btn-outline flex-1">Cancel</button>
            <button type="submit" className="btn-primary flex-1">Review Details ➔</button>
          </div>
          <p className="text-[10px] text-ink-400 text-center -mt-2">
            Tip: Press <kbd className="px-1 py-0.5 bg-ink-100 border rounded">Esc</kbd> or click outside to close.
          </p>
        </form>
        ) : (
        // ── Preview / Review screen ─────────────────────────────────────
        <div className="p-6 space-y-6 max-h-[68vh] overflow-y-auto custom-scrollbar">
          <div className="bg-ink-50 rounded-xl p-5 border border-ink-100 space-y-4">
            <div>
              <p className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-1">Guest</p>
              <p className="font-bold text-navy text-lg">{form.first_name} {form.last_name}</p>
              <p className="text-sm text-ink-600">
                {form.phone}{form.email ? ` · ${form.email}` : ''}
                {' · '}{form.id_type.toUpperCase()} {form.id_number}
              </p>
            </div>

            <div className="pt-3 border-t border-ink-200">
              <p className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-2">
                Rooms ({selectedRooms.length})
              </p>
              <div className="space-y-1.5">
                {selectedRooms.map((rr, i) => {
                  const r = availableRooms.find(x => String(x.room_id) === String(rr.room_id)) || room
                  const liveDef = r ? defaultRentFor(r, settings) : 0
                  const t = parseFloat(rr.tariff_per_night)
                  const isOverridden = !Number.isNaN(t) && t !== liveDef
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-navy">
                        Room {r?.room_number || rr.room_id}
                        <span className="text-ink-400 font-normal ml-1">({r?.room_type?.replace('_',' ')})</span>
                      </span>
                      <span className="text-ink-700">
                        ₹{rr.tariff_per_night}/night
                        {isOverridden && <span className="text-amber-700 text-[10px] ml-1">(was ₹{liveDef})</span>}
                        <span className="text-ink-400"> · ₹{rr.deposit_amount} dep</span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-ink-200">
              <div>
                <p className="text-xs text-ink-500">Check-in</p>
                <p className="text-sm font-semibold">{formatDateTime(form.checkin_datetime)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Expected Checkout</p>
                <p className="text-sm font-semibold">{formatDateTime(form.expected_checkout)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Guests</p>
                <p className="text-sm font-semibold">{form.members_count} · {computedNights} night{computedNights !== 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Total Deposit</p>
                <p className="text-sm font-semibold text-green-700">
                  ₹{totalDeposit.toLocaleString('en-IN')} <span className="text-ink-400 font-normal">({form.payment_mode})</span>
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-ink-500">Estimated room charges</p>
                <p className="text-sm font-semibold">₹{totalEstimate.toLocaleString('en-IN')}</p>
              </div>
              {(form.purpose_of_visit || form.vehicle_number) && (
                <>
                  <div>
                    <p className="text-xs text-ink-500">Purpose of Visit</p>
                    <p className="text-sm font-semibold">{form.purpose_of_visit || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Vehicle Number</p>
                    <p className="text-sm font-semibold">{form.vehicle_number || '—'}</p>
                  </div>
                </>
              )}
              {linkedBooking && linkedBooking.advance_amount > 0 && (
                <div className="col-span-2">
                  <p className="text-xs text-ink-500">Advance already paid (credited at checkout)</p>
                  <p className="text-sm font-semibold text-green-700">
                    − ₹{Number(linkedBooking.advance_amount).toLocaleString('en-IN')}
                    <span className="text-ink-400 font-normal"> ({linkedBooking.advance_payment_mode})</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── House-rules declaration + guest digital signature ────── */}
          <div className="bg-ink-50 rounded-xl p-5 border border-ink-100 space-y-4">
            <div>
              <p className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-2">
                Guest Declaration
              </p>
              <p className="text-sm text-ink-700 whitespace-pre-line bg-white border border-ink-200 rounded-lg p-3">
                {declarationText}
              </p>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1B2A4A]"
                checked={declarationAccepted}
                onChange={e => setDeclarationAccepted(e.target.checked)} />
              <span className="text-sm text-navy font-medium">
                I accept the house rules / declaration above *
              </span>
            </label>

            <div>
              <p className="text-xs text-ink-500 font-semibold uppercase tracking-wider mb-2">
                Guest Signature {requireSignature
                  ? <span className="text-red-500 normal-case">(required)</span>
                  : <span className="text-ink-400 normal-case font-normal">(optional)</span>}
              </p>
              <SignaturePad onChange={setSignature} disabled={loading} />
              {signature && (
                <p className="text-[11px] text-green-700 mt-1">✓ Signature captured</p>
              )}
              {requireSignature && !signature && (
                <p className="text-[11px] text-red-500 mt-1">
                  Signature is required by lodge policy.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" disabled={loading} className="btn-outline flex-1"
              onClick={() => { setStep('form'); setSignature(null) }}>
              ← Back to Edit
            </button>
            <button type="button" onClick={attemptClose} disabled={loading}
              className="btn-outline flex-1 text-red-600 border-red-200 hover:bg-red-50">
              Cancel
            </button>
            <button type="button" onClick={processCheckin} disabled={loading || !canConfirm}
              title={!canConfirm ? 'Accept the declaration (and sign, if required) to proceed' : undefined}
              className="btn-primary flex-[2] flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing…
                </>
              ) : '✅ Confirm & Check-in'}
            </button>
          </div>
        </div>
        )}
      </div>

      {/* "Discard?" confirmation */}
      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 animate-fade-in"
          onClick={(e) => e.target === e.currentTarget && setShowCloseConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-slide-up">
            <h3 className="font-display text-lg font-bold text-navy">Discard check-in?</h3>
            <p className="text-sm text-ink-600 mt-2">
              You have entered guest details that will be lost. Close anyway?
            </p>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowCloseConfirm(false)} className="btn-outline flex-1">
                Keep Editing
              </button>
              <button type="button" onClick={() => { setShowCloseConfirm(false); onClose() }} className="btn-danger flex-1">
                Discard &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
