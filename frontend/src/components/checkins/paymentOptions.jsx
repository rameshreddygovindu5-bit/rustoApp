import React from 'react'
import { useSettings } from '../../context/SettingsContext'

/**
 * Canonical payment-mode list for the check-in/checkout module.
 * The backend stores plain strings, so extending this list is safe.
 */
export const PAYMENT_MODES = [
  { value: 'cash',    label: 'Cash' },
  { value: 'card',    label: 'Card' },
  { value: 'upi',     label: 'UPI/QR' },
  { value: 'phonepe', label: 'PhonePe' },
  { value: 'gpay',    label: 'GPay' },
  { value: 'paytm',   label: 'Paytm' },
  { value: 'online',  label: 'Online Transfer' },
]

// Payment mode → the settings key holding the collection UPI id / number.
const COLLECTION_KEY_BY_MODE = {
  upi:     'collection_upi_id',
  phonepe: 'collection_phonepe',
  gpay:    'collection_gpay',
  paytm:   'collection_paytm',
}

/**
 * Small helper box shown under the payment-mode select for digital modes:
 * "Collect payment to: <configured UPI id / number>". Renders nothing when
 * the mode isn't digital or the lodge hasn't configured a collection target.
 */
export function CollectionHint({ mode }) {
  const { settings } = useSettings()
  const key = COLLECTION_KEY_BY_MODE[mode]
  const target = key ? String(settings?.[key] || '').trim() : ''
  if (!target) return null
  const label = PAYMENT_MODES.find(m => m.value === mode)?.label || mode
  return (
    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
      <span className="font-semibold">{label}:</span>{' '}
      Collect payment to <span className="font-bold font-mono">{target}</span>
    </div>
  )
}
