import type { Reminder } from '../types'

/**
 * 日曆同步分頁的分組邏輯（純函式，桌面／手機共用）。
 *
 * 原本只在 `src/renderer/src/windows/RemindersManagerWindow.tsx` 裡，手機版
 * 開工前搬出來——這個專案已經被「同一套邏輯兩邊各寫一份然後漂移」燒過
 * 不只一次（`contentHash.ts` 的 M4 雙邊定義漂移、`memory` 子集三欄對四欄），
 * 不要再添一筆。
 */

export interface CalendarGroup {
  label: string
  reminders: Reminder[]
}

/** 週一為每週起始日（owner 個人習慣，不用系統 locale 判斷）。回傳當週週一 00:00。 */
function mondayOf(d: Date): Date {
  const day = d.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday
}

/**
 * 分組規則：已過期（時間過了但從沒觸發過）／本週／下週／之後依月。
 * 空分組不出現。只認 `schedule.type === 'once'` 的提醒（日曆衍生提醒固定是一次性）。
 */
export function groupCalendarReminders(reminders: Reminder[], nowMs: number): CalendarGroup[] {
  const now = new Date(nowMs)
  const thisMonday = mondayOf(now).getTime()
  const nextMonday = thisMonday + 7 * 86400_000
  const afterNextMonday = nextMonday + 7 * 86400_000

  const expired: Reminder[] = []
  const thisWeek: Reminder[] = []
  const nextWeek: Reminder[] = []
  const byMonth = new Map<string, Reminder[]>()

  for (const r of reminders) {
    if (r.schedule.type !== 'once') continue
    const at = r.schedule.at
    if (at < nowMs && !r.lastTriggeredAt) {
      expired.push(r)
      continue
    }
    if (at >= thisMonday && at < nextMonday) {
      thisWeek.push(r)
      continue
    }
    if (at >= nextMonday && at < afterNextMonday) {
      nextWeek.push(r)
      continue
    }
    const d = new Date(at)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(r)
  }

  const sortByAt = (list: Reminder[]) =>
    [...list].sort((a, b) => (a.schedule as { at: number }).at - (b.schedule as { at: number }).at)

  const groups: CalendarGroup[] = []
  if (expired.length > 0) groups.push({ label: '已過期', reminders: sortByAt(expired) })
  if (thisWeek.length > 0) groups.push({ label: '本週', reminders: sortByAt(thisWeek) })
  if (nextWeek.length > 0) groups.push({ label: '下週', reminders: sortByAt(nextWeek) })

  const monthKeys = [...byMonth.keys()].sort((a, b) => {
    const [ay, am] = a.split('-').map(Number)
    const [by, bm] = b.split('-').map(Number)
    return ay !== by ? ay - by : am - bm
  })
  for (const key of monthKeys) {
    const [, m] = key.split('-').map(Number)
    groups.push({ label: `${m + 1}月`, reminders: sortByAt(byMonth.get(key)!) })
  }

  return groups
}
