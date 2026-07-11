import React, { lazy, Suspense } from 'react'
import { injectPmsTheme, removePmsTheme } from './utils/pmsThemeInjector'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

// Contexts / layouts / shells stay statically imported — they're needed on
// every render path and are small. Pages are lazy-loaded (route-level code
// splitting) so the initial bundle doesn't ship all ~70 pages at once.
import { AuthProvider, useAuth } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import Layout from './components/Layout/Layout'
import PWAPrompts from './components/PWAPrompts'
import { CustomerAuthProvider } from './context/CustomerAuthContext'
import { ModuleGateProvider } from './context/ModuleGateContext'
import RustoLayout from './components/RustoLayout/RustoLayout'
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary'
import { PortalProvider, usePortal } from './context/PortalContext'

// ── Lazy-loaded pages (route-level code splitting) ─────────────────────────
const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Rooms = lazy(() => import('./pages/Rooms'))
const Customers = lazy(() => import('./pages/Customers'))
const Checkins = lazy(() => import('./pages/Checkins'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Reports = lazy(() => import('./pages/Reports'))
const Import = lazy(() => import('./pages/Import'))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings'))
const Bookings = lazy(() => import('./pages/Bookings'))
const Agencies = lazy(() => import('./pages/Agencies'))
const Lodges = lazy(() => import('./pages/Lodges'))
const Housekeeping = lazy(() => import('./pages/Housekeeping'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Shifts = lazy(() => import('./pages/Shifts'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const Inventory = lazy(() => import('./pages/Inventory'))
const RatePlans = lazy(() => import('./pages/RatePlans'))
const Feedback = lazy(() => import('./pages/Feedback'))
const FeedbackSubmit = lazy(() => import('./pages/FeedbackSubmit'))
const Promos = lazy(() => import('./pages/Promos'))
const Loyalty = lazy(() => import('./pages/Loyalty'))
const ForeignGuests = lazy(() => import('./pages/ForeignGuests'))
const Campaigns = lazy(() => import('./pages/Campaigns'))
const Backup = lazy(() => import('./pages/Backup'))
const Security = lazy(() => import('./pages/Security'))
const TapeChart = lazy(() => import('./pages/TapeChart'))
const NightAudit = lazy(() => import('./pages/NightAudit'))
const PublicBooking = lazy(() => import('./pages/PublicBooking'))
const GroupBookings = lazy(() => import('./pages/GroupBookings'))
const OtaReservations = lazy(() => import('./pages/OtaReservations'))
const Emails = lazy(() => import('./pages/Emails'))
const RegisterLodge = lazy(() => import('./pages/RegisterLodge'))
const Registrations = lazy(() => import('./pages/Registrations'))
const Support = lazy(() => import('./pages/Support'))
const StaffManagement = lazy(() => import('./pages/StaffManagement'))
const StaffModuleAssignment = lazy(() => import('./pages/StaffModuleAssignment'))
const PlanModules = lazy(() => import('./pages/PlanModules'))
const RustoHome = lazy(() => import('./pages/rusto/RustoHome'))
const RustoSearch = lazy(() => import('./pages/rusto/RustoSearch'))
const RustoLodgeDetail = lazy(() => import('./pages/rusto/RustoLodgeDetail'))
// RustoAuth / RustoLegal use named exports — remap to default for React.lazy.
const RustoLogin = lazy(() => import('./pages/rusto/RustoAuth').then(m => ({ default: m.RustoLogin })))
const RustoSignup = lazy(() => import('./pages/rusto/RustoAuth').then(m => ({ default: m.RustoSignup })))
const RustoCheckout = lazy(() => import('./pages/rusto/RustoCheckout'))
const RustoAccount = lazy(() => import('./pages/rusto/RustoAccount'))
const RustoListingAdmin = lazy(() => import('./pages/RustoListingAdmin'))
const RustoReviewsAdmin = lazy(() => import('./pages/RustoReviewsAdmin'))
const WhatsAppAdmin = lazy(() => import('./pages/WhatsAppAdmin'))
const Billing = lazy(() => import('./pages/Billing'))
const BillingAdmin = lazy(() => import('./pages/BillingAdmin'))
const LodgeAnalytics = lazy(() => import('./pages/LodgeAnalytics'))
const PlatformAnalytics = lazy(() => import('./pages/PlatformAnalytics'))
const GlobalApiKeys = lazy(() => import('./pages/GlobalApiKeys'))
const RustoMembership = lazy(() => import('./pages/rusto/RustoMembership'))
const RustoTerms = lazy(() => import('./pages/rusto/RustoLegal').then(m => ({ default: m.RustoTerms })))
const RustoPrivacy = lazy(() => import('./pages/rusto/RustoLegal').then(m => ({ default: m.RustoPrivacy })))
const RustoAbout = lazy(() => import('./pages/rusto/RustoAbout'))
const RustoSelfCheckin = lazy(() => import('./pages/rusto/RustoSelfCheckin'))
const LocalBundlesAdmin = lazy(() => import('./pages/LocalBundlesAdmin'))
const RustoWishlist = lazy(() => import('./pages/rusto/RustoWishlist'))
const AuditConsole = lazy(() => import('./pages/AuditConsole'))
const IpPresence = lazy(() => import('./pages/IpPresence'))

// ── Protected route wrapper ────────────────────────────────────────────────
function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoader />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !['admin','super_admin','app_owner','lodge_owner'].includes(user.role))
    return <Navigate to="/dashboard" replace />
  if (superAdminOnly && !['super_admin','app_owner'].includes(user.role))
    return <Navigate to="/dashboard" replace />
  return children
}

// ── Full-screen loader (used while auth + portal are resolving) ────────────
function AppLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#07131C',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid #E8A020', borderTopColor: 'transparent',
          borderRadius: '50%', margin: '0 auto 10px',
          animation: 'spin 0.7s linear infinite',
        }}/>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontFamily: 'sans-serif' }}>
          {label}
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── PMS-only route tree (shown on lodge networks) ──────────────────────────
// ALL customer routes are completely removed.
// Staff on the lodge network only see login → dashboard → PMS pages.
function PmsRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      {/* Every URL → login when not authenticated */}
      <Route path="/login"   element={user ? <Navigate to="/dashboard" replace/> : <Login />} />
      <Route path="/dashboard" element={<ProtectedRoute><Layout/></ProtectedRoute>}>
      </Route>

      {/* All PMS operational routes */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard"             element={<Dashboard />} />
        <Route path="/rooms"                 element={<Rooms />} />
        <Route path="/customers"             element={<Customers />} />
        <Route path="/checkins"              element={<Checkins />} />
        <Route path="/bookings"              element={<Bookings />} />
        <Route path="/tape-chart"            element={<TapeChart />} />
        <Route path="/night-audit"           element={<NightAudit />} />
        <Route path="/group-bookings"        element={<GroupBookings />} />
        <Route path="/ota-reservations"      element={<OtaReservations />} />
        <Route path="/agencies"              element={<Agencies />} />
        <Route path="/rate-plans"            element={<RatePlans />} />
        <Route path="/housekeeping"          element={<Housekeeping />} />
        <Route path="/expenses"              element={<Expenses />} />
        <Route path="/shifts"                element={<Shifts />} />
        <Route path="/maintenance"           element={<Maintenance />} />
        <Route path="/inventory"             element={<Inventory />} />
        <Route path="/feedback"              element={<Feedback />} />
        <Route path="/promos"                element={<Promos />} />
        <Route path="/loyalty"               element={<Loyalty />} />
        <Route path="/foreign-guests"        element={<ForeignGuests />} />
        <Route path="/campaigns"             element={<Campaigns />} />
        <Route path="/reports"               element={<Reports />} />
        <Route path="/alerts"                element={<Alerts />} />
        <Route path="/emails"                element={<Emails />} />
        <Route path="/whatsapp"              element={<WhatsAppAdmin />} />
        <Route path="/support"               element={<Support />} />
        <Route path="/rusto-listing"         element={<RustoListingAdmin />} />
        <Route path="/rusto-reviews"         element={<RustoReviewsAdmin />} />
        <Route path="/local-bundles"         element={<LocalBundlesAdmin />} />
        <Route path="/analytics"             element={<LodgeAnalytics />} />
        <Route path="/billing"               element={<Billing />} />
        <Route path="/staff"                 element={<StaffManagement />} />
        <Route path="/staff/modules"         element={<StaffModuleAssignment />} />
        <Route path="/staff-modules"         element={<StaffModuleAssignment />} />
        <Route path="/plan-modules"          element={<PlanModules />} />
        <Route path="/users"                 element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        <Route path="/settings"              element={<ProtectedRoute adminOnly><Settings /></ProtectedRoute>} />
        <Route path="/audit-console"         element={<ProtectedRoute adminOnly><AuditConsole /></ProtectedRoute>} />
        <Route path="/ip-presence"           element={<ProtectedRoute adminOnly><IpPresence /></ProtectedRoute>} />
        <Route path="/security"              element={<Security />} />
        <Route path="/import"                element={<ProtectedRoute adminOnly><Import /></ProtectedRoute>} />
        <Route path="/backup"                element={<ProtectedRoute adminOnly><Backup /></ProtectedRoute>} />
        <Route path="/lodges"                element={<ProtectedRoute superAdminOnly><Lodges /></ProtectedRoute>} />
        <Route path="/registrations"         element={<ProtectedRoute superAdminOnly><Registrations /></ProtectedRoute>} />
        <Route path="/global-api-keys"       element={<ProtectedRoute superAdminOnly><GlobalApiKeys /></ProtectedRoute>} />
        <Route path="/billing-admin"         element={<ProtectedRoute superAdminOnly><BillingAdmin /></ProtectedRoute>} />
        <Route path="/platform-analytics"    element={<ProtectedRoute superAdminOnly><PlatformAnalytics /></ProtectedRoute>} />
      </Route>

      {/* Any unmatched URL → login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

// ── Full route tree (customer + PMS — default for non-lodge networks) ──────
function AllRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/feedback-submit/:token" element={<FeedbackSubmit />} />
      <Route path="/book/:lodge_code"       element={<PublicBooking />} />
      <Route path="/register-lodge"         element={<RegisterLodge />} />

      {/* Customer-facing site */}
      <Route element={<ErrorBoundary><RustoLayout /></ErrorBoundary>}>
        <Route path="/"                   element={user ? <Navigate to="/dashboard" replace/> : <RustoHome />} />
        <Route path="/search"             element={<RustoSearch />} />
        <Route path="/lodges/:code"       element={<RustoLodgeDetail />} />
        <Route path="/signin"             element={<RustoLogin />} />
        <Route path="/signup"             element={<RustoSignup />} />
        <Route path="/checkout/:bookingId" element={<RustoCheckout />} />
        <Route path="/account"            element={<RustoAccount />} />
        <Route path="/account/bookings"   element={<RustoAccount />} />
        <Route path="/wishlist"           element={<RustoWishlist />} />
        <Route path="/membership"         element={<RustoMembership />} />
        <Route path="/self-checkin"       element={<RustoSelfCheckin />} />
        <Route path="/self-checkin/:token" element={<RustoSelfCheckin />} />
        <Route path="/terms"              element={<RustoTerms />} />
        <Route path="/privacy"            element={<RustoPrivacy />} />
        <Route path="/about"              element={<RustoAbout />} />
      </Route>

      {/* PMS staff side */}
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
        <Route path="/audit-console"      element={<ProtectedRoute adminOnly><AuditConsole /></ProtectedRoute>} />
        <Route path="/ip-presence"        element={<ProtectedRoute adminOnly><IpPresence /></ProtectedRoute>} />
        <Route path="/security"           element={<Security />} />
        <Route path="/import"             element={<ProtectedRoute adminOnly><Import /></ProtectedRoute>} />
        <Route path="/backup"             element={<ProtectedRoute adminOnly><Backup /></ProtectedRoute>} />
        <Route path="/lodges"             element={<ProtectedRoute superAdminOnly><Lodges /></ProtectedRoute>} />
        <Route path="/registrations"      element={<ProtectedRoute superAdminOnly><Registrations /></ProtectedRoute>} />
        <Route path="/global-api-keys"    element={<ProtectedRoute superAdminOnly><GlobalApiKeys /></ProtectedRoute>} />
        <Route path="/billing-admin"      element={<ProtectedRoute superAdminOnly><BillingAdmin /></ProtectedRoute>} />
        <Route path="/platform-analytics" element={<ProtectedRoute superAdminOnly><PlatformAnalytics /></ProtectedRoute>} />
      </Route>
    </Routes>
  )
}

