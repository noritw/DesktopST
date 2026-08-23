import type { ColorTheme } from '@core/types'
import { isDarkTheme, THEMES } from '@shared/colorThemes'

/**
 * 飲食記錄 App 的配色（owner 2026-08-23：App 本身也要能選 DeST 的 12 組配色）。
 *
 * ⚠️ **色表的唯一真相是 `src/shared/colorThemes.ts`**，跟 DeST 共用同一份——
 * 抄一份過來就是這個專案踩過好幾次的雙邊定義漂移。這裡只做「怎麼把那組色
 * 對應到這個 App 的 CSS 變數」，變數清單見 `styles.css` 的 `:root`。
 *
 * 跟 DeST 手機端的 `applyTheme()` 是兩套變數名（那邊是 `--mint` 系列），
 * 因為兩個 App 的 CSS 本來就各自獨立；共用的是**色值**，不是變數命名。
 */

export const DEFAULT_NUTRITION_THEME: ColorTheme = 'mint'

/** `#RRGGBB` → [r, g, b]；不是六碼十六進位就回 null。 */
function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * 把兩個顏色依比例混合（`t` 是第二個顏色的佔比）。
 *
 * 用來生 `--accent-strong`：色表裡沒有「比 mint2 再沉一階」的顏色，而這個
 * App 的小字連結／圖示／統計長條需要一個在 `bg` 與 `surface` 上都讀得清楚的
 * 中間調。用 `mint2` 混一點 `text` 得到的中間調，在淺色與深色主題下都成立
 * （淺色：mint2 亮、text 暗 → 混出中調；深色：反過來，一樣是中調）。
 */
function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  const mixed = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 語意色：熱量超標／蛋白質達標。
 *
 * **刻意不從主題色推導**——那兩個是警示語意，跟著配色跑會把意思洗掉
 * （跟小工具那邊同一個原則，見 `docs/mobile-android-widget-plan.md` §14.2）。
 * 但深色主題下淺色那組深紅深綠會糊在底色裡，所以備兩版。
 */
const SEMANTIC_LIGHT = { over: '#C55656', good: '#3F8F6B' }
const SEMANTIC_DARK = { over: '#E88A8A', good: '#6FD3A6' }

export function applyNutritionTheme(name: ColorTheme, root: HTMLElement = document.documentElement): void {
  const t = THEMES[name] ?? THEMES[DEFAULT_NUTRITION_THEME]
  const semantic = isDarkTheme(name) ? SEMANTIC_DARK : SEMANTIC_LIGHT
  const s = root.style
  s.setProperty('--bg', t.bg)
  s.setProperty('--surface', t.surface)
  s.setProperty('--text', t.text)
  s.setProperty('--text-sub', t.sub)
  s.setProperty('--border', t.border)
  s.setProperty('--tint', t.mint)
  s.setProperty('--accent', t.mint2)
  s.setProperty('--accent-strong', mixHex(t.mint2, t.text, 0.45))
  s.setProperty('--danger', t.danger)
  s.setProperty('--danger-text', t.dangerText)
  s.setProperty('--over', semantic.over)
  s.setProperty('--good', semantic.good)
  // Android Chrome 的網址列／工作列預覽會吃這個，不更新的話深色主題下會露一條亮綠。
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg)
}
