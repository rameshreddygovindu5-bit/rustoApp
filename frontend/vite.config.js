import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://13.207.0.235',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://13.207.0.235',
        changeOrigin: true,
      }
    }
  }
})
