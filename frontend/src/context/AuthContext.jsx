import React, { createContext, useContext, useState, useEffect } from 'react'
import { authAPI, lodgesAPI } from '../services/api'
import { toast } from 'react-toastify'

const AuthContext = createContext(null)

/**
 * AuthContext — owner of identity AND the active tenant (lodge) scope.
 *
 * Two roles to keep in mind:
 *  - admin / staff: `user.lodge` is fixed at login; the UI shows that lodge
 *    name and DISABLES any lodge selector. They cannot switch.
 *  - super_admin: may switch which lodge they're operating on. The
 *    `selectedLodgeId` we keep here is sent as `X-Lodge-Id` on every API
 *    call (see axios interceptor in services/api.js) so backend queries
 *    scope to whichever lodge the super-admin is viewing.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // For super_admin only. Persisted so a page refresh keeps the selection.
  const [selectedLodgeId, setSelectedLodgeIdState] = useState(() => {
    const raw = localStorage.getItem('lms_selected_lodge_id')
    return raw ? parseInt(raw, 10) : null
  })

  useEffect(() => {
    const token = localStorage.getItem('lms_token')
    const savedUser = localStorage.getItem('lms_user')
    if (token && savedUser) {
      let parsed = null
      try { parsed = JSON.parse(savedUser) } catch {}
      if (parsed) {
        setUser(parsed)
        // Defensive: if a tenant user has a fixed lodge_id but the
        // lms_selected_lodge_id entry was cleared (manual localStorage
        // edit, partial cleanup, etc.), backfill from the saved user so
        // the next API call carries an X-Lodge-Id header.
        if (parsed.lodge_id && !localStorage.getItem('lms_selected_lodge_id')) {
          localStorage.setItem('lms_selected_lodge_id', String(parsed.lodge_id))
          setSelectedLodgeIdState(parsed.lodge_id)
        }
      }
      // Verify token still valid; if it isn't, drop everything.
      authAPI.getMe().catch(() => {
        localStorage.removeItem('lms_token')
        localStorage.removeItem('lms_user')
        localStorage.removeItem('lms_selected_lodge_id')
        setUser(null)
        setSelectedLodgeIdState(null)
      })
    }
    setLoading(false)
  }, [])

  const login = async (username, password, totpCode = null) => {
    // v2.4: if the user has 2FA enabled, the backend rejects the first
    // call (password-only) with detail="totp_required". The Login page
    // catches that, shows a TOTP input, and re-calls us with the code.
    const payload = { username, password }
    if (totpCode) payload.totp_code = totpCode
    const res = await authAPI.login(payload)
    localStorage.setItem('lms_token', res.data.token)
    localStorage.setItem('lms_user', JSON.stringify(res.data.user))

    // IMPORTANT — resolve the lodge scope FIRST, then set the user. If we
    // setUser() before the X-Lodge-Id is in localStorage, React re-renders
    // and React Router redirects to /dashboard immediately; the dashboard
    // mounts and fires API calls while the scope is still empty, and the
    // super_admin code path then 400s with "X-Lodge-Id required".
    if (res.data.user?.role === 'super_admin') {
      // Super-admin has no fixed lodge. Without a selection, every
      // tenant-scoped endpoint returns 400 ("X-Lodge-Id required") and
      // the Dashboard fails immediately. Auto-pick the first available
      // lodge so they land on a working screen; they can switch from the
      // header dropdown anytime.
      try {
        const list = await lodgesAPI.list()
        const first = (list.data || []).find(l => l.is_active) || (list.data || [])[0]
        if (first) {
          localStorage.setItem('lms_selected_lodge_id', String(first.lodge_id))
          setSelectedLodgeIdState(first.lodge_id)
        }
      } catch {
        // Non-fatal — they'll see the dropdown empty state and can pick manually.
      }
    } else if (res.data.user?.lodge_id) {
      // Regular admin / staff: their lodge is whatever the server returned.
      localStorage.setItem('lms_selected_lodge_id', String(res.data.user.lodge_id))
      setSelectedLodgeIdState(res.data.user.lodge_id)
    }
    // Now set the user — this triggers the Login page's <Navigate> and the
    // dashboard mounts with a valid lodge scope already in localStorage.
    setUser(res.data.user)
    return res.data
  }

  const logout = () => {
    authAPI.logout().catch(() => {})
    localStorage.removeItem('lms_token')
    localStorage.removeItem('lms_user')
    localStorage.removeItem('lms_selected_lodge_id')
    setUser(null)
    setSelectedLodgeIdState(null)
    toast.info('Logged out successfully')
  }

  /** Super-admin only: switch the active lodge. */
  const setSelectedLodgeId = (lodgeId) => {
    setSelectedLodgeIdState(lodgeId)
    if (lodgeId) localStorage.setItem('lms_selected_lodge_id', String(lodgeId))
    else localStorage.removeItem('lms_selected_lodge_id')
  }

  // `admin` covers tenant admins; super_admin shouldn't be treated as a
  // tenant admin (their UX needs the lodge switcher), so we check role
  // explicitly where it matters and use both flags below.
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const isSuperAdmin = user?.role === 'super_admin'

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading,
      isAdmin, isSuperAdmin,
      selectedLodgeId, setSelectedLodgeId,
      // Convenience: the effective lodge id to display in the header.
      // For tenant users it's their fixed lodge; for super_admin it's
      // whatever they last picked (or null if they haven't picked one).
      effectiveLodgeId: user?.role === 'super_admin' ? selectedLodgeId : user?.lodge_id,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
