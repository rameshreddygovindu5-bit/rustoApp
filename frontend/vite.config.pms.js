/**
 * Vite config — PMS (Lodge Management) build
 *
 * Entry:  index-pms.html  →  main-pms.jsx  →  AppPms.jsx
 * Output: dist-pms/
 * Dev:    http://localhost:3001
 *
 * All /api/* calls proxy to the backend (port 8000).
 * No portal detection needed — this IS the PMS.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // Use the PMS-specific HTML as entry
  root: '.',
  base: '/pms/',
  build: {
    outDir: 'dist-pms',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index-pms.html',
    },
  },

  server: {
    port: 3001,
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
    port: 4001,
  },
})
