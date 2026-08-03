import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        // 前端直接吃 core/（純 TS、零 Node 依賴），避免邏輯在 renderer 重寫一份。
        // 手機 UI（B3）會走同一個 alias。
        '@core': resolve('src/core')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.cjs'
    },
    publicDir: resolve('src/renderer/public')
  }
})
