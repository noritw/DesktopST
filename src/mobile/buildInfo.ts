/**
 * 這份手機產物是「什麼時候、從哪個 commit」建出來的。
 *
 * 存在的理由只有一個：owner 裝了新 APK 之後要能確認**手機上跑的真的是新的那份**。
 * 版本號答不了這個問題（debug 版重打十次都還是 0.4.0），所以畫面上主角是建置時間。
 *
 * 值來自 `vite.mobile.config.ts` 的 `define`，在 bundle 階段就被替換成字面值，
 * 執行期沒有任何查詢成本，也不需要 IPC —— 獨立模式根本沒有電腦可問。
 */

export const APP_VERSION: string = __APP_VERSION__
export const GIT_HASH: string = __GIT_HASH__
export const BUILD_TIME: string = __BUILD_TIME__

/**
 * ISO 時間 → `2026-08-08 16:20`（裝置當地時區）。
 *
 * 刻意不用 `toLocaleString()`：各裝置語系會給出長短不一的格式，
 * 而這行字要能一眼跟另一台比對。取不到有效時間就回空字串，讓呼叫端整行略過。
 */
export function formatBuildTime(iso: string = BUILD_TIME): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Header 用的短時間：`08-08 16:21`。省寬度，避免把右側標籤擠出捲軸。 */
export function formatBuildTimeShort(iso: string = BUILD_TIME): string {
  return formatBuildTime(iso).replace(/^\d{4}-/, '')
}

/** 「關於」要顯示的兩行字。第二行可能是空的（沒有 git、時間壞掉）。 */
export function buildInfoLines(standalone: boolean): { title: string; detail: string } {
  const title = `DeST v${APP_VERSION} · ${standalone ? '獨立版' : '遙控（電腦提供）'}`
  const parts: string[] = []
  const time = formatBuildTime()
  if (time) parts.push(`建置 ${time}`)
  if (GIT_HASH) parts.push(GIT_HASH)
  return { title, detail: parts.join(' · ') }
}
