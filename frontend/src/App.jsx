import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { AuthProvider, useAuth } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'

import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Rooms from './pages/Rooms'
import Customers from './pages/Customers'
import Checkins from './pages/Checkins'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import Import from './pages/Import'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Bookings from './pages/Bookings'
import Agencies from './pages/Agencies'
import Lodges from './pages/Lodges'
import Housekeeping from './pages/Housekeeping'
import Expenses from './pages/Expenses'
import Shifts from './pages/Shifts'
import Maintenance from './pages/Maintenance'
import Inventory from './pages/Inventory'
import RatePlans from './pages/RatePlans'
import Feedback from './pages/Feedback'
import FeedbackSubmit from './pages/FeedbackSubmit'
import Promos from './pages/Promos'
import Loyalty from './pages/Loyalty'
import ForeignGuests from './pages/ForeignGuests'
import Campaigns from './pages/Campaigns'
import Backup from './pages/Backup'
import Security from './pages/Security'
// v2.5 — industry-standard PMS gap-fills
import TapeChart from './pages/TapeChart'
import NightAudit from './pages/NightAudit'
import PublicBooking from './pages/PublicBooking'
import GroupBookings from './pages/GroupBookings'
import OtaReservations from './pages/OtaReservations'
// v2.6 — email infrastructure
import Emails from './pages/Emails'
// v3.0 Rusto — marketplace + support
import RegisterLodge from './pages/RegisterLodge'
import Registrations from './pages/Registrations'
import Support from './pages/Support'
// v3.2 — staff management with granular permissions
import StaffManagement from './pages/StaffManagement'
// v4.0 — PWA install + update prompts
import PWAPrompts from './components/PWAPrompts'
// v3.1 Rusto — customer-facing site
import { CustomerAuthProvider } from './context/CustomerAuthContext'
import RustoLayout from './components/RustoLayout/RustoLayout'
import RustoHome from './pages/rusto/RustoHome'
import RustoSearch from './pages/rusto/RustoSearch'
import RustoLodgeDetail from './pages/rusto/RustoLodgeDetail'
import { RustoLogin, RustoSignup } from './pages/rusto/RustoAuth'
import RustoCheckout from './pages/rusto/RustoCheckout'
import RustoAccount from './pages/rusto/RustoAccount'
import RustoListingAdmin from './pages/RustoListingAdmin'
// v6.0 — lodge-side review management
import RustoReviewsAdmin from './pages/RustoReviewsAdmin'
// v7.0 — WhatsApp admin (config + message log)
import WhatsAppAdmin from './pages/WhatsAppAdmin'
// v8.0 — Lodge billing (subscription + invoices)
import Billing from './pages/Billing'
// v8.1 — Super-admin billing dashboard (cross-tenant MRR + churn)
import BillingAdmin from './pages/BillingAdmin'
// v8.4 — Per-lodge operational analytics dashboard
import LodgeAnalytics from './pages/LodgeAnalytics'
// v9.0 — enhanced RUSTO marketplace
import PlatformAnalytics from './pages/PlatformAnalytics'
import LocalBundlesAdmin from './pages/LocalBundlesAdmin'
import RustoWishlist from './pages/rusto/RustoWishlist'

