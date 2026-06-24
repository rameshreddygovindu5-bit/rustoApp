/**
 * Vite config — Customer Booking Portal build
 *
 * Entry:  index-customer.html  →  main-customer.jsx  →  AppCustomer.jsx
 * Output: dist-customer/
 * Dev:    http://localhost:3002
 *
 * All /api/* calls proxy to the backend (port 8000).
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  root: '.',
  build: {
    outDir: 'dist-customer',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index-customer.html',
    },
  },

  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },

  preview: {
    port: 4002,
  },
})
