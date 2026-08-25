import { v4 as uuidv4 } from 'uuid'
import type { Reminder } from '../types'
import type { CalendarEventWithReminders } from './googleProvider'

/**
 * 日曆驅動提醒的掃描器（§5，純函式，不碰檔案／IPC）。
 *
 * 身分鍵是 `sourceEventId + sourceOverrideIndex`（§3.2 拍板的預設做法）。
 * 已知風險：如果 Google 回傳的 `overrides` 陣列順序在兩次抓取之間變了，
 * 用 index 當身分鍵可能誤判成「新增+刪除」——理論上不該發生，
 * 目前先用最簡單的做法，真的遇到再改用 minutes 當身分鍵的一部分。
 */

export interface CalendarScanDiff {
  /** 新建或欄位有變動、需要 upsert 的提醒（已保留使用者手動調整過的裝置本地欄位） */
  toUpsert: Reminder[]
  /** Google 端已經沒有對應事件／override 了，要刪除的既有提醒 id */
  toDeleteIds: string[]
}

/**
 * 台詞素材。刻意**不放地點**（owner 2026-08-25 實測後拍板）：
 * Google 的 `location` 欄位多半是「場地名, 完整郵遞區號地址」，直接塞進 prompt
 * 會讓角色把門牌號碼整串唸出來（實例：「地點是大勇國小，334台灣桃園市八德區」）。
 *
 * 日期用**絕對日期**而不是 `dayLabel()` 的「今天／明天／後天」：相對標籤是以
 * **掃描當下**為基準算的，但提醒是之後才觸發，兩者會對不上；更麻煩的是相對
 * 標籤會隨日期漂移，導致每次掃描都判定 prompt「有變動」→ 無謂的更新＋每天
 * 觸發一次「該同步到手機了」。絕對日期不會漂，比對才穩定。
 */
function buildPrompt(ev: CalendarEventWithReminders): string {
  const d = new Date(ev.start)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `提醒使用者：${ev.title}，時間 ${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}。`
}

export function diffCalendarReminders(
  events: CalendarEventWithReminders[],
  existing: Reminder[]
): CalendarScanDiff {
  const existingByKey = new Map<string, Reminder>()
  for (const r of existing) {
    if (r.source !== 'calendar') continue
    if (!r.sourceEventId || r.sourceOverrideIndex === undefined) continue
    existingByKey.set(`${r.sourceEventId}::${r.sourceOverrideIndex}`, r)
  }

  const seenKeys = new Set<string>()
  const toUpsert: Reminder[] = []

  for (const ev of events) {
    ev.reminderMinutes.forEach((minutes, idx) => {
      const key = `${ev.id}::${idx}`
      seenKeys.add(key)

      const at = ev.start - minutes * 60000
      const label = ev.title
      const prompt = buildPrompt(ev)
      const existingR = existingByKey.get(key)

      if (!existingR) {
        toUpsert.push({
          id: uuidv4(),
          source: 'calendar',
          sourceEventId: ev.id,
          sourceOverrideIndex: idx,
          label,
          prompt,
          schedule: { type: 'once', at },
          enabled: true,
          /*
           * **預設關**（owner 2026-08-25 實測後推翻 kickoff §5.2 的原設計）。
           * 原本開著的理由是「讓角色參考完整行程增加自然度」，但實際上
           * `prompt` 已經含事件標題與時間，再灌一份 `[Calendar]` 是重複資料；
           * 而且那個區塊的說明句是 "You may bring them up naturally"，等於邀請
           * 模型把整串行程唸出來——實測角色連不相關的「澆花待辦」都一起講了。
           * 每則約多花 200–400 token。要的人仍可在編輯器自己打開。
           */
          injectCalendar: false,
          notificationDevice: 'both',
          wakeMode: 'always',
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
        return
      }

      const unchanged =
        existingR.label === label &&
        existingR.prompt === prompt &&
        existingR.schedule.type === 'once' &&
        existingR.schedule.at === at
      if (unchanged) return

      // 保留使用者手動調整過的裝置本地／個人化欄位，只更新跟 Google 端同步的部分
      toUpsert.push({
        ...existingR,
        label,
        prompt,
        schedule: { type: 'once', at },
        updatedAt: Date.now()
      })
    })
  }

  const toDeleteIds: string[] = []
  for (const [key, r] of existingByKey) {
    if (!seenKeys.has(key)) toDeleteIds.push(r.id)
  }

  return { toUpsert, toDeleteIds }
}
