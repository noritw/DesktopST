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
 *   2. 網頁版：`mobileServer` 的 `/` 提供給掃 QR 的裝置（單一入口；
 *      舊 `assets/mobile.html` 已於 B6 真機驗證後移除）
 *
 * 與 `electron.vite.config.ts` 完全分離：桌面版的建置與產物不受這裡影響。
 */
export default defineConfig({
  root: resolve(__dirname, 'src/mobile/ui'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@mobile': resolve(__dirname, 'src/mobile'),
      // 與桌面共用的純呈現元件（目前是 MonoIcon）。見 src/shared/MonoIcon.tsx 檔頭。
      '@shared': resolve(__dirname, 'src/shared')
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
    target: 'es2020',
    /*
     * ⚠️ **產物必須收斂成「單一自足的 index.html」**（2026-08-06 實機打臉後改）。
     *
     * relay（`relay.nori.tw` 的 Cloudflare Worker）是反向代理，
     * 而且**每一個請求都要求「`/<deviceId>` 路徑 ＋ `?token=`」**。
     * 它注入的相容層只 patch 了 `window.fetch`，
     * 但 `<script src>` / `<link href>` 這類子資源是**瀏覽器原生載入、完全繞過 fetch**，
     * 既不會被補上 deviceId 也不會帶 token —— 實測 relay 直接回 503／401，
     * 結果就是「掃新版 QR 一片全白」。
     *
     * `assets/mobile.html` 之所以一直沒事，正是因為它是單一檔案、沒有任何子資源。
     * 我們沒辦法改那個外部 Worker，所以只能讓產物也不需要子資源。
     *
     * 下面三個設定把 JS／CSS／圖片都逼進同一個檔案，
     * 再由 `scripts/inline-mobile-build.mjs` 把剩下的 `<script src>` 與
     * `<link rel=stylesheet>` 內嵌進 index.html。
     */
    // 圖片等資產一律轉 data URI（給一個大到不可能超過的門檻）
    assetsInlineLimit: 1024 * 1024 * 100,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // 不切 chunk：多一個檔就多一個 relay 載不到的資源
        inlineDynamicImports: true
      }
    }
  }
})
