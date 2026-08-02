/**
 * 日曆模組的中性型別定義。
 *
 * 這一層刻意不認識任何特定服務商（Google／Outlook／CalDAV…）：
 * 端點與回應格式只存在於各自的 provider 實作裡。
 * 日後手機版要換一套取得方式時，只需要再寫一個 CalendarProvider，
 * 格式化與注入邏輯（index.ts）完全不用動。
 */

export interface CalendarEvent {
  id: string
  title: string
  /** epoch ms（本機時區由呈現層負責） */
  start: number
  end: number
  allDay: boolean
  location?: string
  /**
   * 'event' ＝ 一般行程（有明確起訖時間）
   * 'task'  ＝ 待辦事項（只有到期日；多數服務商的待辦不保留時間，呈現層不應顯示時刻）
   */
  kind: 'event' | 'task'
}

export interface CalendarFetchOptions {
  fromMs: number
  toMs: number
  max: number
}

export interface CalendarProvider {
  /** provider 識別字串，例如 'google' */
  readonly id: string
  /** 本機是否已有可用的授權資料（不發送網路請求） */
  isAuthenticated(): boolean
  /**
   * 取得指定區間內的行程。
   * 未授權／token 換不到／網路失敗一律回傳 null，不可 throw。
   */
  listUpcoming(opts: CalendarFetchOptions): Promise<CalendarEvent[] | null>
}

export interface CalendarAuthResult {
  ok: boolean
  /** 已連結的帳號顯示名稱（Google 為 email） */
  displayName?: string
  error?: string
}
