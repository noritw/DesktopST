import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { headlessReminderParams } from '../headless/bridge'
import './styles.css'

/*
 * headless 提醒（`?headless=reminder`）：
 * 這一次載入不是給人看的——是提醒到點時 `ReminderForegroundService`
 * 起的隱藏 WebView，只為了生一句台詞就結束（計畫書 §2.1）。
 *
 * **不要掛 React**：整個 App 起來會連帶跑排程器、事件訂閱、UI 狀態，
 * 在一個沒人看的 WebView 裡純屬浪費，還會拖慢原生那邊的 45 秒預算。
 *
 * 用動態 import 讓 headless 這條路徑不進前景的初始執行路徑。
 */
if (headlessReminderParams()) {
  void import('../headless/reminderHeadless').then((m) => m.runHeadlessReminder())
} else {
  const el = document.getElementById('root')
  if (!el) throw new Error('#root not found')

  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
