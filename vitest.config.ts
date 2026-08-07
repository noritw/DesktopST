import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 自動測試設定。
 *
 * 測試對象是 `src/core/`（B1／B2／B2.7 抽出的純函式層），
 * 外加 `src/mobile/events/`（B3 階段 0-②：WebSocket 由建構子注入，所以同樣可決定性）、
 * 以及 `src/mobile/adapters/` 的純契約（記憶體 storage／AES secrets，不碰真機）。
 * 共同點是不碰真的網路、檔案、視窗，「固定輸入 → 固定輸出」，機器測得動。
 * `src/main/`（Electron）與 `src/renderer/`（React）不在範圍內：
 * 前者要真的 Electron 環境，後者要真的畫面，兩者都屬
 * `docs/pre-b3-work-assessment.md` §6.4「只能靠人」的那一側。
 */
export default defineConfig({
  resolve: {
    alias: { '@core': resolve(__dirname, 'src/core') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 隨機工具與新聞抽選會用到 Math.random；測試各自負責固定它，
    // 這裡不做全域 mock，避免某支測試忘了還原而污染別支。
    restoreMocks: true
  }
})
