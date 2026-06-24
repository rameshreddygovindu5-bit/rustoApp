/**
 * AppCustomer.jsx — Rusto Guest Booking Portal
 *
 * Clean, standalone customer booking app.
 * No PMS pages. No staff login. Guests search, book, manage their stays.
 *
 * Deploy this at book.yourdomain.com  OR  rusto.in
 */
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

import { CustomerAuthProvider }  from './context/CustomerAuthContext'
import ErrorBoundary             from './components/ErrorBoundary/ErrorBoundary'
import RustoLayout               from './components/RustoLayout/RustoLayout'
import PWAPrompts                from './components/PWAPrompts'

import RustoHome        from './pages/rusto/RustoHome'
import RustoSearch      from './pages/rusto/RustoSearch'
import RustoLodgeDetail from './pages/rusto/RustoLodgeDetail'
import { RustoLogin, RustoSignup } from './pages/rusto/RustoAuth'
import RustoCheckout    from './pages/rusto/RustoCheckout'
import RustoAccount     from './pages/rusto/RustoAccount'
import RustoWishlist    from './pages/rusto/RustoWishlist'
import RustoMembership  from './pages/rusto/RustoMembership'
import RustoSelfCheckin from './pages/rusto/RustoSelfCheckin'
import RustoAbout       from './pages/rusto/RustoAbout'
import { RustoTerms, RustoPrivacy } from './pages/rusto/RustoLegal'
import RegisterLodge    from './pages/RegisterLodge'
import PublicBooking    from './pages/PublicBooking'
import FeedbackSubmit   from './pages/FeedbackSubmit'

function CustomerRoutes() {
  return (
    <Routes>
      {/* Utility pages (no layout) */}
      <Route path="/feedback-submit/:token"  element={<FeedbackSubmit />} />
      <Route path="/book/:lodge_code"         element={<PublicBooking />} />
      <Route path="/register-lodge"           element={<RegisterLodge />} />
      <Route path="/self-checkin"             element={<RustoSelfCheckin />} />
      <Route path="/self-checkin/:token"      element={<RustoSelfCheckin />} />

      {/* Main customer site — all inside Rusto layout (nav + footer) */}
      <Route element={<ErrorBoundary><RustoLayout /></ErrorBoundary>}>
        <Route path="/"                     element={<RustoHome />} />
        <Route path="/search"               element={<RustoSearch />} />
        <Route path="/lodges/:code"         element={<RustoLodgeDetail />} />
        <Route path="/signin"               element={<RustoLogin />} />
        <Route path="/signup"               element={<RustoSignup />} />
        <Route path="/checkout/:bookingId"  element={<RustoCheckout />} />
        <Route path="/account"              element={<RustoAccount />} />
        <Route path="/account/bookings"     element={<RustoAccount />} />
        <Route path="/wishlist"             element={<RustoWishlist />} />
        <Route path="/membership"           element={<RustoMembership />} />
        <Route path="/about"                element={<RustoAbout />} />
        <Route path="/terms"                element={<RustoTerms />} />
        <Route path="/privacy"              element={<RustoPrivacy />} />
      </Route>

      {/* Unknown URL → home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function AppCustomer() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CustomerAuthProvider>
        <CustomerRoutes />
        <ToastContainer position="bottom-right" autoClose={3000}
          hideProgressBar={false} newestOnTop closeOnClick
          pauseOnHover draggable theme="light" />
        <PWAPrompts />
      </CustomerAuthProvider>
    </BrowserRouter>
  )
}
