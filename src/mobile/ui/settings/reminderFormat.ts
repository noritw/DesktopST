import type { ReminderSchedule } from '@core/types'

/**
 * 提醒時間的顯示格式（手機版）。
 *
 * ⚠️ **一定要跟原生選擇器同一種制式**。`<input type="time">` 與
 * `<input type="datetime-local">` 在 Android 上是照**裝置語系**畫的——
 * zh-TW 會顯示「下午4:43」。清單這邊若自己用 `padStart` 拼 24 小時制，
 * 同一則提醒在編輯器是「下午4:43」、在清單是「16:43」，
 * 使用者會以為存錯了（owner 2026-08-09 實機回報過這個）。
 *
 * 所以一律走 `toLocaleTimeString()`，讓兩邊由同一個語系決定。
 */

/** 把時分格式化成裝置語系的樣子（例：zh-TW → 「下午4:43」）。 */
export function formatClock(hour: number, minute: number): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** 完整日期＋時間（一次性提醒用）。 */
export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${formatClock(
    d.getHours(),
    d.getMinutes()
  )}`
}

/**
 * 「還有多久」的白話描述。
 *
 * 一次性提醒最容易設錯——切到「一次性」時預設是**一小時後**，
 * 想測 2 分鐘的人不改到就會等不到。把相對時間寫在旁邊，設錯當下就看得出來。
 * 已過期回傳 null（呼叫端自己決定怎麼講）。
 */
export function formatRelative(ts: number, nowMs: number = Date.now()): string | null {
  const diff = ts - nowMs
  if (diff <= 0) return null
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return '不到 1 分鐘後'
  if (mins < 60) return `約 ${mins} 分鐘後`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours < 24) return rest === 0 ? `約 ${hours} 小時後` : `約 ${hours} 小時 ${rest} 分鐘後`
  return `約 ${Math.round(hours / 24)} 天後`
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 對齊桌面版 `RemindersManagerWindow.tsx` 的措辭，同一個排程在兩邊看到的敘述要一樣。 */
export function scheduleLabel(s: ReminderSchedule): string {
  if (s.type === 'startup') return '每次啟動'
  if (s.type === 'daily') return `每天 ${formatClock(s.hour, s.minute)}`
  if (s.type === 'weekly') {
    const names = [...s.days].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d] ?? '?').join('、')
    return `每週 ${names} ${formatClock(s.hour, s.minute)}`
  }
  if (s.type === 'interval') {
    const mins = Math.round(s.intervalMs / 60_000)
    if (mins >= 60 && mins % 60 === 0) return `每 ${mins / 60} 小時`
    return `每 ${mins} 分鐘`
  }
  const rel = formatRelative(s.at)
  return `一次性 ${formatDateTime(s.at)}${rel ? `（${rel}）` : '（已過期）'}`
}
