/**
 * PortalContext v11.0 — Zero-flash portal detection.
 *
 * The detection already happened in index.html's inline <script> tag
 * using a synchronous XHR BEFORE React started. The result is in
 * window.__PORTAL__. We read it here synchronously — no fetch, no
 * loading state, no spinner, no flash. Ever.
 *
 * Background polling still runs every 15s so IP changes are picked up
 * and the localStorage cache stays fresh for next page load.
 *
 * window.__PORTAL__ shape:
 *   { portal: "pms"|"customer", branding: {...}|null, clientIp: str }
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BASE     = import.meta.env.VITE_API_BASE || ''
const POLL_MS  = 15_000
const CACHE_KEY = 'rusto_portal_cache'
const CACHE_TTL = 5 * 60 * 1000

// Read the synchronous detection result injected by index.html
const __p = window.__PORTAL__ || { portal: 'customer', branding: null, clientIp: null }

function _writeCache(d) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...d, ts: Date.now() }))
  } catch {}
}

const PortalContext = createContext({
  portal: 'customer', branding: null, loading: false,
  override: null, setOverride: () => {}, effectivePortal: 'customer', clientIp: null,
})

export function PortalProvider({ children }) {
  // Initialise directly from the synchronous detection — loading is ALWAYS false
  const [portal,   setPortal]   = useState(__p.portal   || 'customer')
  const [branding, setBranding] = useState(__p.branding || null)
  const [clientIp, setClientIp] = useState(__p.clientIp || null)
  const [loading]               = useState(false)   // never loading — already detected

  const [override, setOverrideState] = useState(
    () => sessionStorage.getItem('rusto_portal_override') || null
  )

  const setOverride = useCallback((val) => {
    setOverrideState(val)
    if (val) sessionStorage.setItem('rusto_portal_override', val)
    else     sessionStorage.removeItem('rusto_portal_override')
  }, [])

  // Background refresh — uses the Vite proxy path.
  // The lodge IP ranges include 127.0.0.1/::1 so proxy-forwarded requests work.
  const detect = useCallback(async () => {
    try {
      const res = await fetch('/api/public/detect-portal', {
        cache: 'no-store', headers: { Accept: 'application/json' },
      })
      if (!res.ok) return
      const data = await res.json()
      const p = data.portal    || 'customer'
      const b = data.branding  || null
      const i = data.client_ip || null
      setPortal(p); setBranding(b); setClientIp(i)
      _writeCache({ portal: p, branding: b, clientIp: i })
    } catch {
      // Backend unreachable — keep existing state
    }
  }, [])

  useEffect(() => {
    // First background refresh after 5s (don't hammer on startup)
    const t1 = setTimeout(detect, 5_000)
    const id  = setInterval(detect, POLL_MS)
    return () => { clearTimeout(t1); clearInterval(id) }
  }, [detect])

  const effectivePortal   = override ?? portal
  const effectiveBranding = effectivePortal === 'pms' ? branding : null

  return (
    <PortalContext.Provider value={{
      portal, branding: effectiveBranding, loading,
      override, setOverride, effectivePortal, clientIp,
    }}>
      {children}
    </PortalContext.Provider>
  )
}

export const usePortal = () => useContext(PortalContext)
