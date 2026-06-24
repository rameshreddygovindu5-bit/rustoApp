/**
 * PMS Entry Point — Lodge Management System
 *
 * This entry builds ONLY the lodge staff portal.
 * No customer-facing pages exist in this bundle.
 * Deploy on: pms.yourdomain.com  OR  localhost:3001
 *
 * To run:   npm run dev:pms
 * To build: npm run build:pms  → dist-pms/
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import AppPms from './AppPms.jsx'
import './index.css'
import './pms-theme.css'   // Warm Neutrals theme override

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppPms />
  </React.StrictMode>
)
