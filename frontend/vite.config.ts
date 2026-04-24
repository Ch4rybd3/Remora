import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/note-images': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/knowledge-assets': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
