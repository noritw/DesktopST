/**
 * 相對時間（清單 F12）。
 *
 * `assets/mobile.html` 的 `nrFormatTime` 與桌面新聞報各有一份「幾分鐘前」的算法，
 * 這裡收成唯一一份。**只算不寫字** —— 回傳結構化結果，中文由 UI 層決定
 * （roadmap §3.3：core 不得含 UI 文案）。文字版在 `src/shared/relativeTimeLabel.ts`。
 */

export type ElapsedSpan =
  /** 一分鐘內 */
  | { kind: 'just-now' }
  | { kind: 'minutes'; value: number }
  | { kind: 'hours'; value: number }
  | { kind: 'days'; value: number }
  /** 超過一週（或算不出來）→ 顯示絕對時間，帶回原字串讓 UI 自行 format */
  | { kind: 'absolute'; iso: string }
  /** 沒有時間可顯示 */
  | { kind: 'unknown' }

/**
 * 距離 `now` 過了多久。
 *
 * 未來時間（時鐘不同步、來源標錯）一律當「剛剛」，
 * 顯示「-3 分鐘前」比沒有時間更難看懂。
 */
export function elapsedSince(iso: string | undefined | null, now: number = Date.now()): ElapsedSpan {
  if (!iso) return { kind: 'unknown' }
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return { kind: 'unknown' }

  const mins = Math.floor((now - t) / 60_000)
  if (mins < 1) return { kind: 'just-now' }
  if (mins < 60) return { kind: 'minutes', value: mins }
  const hours = Math.floor(mins / 60)
  if (hours < 24) return { kind: 'hours', value: hours }
  const days = Math.floor(hours / 24)
  if (days < 7) return { kind: 'days', value: days }
  return { kind: 'absolute', iso }
}
