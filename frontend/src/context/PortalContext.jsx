/**
 * PortalContext v11.0 — Zero-flash portal detection.
 *
 * The detection already happened in index.html's inline <script> tag
 * using a synchronous XHR BEFORE React started. The result is in
 * window.__PORTAL__. We read it here synchronously — no fetch, no
 * loading state, no spinner, no flash. Ever.
 *
 * Background polling still runs so IP changes are picked up and the
 * localStorage cache stays fresh for next page load — every 15s until the
 * first successful detection, then every 5 minutes.
 *
 * window.__PORTAL__ shape:
 *   { portal: "pms"|"customer", branding: {...}|null, clientIp: str }
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BASE     = import.meta.env.VITE_API_BASE || ''
// Poll fast only until the first successful background detection; after that
// slow WAY down. We can't stop entirely — the whole point of the background
// poll is to notice network/IP changes (laptop moves off the lodge Wi-Fi) and
// keep the localStorage cache fresh — but every 5 minutes is plenty for that,
// vs. hammering /api/public/detect-portal every 15s forever.
const POLL_MS_FAST    = 15_000        // until first successful detection
const POLL_MS_SETTLED = 5 * 60_000   // after portal has been resolved once
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
      if (!res.ok) return false
      const data = await res.json()
      const p = data.portal    || 'customer'
      const b = data.branding  || null
      const i = data.client_ip || null
      setPortal(p); setBranding(b); setClientIp(i)
      _writeCache({ portal: p, branding: b, clientIp: i })
      return true
    } catch {
      // Backend unreachable — keep existing state
      return false
    }
  }, [])

  useEffect(() => {
    // Self-scheduling timeout chain (instead of a fixed setInterval) so the
    // cadence can change: fast (15s) while we've never had a successful
    // detection, then settle to 5 minutes once the portal is resolved.
    let cancelled = false
    let timer = null
    let settled = false

    const schedule = (delay) => {
      timer = setTimeout(async () => {
        const ok = await detect()
        if (cancelled) return
        settled = settled || ok
        schedule(settled ? POLL_MS_SETTLED : POLL_MS_FAST)
      }, delay)
    }

    // First background refresh after 5s (don't hammer on startup)
    schedule(5_000)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
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
