import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../../src/core'),
      '@shared': resolve(__dirname, '../../src/shared')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'www'),
    emptyOutDir: true,
    target: 'es2020'
  },
  server: {
    host: true,
    port: 5181
  }
})
