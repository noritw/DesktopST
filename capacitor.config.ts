import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 設定（手機獨立版，roadmap §11.2）。
 *
 * ⚠️ `appId` 一旦發布不可更改——改了 Android 視為不同 app，
 * 使用者會裝成兩個、資料不互通。
 *
 * `webDir` 指向手機 UI 的 web build 輸出。該 UI 是 B3 的工作，
 * **目前尚未存在**，因此現在還不能跑 `npx cap sync`。
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
    allowMixedContent: true
  },
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // 原生 HTTP 接管全域 fetch，讓 WebView 的跨網域請求不受 CORS 限制。
    // 這是 Gemini 唯一可行的路：`@google/generative-ai` v0.21 沒有 fetch 注入選項，
    // 只會呼叫全域 fetch（見 `core/llm/deps.ts`）。RSS 抓取同樣依賴這個。
    CapacitorHttp: { enabled: true }
  }
}

export default config
