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
        '@core': resolve('src/core'),
        // 與手機共用的純呈現元件（目前是 MonoIcon）。見 src/shared/MonoIcon.tsx 檔頭。
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.cjs'
    },
    publicDir: resolve('src/renderer/public')
  }
})
