import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../backend/MonitoringApi/wwwroot',
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['face-api.js', '@microsoft/signalr'],
  },
})
