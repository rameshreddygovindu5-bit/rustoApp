/**
 * AppPms.jsx — Lodge PMS Application
 *
 * Clean, standalone PMS app.
 * No customer booking pages. No portal detection.
 * No IP checking. Just log in → manage your lodge.
 *
 * Deploy this at pms.yourdomain.com
 */
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { AuthProvider, useAuth }     from './context/AuthContext'
import { SettingsProvider }           from './context/SettingsContext'
import { ModuleGateProvider }         from './context/ModuleGateContext'
import PWAPrompts                     from './components/PWAPrompts'
import { PmsPortalProvider }          from './context/PmsPortalContext'
import { useEffect }                   from 'react'
import { injectPmsTheme, removePmsTheme } from './utils/pmsThemeInjector'

// Apply warm theme immediately at module load — no flash of wrong colours
// useEffect below handles cleanup on unmount
injectPmsTheme()
import Layout                         from './components/Layout/Layout'
import Login                          from './pages/Login'

import Dashboard          from './pages/Dashboard'
import Rooms              from './pages/Rooms'
import Customers          from './pages/Customers'
import Checkins           from './pages/Checkins'
import Bookings           from './pages/Bookings'
import Agencies           from './pages/Agencies'
import RatePlans          from './pages/RatePlans'
import Housekeeping       from './pages/Housekeeping'
import Expenses           from './pages/Expenses'
import Shifts             from './pages/Shifts'
import Maintenance        from './pages/Maintenance'
import Inventory          from './pages/Inventory'
import Feedback           from './pages/Feedback'
import FeedbackSubmit     from './pages/FeedbackSubmit'
import Promos             from './pages/Promos'
import Loyalty            from './pages/Loyalty'
import ForeignGuests      from './pages/ForeignGuests'
import Campaigns          from './pages/Campaigns'
import Reports            from './pages/Reports'
import Alerts             from './pages/Alerts'
import Emails             from './pages/Emails'
import WhatsAppAdmin      from './pages/WhatsAppAdmin'
import Support            from './pages/Support'
import RustoListingAdmin  from './pages/RustoListingAdmin'
import RustoReviewsAdmin  from './pages/RustoReviewsAdmin'
import LocalBundlesAdmin  from './pages/LocalBundlesAdmin'
import LodgeAnalytics     from './pages/LodgeAnalytics'
import Billing            from './pages/Billing'
import StaffManagement    from './pages/StaffManagement'
import StaffModuleAssignment from './pages/StaffModuleAssignment'
import PlanModules        from './pages/PlanModules'
import Users              from './pages/Users'
import Settings           from './pages/Settings'
import Security           from './pages/Security'
import Import             from './pages/Import'
import Backup             from './pages/Backup'
import TapeChart          from './pages/TapeChart'
import NightAudit         from './pages/NightAudit'
import GroupBookings      from './pages/GroupBookings'
import OtaReservations    from './pages/OtaReservations'
import Lodges             from './pages/Lodges'
import Registrations      from './pages/Registrations'
import GlobalApiKeys      from './pages/GlobalApiKeys'
import BillingAdmin       from './pages/BillingAdmin'
import PlatformAnalytics  from './pages/PlatformAnalytics'
import PublicBooking      from './pages/PublicBooking'

// ── Guards ────────────────────────────────────────────────────────────────
function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { user, loading } = useAuth()
  if (loading) return <Loader />
  if (!user)   return <Navigate to="/login" replace />
  if (adminOnly && !['admin','super_admin','app_owner','lodge_owner'].includes(user.role))
    return <Navigate to="/dashboard" replace />
  if (superAdminOnly && !['super_admin','app_owner'].includes(user.role))
    return <Navigate to="/dashboard" replace />
  return children
}

function Loader() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center',
                  justifyContent:'center', background:'#F2EDE4' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ width:40, height:40,
                      border:'2px solid #C9AE8A',
                      borderTopColor:'#8C6E54',
                      borderRadius:'50%',
                      margin:'0 auto 14px',
                      animation:'spin .8s cubic-bezier(.6,.1,.4,.9) infinite' }}/>
        <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif",
                    fontSize:18, fontWeight:500, color:'#3A2718',
                    letterSpacing:'0.04em' }}>Rusto PMS</p>
        <p style={{ fontFamily:"'Jost',sans-serif", fontSize:9,
                    fontWeight:500, letterSpacing:'0.25em',
                    textTransform:'uppercase', color:'#8C6E54',
                    marginTop:4 }}>Loading…</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Route tree ────────────────────────────────────────────────────────────
function PmsRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      {/* Auth */}
      <Route path="/login"  element={user ? <Navigate to="/dashboard" replace/> : <Login />} />

      {/* Public utility pages */}
      <Route path="/feedback-submit/:token" element={<FeedbackSubmit />} />
      <Route path="/book/:lodge_code"       element={<PublicBooking />} />

      {/* PMS — all protected */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard"          element={<Dashboard />} />
        <Route path="/rooms"              element={<Rooms />} />
        <Route path="/customers"          element={<Customers />} />
        <Route path="/checkins"           element={<Checkins />} />
        <Route path="/bookings"           element={<Bookings />} />
        <Route path="/tape-chart"         element={<TapeChart />} />
        <Route path="/night-audit"        element={<NightAudit />} />
        <Route path="/group-bookings"     element={<GroupBookings />} />
        <Route path="/ota-reservations"   element={<OtaReservations />} />
        <Route path="/agencies"           element={<Agencies />} />
        <Route path="/rate-plans"         element={<RatePlans />} />
        <Route path="/housekeeping"       element={<Housekeeping />} />
        <Route path="/expenses"           element={<Expenses />} />
        <Route path="/shifts"             element={<Shifts />} />
        <Route path="/maintenance"        element={<Maintenance />} />
        <Route path="/inventory"          element={<Inventory />} />
        <Route path="/feedback"           element={<Feedback />} />
        <Route path="/promos"             element={<Promos />} />
        <Route path="/loyalty"            element={<Loyalty />} />
        <Route path="/foreign-guests"     element={<ForeignGuests />} />
        <Route path="/campaigns"          element={<Campaigns />} />
        <Route path="/reports"            element={<Reports />} />
        <Route path="/alerts"             element={<Alerts />} />
        <Route path="/emails"             element={<Emails />} />
        <Route path="/whatsapp"           element={<WhatsAppAdmin />} />
        <Route path="/support"            element={<Support />} />
        <Route path="/rusto-listing"      element={<RustoListingAdmin />} />
        <Route path="/rusto-reviews"      element={<RustoReviewsAdmin />} />
        <Route path="/local-bundles"      element={<LocalBundlesAdmin />} />
        <Route path="/analytics"          element={<LodgeAnalytics />} />
        <Route path="/billing"            element={<Billing />} />
        <Route path="/staff"              element={<StaffManagement />} />
        <Route path="/staff/modules"      element={<StaffModuleAssignment />} />
        <Route path="/staff-modules"      element={<StaffModuleAssignment />} />
        <Route path="/plan-modules"       element={<PlanModules />} />
        <Route path="/users"              element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="/settings"           element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
        <Route path="/security"           element={<Security />} />
        <Route path="/import"             element={<ProtectedRoute adminOnly><Import /></ProtectedRoute>} />
        <Route path="/backup"             element={<ProtectedRoute adminOnly><Backup /></ProtectedRoute>} />
        {/* Super-admin */}
        <Route path="/lodges"             element={<ProtectedRoute superAdminOnly><Lodges /></ProtectedRoute>} />
        <Route path="/registrations"      element={<ProtectedRoute superAdminOnly><Registrations /></ProtectedRoute>} />
        <Route path="/global-api-keys"    element={<ProtectedRoute superAdminOnly><GlobalApiKeys /></ProtectedRoute>} />
        <Route path="/billing-admin"      element={<ProtectedRoute superAdminOnly><BillingAdmin /></ProtectedRoute>} />
        <Route path="/platform-analytics" element={<ProtectedRoute superAdminOnly><PlatformAnalytics /></ProtectedRoute>} />
      </Route>

      {/* Root and unknown → login */}
      <Route path="/"  element={<Navigate to="/login" replace />} />
      <Route path="*"  element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

// ── App ───────────────────────────────────────────────────────────────────
export default function AppPms() {
  // Inject Warm Neutrals theme — uses shared utility for consistency
  useEffect(() => {
    injectPmsTheme()
    return () => removePmsTheme()
  }, [])

  return (
    <div className="pms-warm" style={{ minHeight: '100vh' }}>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PmsPortalProvider>
      <AuthProvider>
        <ModuleGateProvider>
          <SettingsProvider>
            <PmsRoutes />
            <ToastContainer position="bottom-right" autoClose={3000}
              hideProgressBar={false} newestOnTop closeOnClick
              pauseOnHover draggable theme="light" />
            <PWAPrompts />
          </SettingsProvider>
        </ModuleGateProvider>
      </AuthProvider>
      </PmsPortalProvider>
    </BrowserRouter>
    </div>
  )
}
