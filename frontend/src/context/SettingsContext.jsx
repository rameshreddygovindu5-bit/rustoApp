import React, { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const SettingsContext = createContext({})

/**
 * Holds the hotel-branding values (name, tagline, logo, theme colors).
 *
 * Multi-tenant flow:
 *  - Pre-login (no token): we fetch `/api/settings/public`, which returns
 *    the default lodge's branding so the login page shows something
 *    sensible. The backend honours an optional `?lodge_code=` param if a
 *    deployment ever wants per-lodge subdomains.
 *  - Post-login: we fetch the authenticated `/api/settings` list, which
 *    is automatically scoped to the user's lodge by the X-Lodge-Id
 *    header (set by our axios interceptor). This way the sidebar name
 *    and logo update to match the logged-in user's lodge.
 *  - When the selected lodge id in localStorage changes (super-admin
 *    switching, which also reloads the page), the effect re-runs and
 *    pulls the new lodge's branding.
 */
export function SettingsProvider({ children }) {
  // Neutral defaults — the login page is a SHARED entry point for every
  // lodge using this LMS deployment, so we don't bake any one lodge's
  // brand into the pre-auth defaults. The moment a user signs in, their
  // own lodge's hotel_name / tagline / logo come down from /api/settings
  // and override these. (Previously this said "Udumula's Grand" which
  // confused users from other lodges who saw a competitor's name on
  // their login screen.)
  const [settings, setSettings] = useState({
    hotel_name: "Rusto",
    hotel_tagline: "Travel Anywhere. Rest Everywhere.",
    logo_path: "/logo.png",
    hotel_phone: "",
    hotel_email: "",
    agent_enabled: "true",
    premium_theme_enabled: "true",
    enabled_modules: null,       // null = all modules enabled (legacy mode)
    property_category: "lodge",  // drives module defaults
  })

  const refresh = () => {
    const token = localStorage.getItem('lms_token')
    if (token) {
      // Authenticated path — backend filters by the user's lodge.
      const headers = { Authorization: `Bearer ${token}` }
      const lid = localStorage.getItem('lms_selected_lodge_id')
      if (lid) headers['X-Lodge-Id'] = lid
      return axios.get('/api/settings', { headers })
        .then(res => {
          // Authenticated endpoint returns an array of {setting_key, setting_value}.
          // Fold them into a flat object so consumers see the same shape
          // as the public endpoint.
          const flat = {}
          for (const s of (res.data || [])) {
            if (s?.setting_key) flat[s.setting_key] = s.setting_value
          }
          if (Object.keys(flat).length) setSettings(prev => ({ ...prev, ...flat }))
        })
        .catch(() => {})
    }
    // Unauthenticated path — public branding for the login page.
    return axios.get('/api/settings/public')
      .then(res => {
        if (res.data && Object.keys(res.data).length > 0) {
          setSettings(prev => ({ ...prev, ...res.data }))
        }
      })
      .catch(() => {})
  }

  useEffect(() => {
    refresh()
    // Listen for cross-tab changes to the selected lodge (super-admin
    // switching in another tab) so this tab refreshes branding too.
    const onStorage = (e) => {
      if (e.key === 'lms_selected_lodge_id' || e.key === 'lms_token') {
        refresh()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Keep the browser tab title in sync with the lodge name. Falls back
  // to a neutral default when no lodge name is loaded yet (login page).
  useEffect(() => {
    const name = settings.hotel_name || "Rusto"
    document.title = name === "Rusto"
      ? name
      : `${name} — LMS`
  }, [settings.hotel_name])

  return (
    // Expose under both names so existing call-sites keep working.
    <SettingsContext.Provider value={{ settings, refresh, refreshSettings: refresh }}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => useContext(SettingsContext)