// ── Root component: chooses which route tree to render ────────────────────

// Injects warm theme when mounted, removes on unmount
function PmsPortalMount({ children }) {
  React.useEffect(() => {
    injectPmsTheme()
    return () => removePmsTheme()
  }, [])
  return <div className="pms-warm" style={{ minHeight: '100vh' }}>{children}</div>
}

function AppRoutes() {
  const { loading: authLoading } = useAuth()
  const { effectivePortal } = usePortal()

  // Show loader only while auth state is being restored from localStorage JWT.
  // portalLoading is always false (window.__PORTAL__ set synchronously in index.html).
  if (authLoading) {
    return <AppLoader />
  }

  // Lodge network detected → PMS-only routes, zero customer pages
  // .pms-warm applies the Warm Neutrals colour theme to the entire PMS
  if (effectivePortal === 'pms') {
    return (
      <PmsPortalMount>
        <PmsRoutes />
      </PmsPortalMount>
    )
  }

  // All other networks → full site (customer + PMS)
  return <AllRoutes />
}

// ── App shell ─────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <CustomerAuthProvider>
          <ModuleGateProvider>
            <SettingsProvider>
              <PortalProvider>
                {/* Suspense boundary for all lazy-loaded route pages */}
                <Suspense fallback={<AppLoader />}>
                  <AppRoutes />
                </Suspense>
                <ToastContainer
                  position="bottom-right"
                  autoClose={3000}
                  hideProgressBar={false}
                  newestOnTop
                  closeOnClick
                  pauseOnFocusLoss
                  draggable
                  pauseOnHover
                  theme="light"
                />
                <PWAPrompts />
              </PortalProvider>
            </SettingsProvider>
          </ModuleGateProvider>
        </CustomerAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
