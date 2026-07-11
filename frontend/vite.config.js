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
// Split heavyweight vendor libraries into their own long-cacheable chunks so
// the app chunk stays small and vendor code isn't re-downloaded on every deploy.
export function vendorChunks(id) {
  if (!id.includes('node_modules')) return undefined
  // recharts + its d3/victory dependency graph
  if (id.includes('node_modules/recharts') ||
      id.includes('node_modules/d3-') ||
      id.includes('node_modules/victory-vendor') ||
      id.includes('node_modules/internmap')) return 'vendor-charts'
  if (id.includes('node_modules/lucide-react')) return 'vendor-icons'
  // react-router first (more specific prefix), then react / react-dom / scheduler
  if (id.includes('node_modules/react-router')) return 'vendor-react'
  if (id.includes('node_modules/react/') ||
      id.includes('node_modules/react-dom/') ||
      id.includes('node_modules/scheduler/')) return 'vendor-react'
  return undefined
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunks,
      },
    },
  },
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
