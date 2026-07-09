import React, { useState, useEffect } from 'react'
import { X, Clock } from 'lucide-react'
import { toast } from 'react-toastify'
import { checkinsAPI, folioAPI } from '../../services/api'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime, toDateTimeLocalInput } from '../../utils/datetime'

/**
 * LateCheckoutModal — extend an active stay's expected checkout time and
 * (optionally) add a late-checkout fee to the guest's folio.
 *
 * Backend: PUT /api/checkins/{id}/late-checkout
 * Props: { checkin, onClose, onSuccess }
 */
export default function LateCheckoutModal({ checkin, onClose, onSuccess }) {
  const { settings } = useSettings()

  // Default the new time to 2 hours after the current expected checkout
  // (or 2 hours from now if that's already in the past / unset).
  const defaultNewTime = () => {
    const base = checkin?.expected_checkout ? new Date(checkin.expected_checkout) : new Date()
    const from = base > new Date() ? base : new Date()
    return toDateTimeLocalInput(new Date(from.getTime() + 2 * 60 * 60 * 1000))
  }

  // Default fee comes from the lodge's `late_checkout_charge` setting.
  const defaultCharge = () => {
    const v = parseFloat(settings?.late_checkout_charge)
    return Number.isNaN(v) || v < 0 ? 0 : v
  }

  const [form, setForm] = useState({
    new_checkout_time: defaultNewTime(),
    late_checkout_charge: defaultCharge(),
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  // Late-checkout fees already accumulated on this stay's folio (preview).
  const [existingFees, setExistingFees] = useState(null)

  useEffect(() => {
    folioAPI.listForCheckin(checkin.checkin_id)
      .then(r => {
        const items = r.data?.items || []
        const total = items
          .filter(it => it.category === 'late_checkout' && !it.voided)
          .reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
        setExistingFees(total)
      })
      .catch(() => setExistingFees(null))
  }, [checkin.checkin_id])

  const handleSave = async () => {
    if (!form.new_checkout_time) {
      toast.error('Please select a new checkout time')
      return
    }
    if (new Date(form.new_checkout_time) <= new Date(checkin.checkin_datetime)) {
      toast.error('New checkout must be after the check-in time')
      return
    }
    setSaving(true)
    try {
      const res = await checkinsAPI.lateCheckout(checkin.checkin_id, {
        new_checkout_time: form.new_checkout_time,
        late_checkout_charge: parseFloat(form.late_checkout_charge) || 0,
        notes: form.notes || '',
      })
      toast.success(res.data?.message || 'Checkout time extended')
      onSuccess && onSuccess(res.data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to extend checkout')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gold/15 rounded-full flex items-center justify-center">
              <Clock size={20} className="text-gold" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-navy">Extend / Late Checkout</h3>
              <p className="text-xs text-ink-500">
                Room {checkin.room_number}: {checkin.customer?.first_name} {checkin.customer?.last_name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600 p-1"><X size={18} /></button>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-ink-50 rounded-xl px-3 py-2 text-xs text-ink-600">
            Current expected checkout:{' '}
            <span className="font-semibold text-navy">
              {checkin.expected_checkout ? formatDateTime(checkin.expected_checkout) : 'Open'}
            </span>
          </div>

          <div>
            <label className="text-[10px] font-bold text-ink-400 uppercase">New Expected Checkout *</label>
            <input type="datetime-local" step="900"
                   className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                   value={form.new_checkout_time}
                   onChange={e => setForm({ ...form, new_checkout_time: e.target.value })} />
          </div>

          <div>
            <label className="text-[10px] font-bold text-ink-400 uppercase">Late Checkout Fee (₹)</label>
            <input type="number" min="0" step="1"
                   className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                   value={form.late_checkout_charge}
                   onChange={e => setForm({ ...form, late_checkout_charge: e.target.value })} />
            <p className="text-[10px] text-ink-400 mt-1">
              Added to the guest's folio and billed at checkout. Set 0 for a free extension.
            </p>
            {existingFees !== null && existingFees > 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Late-checkout fees already on folio: ₹{existingFees.toLocaleString('en-IN')}
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold text-ink-400 uppercase">Notes</label>
            <textarea rows={2}
                      className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm resize-none focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                      value={form.notes}
                      onChange={e => setForm({ ...form, notes: e.target.value })}
                      placeholder="Reason for extension (optional)…" />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} disabled={saving}
                  className="flex-1 py-2.5 border rounded-xl text-ink-700 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2.5 bg-navy text-white rounded-xl text-sm font-semibold disabled:opacity-60">
            {saving ? '…' : 'Extend Checkout'}
          </button>
        </div>
      </div>
    </div>
  )
}
