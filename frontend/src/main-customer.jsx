/**
 * Customer Entry Point — Rusto Booking Portal
 *
 * This entry builds ONLY the guest-facing booking site.
 * No PMS pages exist in this bundle.
 * Deploy on: book.yourdomain.com  OR  localhost:3002
 *
 * To run:   npm run dev:customer
 * To build: npm run build:customer  → dist-customer/
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import AppCustomer from './AppCustomer.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppCustomer />
  </React.StrictMode>
)
