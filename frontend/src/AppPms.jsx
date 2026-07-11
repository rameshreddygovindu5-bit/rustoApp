/**
 * AppPms.jsx — Lodge PMS Application
 *
 * Clean, standalone PMS app.
 * No customer booking pages. No portal detection.
 * No IP checking. Just log in → manage your lodge.
 *
 * Deploy this at pms.yourdomain.com
 */
import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { AuthProvider, useAuth }     from './context/AuthContext'
import { SettingsProvider }           from './context/SettingsContext'
import { ModuleGateProvider }         from './context/ModuleGateContext'
import PWAPrompts                     from './components/PWAPrompts'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary'
import { PmsPortalProvider }          from './context/PmsPortalContext'
import { useEffect }                   from 'react'
import { injectPmsTheme, removePmsTheme } from './utils/pmsThemeInjector'

// Apply warm theme immediately at module load — no flash of wrong colours
// useEffect below handles cleanup on unmount
injectPmsTheme()
import Layout                         from './components/Layout/Layout'
import Login                          from './pages/Login'

// Route-level code splitting — pages load on demand so the login screen
// ships only a small entry chunk (mirrors App.jsx).
const Dashboard          = lazy(() => import('./pages/Dashboard'))
const Rooms              = lazy(() => import('./pages/Rooms'))
const Customers          = lazy(() => import('./pages/Customers'))
const Checkins           = lazy(() => import('./pages/Checkins'))
const Bookings           = lazy(() => import('./pages/Bookings'))
const Agencies           = lazy(() => import('./pages/Agencies'))
const RatePlans          = lazy(() => import('./pages/RatePlans'))
const Housekeeping       = lazy(() => import('./pages/Housekeeping'))
const Expenses           = lazy(() => import('./pages/Expenses'))
const Shifts             = lazy(() => import('./pages/Shifts'))
const Maintenance        = lazy(() => import('./pages/Maintenance'))
const Inventory          = lazy(() => import('./pages/Inventory'))
const Feedback           = lazy(() => import('./pages/Feedback'))
const FeedbackSubmit     = lazy(() => import('./pages/FeedbackSubmit'))
const Promos             = lazy(() => import('./pages/Promos'))
const Loyalty            = lazy(() => import('./pages/Loyalty'))
const ForeignGuests      = lazy(() => import('./pages/ForeignGuests'))
const Campaigns          = lazy(() => import('./pages/Campaigns'))
const Reports            = lazy(() => import('./pages/Reports'))
const Alerts             = lazy(() => import('./pages/Alerts'))
const Emails             = lazy(() => import('./pages/Emails'))
const WhatsAppAdmin      = lazy(() => import('./pages/WhatsAppAdmin'))
const Support            = lazy(() => import('./pages/Support'))
const RustoListingAdmin  = lazy(() => import('./pages/RustoListingAdmin'))
const RustoReviewsAdmin  = lazy(() => import('./pages/RustoReviewsAdmin'))
const LocalBundlesAdmin  = lazy(() => import('./pages/LocalBundlesAdmin'))
const LodgeAnalytics     = lazy(() => import('./pages/LodgeAnalytics'))
const Billing            = lazy(() => import('./pages/Billing'))
const StaffManagement    = lazy(() => import('./pages/StaffManagement'))
const StaffModuleAssignment = lazy(() => import('./pages/StaffModuleAssignment'))
const PlanModules        = lazy(() => import('./pages/PlanModules'))
const Users              = lazy(() => import('./pages/Users'))
const Settings           = lazy(() => import('./pages/Settings'))
const Security           = lazy(() => import('./pages/Security'))
const Import             = lazy(() => import('./pages/Import'))
const Backup             = lazy(() => import('./pages/Backup'))
const TapeChart          = lazy(() => import('./pages/TapeChart'))
const NightAudit         = lazy(() => import('./pages/NightAudit'))
const GroupBookings      = lazy(() => import('./pages/GroupBookings'))
const OtaReservations    = lazy(() => import('./pages/OtaReservations'))
const Lodges             = lazy(() => import('./pages/Lodges'))
const Registrations      = lazy(() => import('./pages/Registrations'))
const GlobalApiKeys      = lazy(() => import('./pages/GlobalApiKeys'))
const BillingAdmin       = lazy(() => import('./pages/BillingAdmin'))
const PlatformAnalytics  = lazy(() => import('./pages/PlatformAnalytics'))
const PublicBooking      = lazy(() => import('./pages/PublicBooking'))
const AuditConsole       = lazy(() => import('./pages/AuditConsole'))
const IpPresence         = lazy(() => import('./pages/IpPresence'))

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
    <Suspense fallback={<Loader />}>
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
        <Route path="/audit-console"      element={<ProtectedRoute adminOnly><AuditConsole /></ProtectedRoute>} />
        <Route path="/ip-presence"        element={<ProtectedRoute adminOnly><IpPresence /></ProtectedRoute>} />
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
    </Suspense>
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
    <ErrorBoundary>
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
    </ErrorBoundary>
    </div>
  )
}
