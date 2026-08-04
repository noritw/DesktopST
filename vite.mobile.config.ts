import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
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
    // ⚠️ **必須內嵌，不能給檔案路徑。**
    //
    // Vite 的 `css.postcss` 收字串時，那是「要去搜尋設定檔的**目錄**」而非設定檔本身。
    // 給了檔案路徑會靜靜地找不到 → 往上找 → 撿到專案根目錄的 `postcss.config.cjs`，
    // 也就是**桌面版那份**。結果是手機 UI 套到桌面 renderer 的 Tailwind 產物：
    // 手機才用到的 class（`z-40`、`max-h-[85dvh]`⋯⋯）通通沒生成。
    //
    // **完全沒有錯誤訊息**，畫面只是安靜地壞掉（sheet 沒有堆疊層級也沒有遮罩），
    // 而且從 DOM 與 computed style 看不出原因 —— 這是 2026-08-04 實際踩到的。
    postcss: {
      plugins: [tailwindcss({ config: resolve(__dirname, 'tailwind.mobile.config.ts') }), autoprefixer()]
    }
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
