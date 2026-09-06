/**
 * 早安簡報：使用者今天第一次理這個 App 時，角色主動打一聲招呼，
 * 帶一句天氣／行程／熱搜（三選一，依優先序）。設計依據見
 * `docs/morning-briefing-kickoff.md`。
 *
 * 這裡只放「今天講過了嗎」的純比對邏輯；三層內容抓取要打 API／讀設定，
 * 留在平台層（`main/morningBriefing.ts`），見該文件 §4。
 */

export interface MorningBriefingSnapshot {
  /** 上次講過早安的日期（YYYY-MM-DD，台北時區） */
  lastGreetedDate: string
}

export type BriefingSource = 'weather' | 'calendar' | 'trending'

export interface MorningBriefingContent {
  source: BriefingSource
  injectionText: string
}

/** 把磁碟讀回的未知資料正規化成合法快照；壞掉／缺欄位一律退回空快照。 */
export function normalizeMorningBriefingSnapshot(raw: unknown): MorningBriefingSnapshot {
  const empty = emptyMorningBriefingSnapshot()
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Partial<MorningBriefingSnapshot>
  return {
    lastGreetedDate: typeof r.lastGreetedDate === 'string' ? r.lastGreetedDate : empty.lastGreetedDate
  }
}

export function emptyMorningBriefingSnapshot(): MorningBriefingSnapshot {
  return { lastGreetedDate: '' }
}

/** 今天是否已經講過（純比對，不碰時間 API，方便測） */
export function shouldGreetToday(snapshot: MorningBriefingSnapshot, todayDate: string): boolean {
  return snapshot.lastGreetedDate !== todayDate
}

/** 時間戳轉台北時區日期字串（YYYY-MM-DD），比照 `core/weather/proactive.ts` 的 taipeiDateString。 */
export function taipeiDateString(now: number): string {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
}

/**
 * 依「新的一天從幾點算起」位移後的台北日期字串。`boundaryHour` 0（預設）等同 `taipeiDateString`；
 * 例如 `boundaryHour=4` 時，凌晨 2 點算「前一天」，過了凌晨 4 點才算「新的一天」，
 * 熬夜使用者的最後一次互動不會把隔天一早的問候額度提前用掉。台灣沒有日光節約時間，
 * 直接位移毫秒數等同位移台北時區的實際時鐘時間。
 */
export function greetingDayString(now: number, boundaryHour: number): string {
  return taipeiDateString(now - boundaryHour * 3600_000)
}

/** 對話進行中不插話：最後一則使用者訊息在 2 分鐘內，就不觸發早安簡報。 */
export function isConversationTooRecent(lastUserMessageAt: number | null, now: number): boolean {
  return lastUserMessageAt !== null && now - lastUserMessageAt < 2 * 60 * 1000
}
