import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { headlessReminderParams, headlessWeatherProactiveParams } from '../headless/bridge'
import './styles.css'

/*
 * headless 提醒（`?headless=reminder`）／天氣主動發話（`?headless=weather-proactive`）：
 * 這一次載入不是給人看的——是原生前景服務起的隱藏 WebView，只為了跑一次判斷／
 * 生一句台詞就結束（`docs/mobile-standalone-reminder-plan.md` §2.1／
 * `docs/weather-proactive-mobile-kickoff.md` §3.4）。
 *
 * **不要掛 React**：整個 App 起來會連帶跑排程器、事件訂閱、UI 狀態，
 * 在一個沒人看的 WebView 裡純屬浪費，還會拖慢原生那邊的逾時預算。
 *
 * 用動態 import 讓 headless 這條路徑不進前景的初始執行路徑。
 */
if (headlessReminderParams()) {
  void import('../headless/reminderHeadless').then((m) => m.runHeadlessReminder())
} else if (headlessWeatherProactiveParams()) {
  void import('../headless/weatherProactiveHeadless').then((m) => m.runHeadlessWeatherProactive())
} else {
  const el = document.getElementById('root')
  if (!el) throw new Error('#root not found')

  createRoot(el).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  )
}
