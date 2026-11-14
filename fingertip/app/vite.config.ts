import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the FastAPI server runs on :8000.
export default defineConfig({
  plugins: [react()],
  // MediaPipe loads its WASM runtime with importScripts, which only classic workers allow.
  worker: { format: 'iife' },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/static-audio': 'http://localhost:8000',
    },
  },
})


