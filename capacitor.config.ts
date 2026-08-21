import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 設定（手機獨立版，roadmap §11.2）。
 *
 * ⚠️ `appId` 一旦發布不可更改——改了 Android 視為不同 app，
 * 使用者會裝成兩個、資料不互通。
 *
 * `webDir` 指向手機 UI 的 web build 輸出（`npm run build:mobile`）。
 * 跑 `npx cap sync` 前一定要先建置，否則同步的是舊產物。
 * 同一份輸出也會給桌面版的 mobileServer 提供（掃 QR 開網頁那條路，
 * roadmap §4.5：APK 與網頁版是同一份原始碼）。
 */
const config: CapacitorConfig = {
  appId: 'tw.nori.dest',
  appName: 'DeST',
  webDir: 'out/mobile',
  android: {
    // 允許使用者自架的 http 服務（區網同步主機、自架新聞聚合站）。
    // 正式 API 一律走 https，這只是不禁止區網 http。
    // ⚠️ 這個旗標**不夠**——見下面 `androidScheme` 的說明，實際擋下請求的是 scheme 不對，
    // 不是這個開關沒開。留著當雙重保險，不要指望它單獨生效。
    allowMixedContent: true
  },
  server: {
    /*
     * ⚠️ **不要改回 `'https'`**（S2 M1 owner 2026-08-12 實機回報）：
     * `https://localhost` 是頁面的來源，瀏覽器的 Mixed Content 政策會把任何
     * `http://`／`ws://` 子資源（角色頭像 `<img>`、遙控模式的 WebSocket）當成
     * 「安全頁面偷載不安全內容」直接擋掉——`allowMixedContent: true` 在這台
     * 實測的 WebView 版本上**沒有**完全蓋掉這個檢查（img 直接被拒絕、WS 卡在
     * deprecated 警告後連不上）。改成 `'http'` 才是真正解法：`localhost`
     * 不論用哪個 scheme 都算瀏覽器規範裡的「可信任來源」，不會因此少掉任何
     * secure-context 才有的能力，卻讓區網 LAN 直連（`http://192.168.x.x:port`／
     * `ws://…`）不再被歸類成「降級」而被擋。中繼走的是 `https://`／`wss://`，
     * 這條路是升級不是降級，本來就不受影響。
     */
    androidScheme: 'http'
  },
  plugins: {
    // 原生 HTTP 接管全域 fetch，讓 WebView 的跨網域請求不受 CORS 限制。
    // 這是 Gemini 唯一可行的路：`@google/generative-ai` v0.21 沒有 fetch 注入選項，
    // 只會呼叫全域 fetch（見 `core/llm/deps.ts`）。RSS 抓取同樣依賴這個。
    CapacitorHttp: { enabled: true }
  }
}

export default config
