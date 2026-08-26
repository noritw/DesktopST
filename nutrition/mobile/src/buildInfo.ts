/**
 * 這份手機產物是「什麼時候、從哪個 commit」建出來的。存在理由跟 DeST 本體
 * `src/mobile/buildInfo.ts` 一樣：owner 裝了新 APK 之後要能確認手機上跑的
 * 真的是新的那份，版本號答不了這個問題，建置時間才答得出。
 */

export const APP_VERSION: string = __NUTRITION_APP_VERSION__
export const GIT_HASH: string = __NUTRITION_GIT_HASH__
export const BUILD_TIME: string = __NUTRITION_BUILD_TIME__

/** ISO 時間 → `2026-08-08 16:20`（裝置當地時區）。 */
export function formatBuildTime(iso: string = BUILD_TIME): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 「關於」要顯示的兩行字。第二行可能是空的（沒有 git、時間壞掉）。 */
export function buildInfoLines(): { title: string; detail: string } {
  const title = `食記 v${APP_VERSION}`
  const parts: string[] = []
  const time = formatBuildTime()
  if (time) parts.push(`建置 ${time}`)
  if (GIT_HASH) parts.push(GIT_HASH)
  return { title, detail: parts.join(' · ') }
}
