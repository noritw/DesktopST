import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

/**
 * 手機 UI 的建置設定（B3 階段 1）。
 *
 * 輸出到 `out/mobile`，也就是 `capacitor.config.ts` 的 `webDir`。
 * **同一份輸出有兩個去處**（roadmap §4.5）：
 *
 *   1. APK：`npx cap sync` 把它包進去
 *   2. 網頁版：`mobileServer` 提供給掃 QR 的裝置（階段 7 才切換，
 *      在那之前 `assets/mobile.html` 繼續服役）
 *
 * 與 `electron.vite.config.ts` 完全分離：桌面版的建置與產物不受這裡影響。
 */
export default defineConfig({
  root: resolve(__dirname, 'src/mobile/ui'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@mobile': resolve(__dirname, 'src/mobile')
    }
  },
  plugins: [react()],
  css: {
    postcss: './postcss.mobile.config.cjs'
  },
  server: {
    // 讓同區網的真手機連得進來測 —— 手機 UI 在桌機瀏覽器模擬器上
    // 看起來對，在真機上仍可能因為安全區域與鍵盤行為而不同。
    host: true,
    port: 5180
  },
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    // 手機網路可能很慢，寧可多切幾個檔讓首屏快一點。
    target: 'es2020'
  }
})
