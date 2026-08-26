import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tw.nori.destnutrition',
  appName: '食記',
  webDir: 'www',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'http'
  },
  plugins: {
    /*
     * 原生 HTTP 接管全域 `fetch`，讓 WebView 的跨網域請求不受 CORS 限制。
     *
     * ⚠️ **沒有這一段，接本機模型（Ollama／LM Studio）一定是 `Failed to fetch`**
     * （owner 2026-08-19 實測：同一台電腦上的模型，DeST 連得上、這個 App 連不上）。
     * 差別就在 DeST 的 `capacitor.config.ts` 一直有開這個、這邊建立時漏掉了。
     * Ollama 預設不送 CORS 標頭，WebView 的原生 fetch 因此直接被擋；
     * 走原生橋接則完全不經過瀏覽器的 CORS 檢查。
     *
     * 改這個檔案之後**一定要重跑 `npx cap sync android`**，設定才會寫進
     * `android/app/src/main/assets/capacitor.config.json`（原生層讀的是那份，
     * 不是這個 .ts）。只重建 www 是不夠的。
     */
    CapacitorHttp: { enabled: true }
  }
}

export default config
