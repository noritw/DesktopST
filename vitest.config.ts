import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 自動測試設定。
 *
 * 測試對象**只有 `src/core/`** —— 那是 B1／B2／B2.7 抽出來的純函式層，
 * 不碰網路、檔案、視窗，所以「固定輸入 → 固定輸出」，機器測得動。
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
