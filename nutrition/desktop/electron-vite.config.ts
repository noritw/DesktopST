import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@core': resolve(__dirname, '../../src/core')
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/main'),
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: resolve(__dirname, 'out/preload'),
      rollupOptions: { input: resolve(__dirname, 'src/main/preload.ts') }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@core': resolve(__dirname, '../../src/core'),
        '@shared': resolve(__dirname, '../../src/shared')
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
    },
    css: { postcss: { plugins: [] } },
    plugins: [react()]
  }
})
