import React, { useState, useEffect, useRef } from 'react'
import { Search, Star, Ban, Phone, User } from 'lucide-react'
import { customersAPI } from '../services/api'

/**
 * Reusable guest autocomplete search input.
 * Searches by phone number or name (min 3 chars).
 *
 * Props:
 *   value        — controlled input value
 *   onChange      — called with new text value on every keystroke
 *   onSelect      — called with full customer object when a suggestion is picked
 *   placeholder   — input placeholder text
 *   className     — extra classes for the wrapper div
 *   inputClassName — extra classes for the input element
 *   autoFocus     — focus input on mount
 */
export default function GuestSearchInput({
  value = '',
  onChange,
  onSelect,
  placeholder = 'Search by phone or name...',
  className = '',
  inputClassName = '',
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef()

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Autocomplete search
  useEffect(() => {
    const q = (value || '').trim()
    if (q.length < 3) { setSuggestions([]); setOpen(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      customersAPI.autocomplete(q)
        .then(res => {
          const data = res.data || []
          setSuggestions(data)
          setOpen(data.length > 0)
        })
        .catch(() => { setSuggestions([]); setOpen(false) })
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [value])

  const handleSelect = (customer) => {
    setOpen(false)
    setSuggestions([])
    onSelect && onSelect(customer)
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
      <input
        type="text"
        autoFocus={autoFocus}
        className={`w-full pl-10 pr-8 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy focus:ring-1 focus:ring-navy/20 outline-none transition-all ${inputClassName}`}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
      />
      {searching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-navy border-t-transparent rounded-full animate-spin" />
      )}

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-2xl mt-1 overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map(s => (
            <button
              key={s.customer_id}
              type="button"
              className={`w-full text-left px-4 py-3 hover:bg-amber-50 transition-colors border-b border-gray-50 last:border-0 ${s.blacklisted ? 'bg-red-50/40' : ''}`}
              onClick={() => handleSelect(s)}
            >
              <div className="flex items-center gap-2">
                <User size={14} className="text-gray-400 flex-shrink-0" />
                <span className="font-semibold text-navy text-sm flex-1 truncate">{s.full_name}</span>
                {s.blacklisted && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                    <Ban size={9} /> Blacklisted
                  </span>
                )}
                {s.is_vip && !s.blacklisted && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                    <Star size={9} /> VIP
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><Phone size={10} /> {s.phone}</span>
                <span>{s.total_visits} visit{s.total_visits !== 1 ? 's' : ''}</span>
                {s.last_room && <span>Last: Room {s.last_room}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}