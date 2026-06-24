import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite config for Rusto LMS.
 *
 * Portal detection (/api/public/detect-portal) is called DIRECTLY from the
 * browser to the backend (http://<hostname>:8000) — not through this proxy.
 * This ensures the backend sees the real browser IP, not 127.0.0.1.
 *
 * All other /api/* calls go through this proxy (authenticated endpoints).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
