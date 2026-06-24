/**
 * PmsPortalContext — Used by the standalone PMS build (AppPms.jsx).
 *
 * Always returns portal="pms" with no detection needed.
 * The branding comes from the settings API (hotel_name, logo_path, etc.)
 * so the login page is still lodge-branded.
 */
import React, { createContext, useContext, useState, useEffect } from 'react'

const PortalContext = createContext({
  portal: 'pms', branding: null, loading: false,
  override: null, setOverride: () => {}, effectivePortal: 'pms', clientIp: null,
})

export function PmsPortalProvider({ children }) {
  const [branding, setBranding] = useState(null)

  // Load lodge branding from settings so Login page shows lodge name/logo
  useEffect(() => {
    fetch('/api/public/detect-portal', {
      cache: 'no-store', headers: { Accept: 'application/json' },
    })
      .then(r => r.json())
      .then(d => { if (d.branding) setBranding(d.branding) })
      .catch(() => {})
  }, [])

  return (
    <PortalContext.Provider value={{
      portal: 'pms', branding, loading: false,
      override: null, setOverride: () => {}, effectivePortal: 'pms', clientIp: null,
      warmTheme: true,   // PMS portal uses Warm Neutrals theme
    }}>
      {children}
    </PortalContext.Provider>
  )
}

export const usePortal = () => useContext(PortalContext)