function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-ink-50">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-navy border-t-gold rounded-full animate-spin mx-auto mb-4"/>
        <p className="text-navy font-display text-lg">Loading...</p>
      </div>
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  // Admin-only routes are accessible to both tenant admins AND super_admins.
  // The previous literal `user.role !== 'admin'` check locked super_admin
  // out of Agencies/Users/Settings — fixed below.
  if (adminOnly && user.role !== 'admin' && user.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }
  // super_admin-only routes (Lodges admin page) are inaccessible to
  // tenant admins — they have no reason to manage other lodges.
  if (superAdminOnly && user.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      {/* Public guest-feedback submission — no auth, no Layout chrome. */}
      <Route path="/feedback-submit/:token" element={<FeedbackSubmit />} />
      {/* Public direct-booking engine — no auth, no Layout chrome. */}
      <Route path="/book/:lodge_code" element={<PublicBooking />} />
      {/* v3.0 Rusto — public lodge registration (no auth, no Layout) */}
      <Route path="/register-lodge" element={<RegisterLodge />} />

      {/* ── v3.1 RUSTO CUSTOMER-FACING SITE ───────────────────────
          All wrapped in RustoLayout (consumer-friendly chrome).
          Lives at root paths since staff users land on /dashboard
          via the redirect inside the Route element below. */}
      <Route element={<RustoLayout/>}>
        <Route path="/" element={user ? <Navigate to="/dashboard" replace/> : <RustoHome/>}/>
        <Route path="/search" element={<RustoSearch/>}/>
        <Route path="/lodges/:code" element={<RustoLodgeDetail/>}/>
        <Route path="/signin" element={<RustoLogin/>}/>
        <Route path="/signup" element={<RustoSignup/>}/>
        <Route path="/checkout/:bookingId" element={<RustoCheckout/>}/>
        <Route path="/account" element={<RustoAccount/>}/>
        <Route path="/account/bookings" element={<RustoAccount/>}/>
        <Route path="/wishlist" element={<RustoWishlist/>}/>
      </Route>

      {/* ── STAFF SIDE (existing) ─────────────────────────────────── */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/checkins" element={<Checkins />} />
        <Route path="/bookings" element={<Bookings />} />
        {/* v2.5 — tape chart, night audit, groups, OTA */}
        <Route path="/tape-chart" element={<TapeChart />} />
        <Route path="/night-audit" element={<NightAudit />} />
        <Route path="/group-bookings" element={<ProtectedRoute adminOnly><GroupBookings /></ProtectedRoute>} />
        <Route path="/ota" element={<ProtectedRoute adminOnly><OtaReservations /></ProtectedRoute>} />
        {/* v2.6 — email automation */}
        <Route path="/emails" element={<ProtectedRoute adminOnly><Emails /></ProtectedRoute>} />
        {/* v3.0 Rusto — registrations queue (super_admin) + support (any user) */}
        <Route path="/registrations" element={<ProtectedRoute superAdminOnly><Registrations /></ProtectedRoute>} />
        <Route path="/support" element={<Support />} />
        {/* v3.1 Rusto — lodge-admin manages public listing */}
        <Route path="/rusto-listing" element={<ProtectedRoute adminOnly><RustoListingAdmin /></ProtectedRoute>} />
        <Route path="/rusto-reviews" element={<ProtectedRoute adminOnly><RustoReviewsAdmin /></ProtectedRoute>} />
        <Route path="/whatsapp" element={<ProtectedRoute adminOnly><WhatsAppAdmin /></ProtectedRoute>} />
        <Route path="/billing" element={<ProtectedRoute adminOnly><Billing /></ProtectedRoute>} />
        <Route path="/billing-admin" element={<ProtectedRoute superAdminOnly><BillingAdmin /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute adminOnly><LodgeAnalytics /></ProtectedRoute>} />
        <Route path="/platform-analytics" element={<ProtectedRoute superAdminOnly><PlatformAnalytics /></ProtectedRoute>} />
        <Route path="/local-bundles" element={<ProtectedRoute adminOnly><LocalBundlesAdmin /></ProtectedRoute>} />
        <Route path="/agencies" element={<ProtectedRoute adminOnly><Agencies /></ProtectedRoute>} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/import" element={<Import />} />
        <Route path="/users" element={<ProtectedRoute adminOnly><Users /></ProtectedRoute>} />
        {/* v3.2 — lodge admin manages their team with permissions */}
        <Route path="/staff" element={<ProtectedRoute adminOnly><StaffManagement /></ProtectedRoute>} />
        <Route path="/lodges" element={<ProtectedRoute superAdminOnly><Lodges /></ProtectedRoute>} />
        <Route path="/housekeeping" element={<Housekeeping />} />
        <Route path="/expenses" element={<ProtectedRoute adminOnly><Expenses /></ProtectedRoute>} />
        <Route path="/shifts" element={<Shifts />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/inventory" element={<ProtectedRoute adminOnly><Inventory /></ProtectedRoute>} />
        <Route path="/rate-plans" element={<ProtectedRoute adminOnly><RatePlans /></ProtectedRoute>} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/promos" element={<ProtectedRoute adminOnly><Promos /></ProtectedRoute>} />
        <Route path="/loyalty" element={<Loyalty />} />
        <Route path="/foreign-guests" element={<ForeignGuests />} />
        <Route path="/campaigns" element={<ProtectedRoute adminOnly><Campaigns /></ProtectedRoute>} />
        <Route path="/backup" element={<ProtectedRoute superAdminOnly><Backup /></ProtectedRoute>} />
        <Route path="/security" element={<Security />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      {/* Unknown path → if staff user, dashboard. Otherwise customer home. */}
      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <CustomerAuthProvider>
          <SettingsProvider>
            <AppRoutes />
            <PWAPrompts />
            <ToastContainer
              position="bottom-right"
              autoClose={4000}
              hideProgressBar={false}
              newestOnTop
              closeOnClick
              pauseOnFocusLoss
              pauseOnHover
              theme="colored"
              limit={4}
            />
          </SettingsProvider>
        </CustomerAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
