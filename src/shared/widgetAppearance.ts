import type { ColorTheme } from '@core/types'
import { THEMES } from './colorThemes'

/**
 * 桌面小工具的外觀設定：**12 組配色任選 ＋ 底色透明度**
 * （owner 2026-08-23，見 `docs/mobile-android-widget-plan.md` §14.2）。
 *
 * DeST 與飲食記錄 App **兩邊各存各的**（owner 明講「兩邊可以設定不同顏色」），
 * 但共用這一份解析邏輯與同一張色表（`./colorThemes.ts`）——抄一份過去就是
 * 計畫書再三警告的雙邊定義漂移。
 *
 * ## 為什麼要把顏色算成 `#AARRGGBB` 字串交給原生層
 *
 * 原生層讀不到 TS 的色表，而 Android 的 `Color.parseColor()` 只吃
 * `#RRGGBB`／`#AARRGGBB`（**不吃 CSS 的 `rgba(...)`**，色表裡的 `border`
 * 剛好就是那個格式）。所以由 JS 這邊統一換算好再寫進 `state.json`，
 * 原生層只負責 parse 與塗色——比照「原生層不做決策」的一貫做法。
 */

export interface WidgetAppearance {
  /**
   * 小工具用哪一組配色。`null` ＝ 跟隨 App 目前的配色。
   *
   * 保留「跟隨」這個選項而不是只給 12 選 1：多數人只想讓小工具跟 App 長得一樣，
   * 而 App 的配色本來就會被情境切換改動——固定成某一組的話，切情境之後
   * 小工具就跟 App 對不起來了。飲食記錄 App 沒有「App 配色」這個概念
   * （它的 UI 有自己的一套 CSS），所以那邊一律是明確指定，見 §14.2。
   */
  theme: ColorTheme | null
  /** 底色不透明度 0–100（0 ＝ 完全透明，只剩文字浮在桌布上）。 */
  bgOpacity: number
}

export const DEFAULT_WIDGET_APPEARANCE: WidgetAppearance = { theme: null, bgOpacity: 100 }

/** 讀進來的設定可能不存在／壞掉／是舊版，一律正規化。 */
export function normalizeWidgetAppearance(raw: unknown): WidgetAppearance {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WIDGET_APPEARANCE }
  const obj = raw as Partial<WidgetAppearance>
  const theme = typeof obj.theme === 'string' && obj.theme in THEMES ? (obj.theme as ColorTheme) : null
  const opacity = typeof obj.bgOpacity === 'number' && Number.isFinite(obj.bgOpacity) ? obj.bgOpacity : 100
  return { theme, bgOpacity: Math.min(100, Math.max(0, Math.round(opacity))) }
}

/** 寫進 `state.json` 給原生層的色票，全部是 `#AARRGGBB`。 */
export interface WidgetColors {
  /** 圓角底板（已經套用透明度）。 */
  bg: string
  text: string
  textSub: string
  /** 兩則對白之間的分隔線，也拿來當進度條的軌道與次要按鈕的底。 */
  border: string
  /**
   * 按鈕的圓底（飲食小工具的相機／鉛筆）。
   *
   * ⚠️ **底色透明度不套用在這裡**：按鈕要按得到就要看得見，跟著底板一起淡掉
   * 等於整排按鈕消失（owner 2026-08-23 回報「改了配色按鈕還是原本的淺綠色」，
   * 修法是讓按鈕跟著配色走——不是讓它跟著透明度一起不見）。
   */
  accent: string
  /** 比 accent 再重一階，用在進度條的填色。 */
  accentStrong: string
}

/**
 * `#RGB`／`#RRGGBB`／`#AARRGGBB`／`rgba(r,g,b,a)`／`rgb(r,g,b)` → `#AARRGGBB`。
 *
 * `alphaScale` 會再乘上去（底色的透明度就是這樣套的）。
 * 解析不出來時退回不透明黑／白也不對，所以直接回傳 `null` 讓呼叫端決定。
 */
export function toAndroidColor(css: string, alphaScale = 1): string | null {
  const s = css.trim()
  const clampAlpha = (a: number): number => Math.min(255, Math.max(0, Math.round(a * 255)))
  const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase()

  const rgbaMatch = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgbaMatch) {
    const [r, g, b] = [rgbaMatch[1], rgbaMatch[2], rgbaMatch[3]].map((v) => Math.min(255, Math.max(0, Math.round(Number(v)))))
    const a = rgbaMatch[4] === undefined ? 1 : Number(rgbaMatch[4])
    if ([r, g, b, a].some((v) => !Number.isFinite(v))) return null
    return `#${hex2(clampAlpha(a * alphaScale))}${hex2(r)}${hex2(g)}${hex2(b)}`
  }

  const m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (!m) return null
  let body = m[1]
  if (body.length === 3) body = body.split('').map((c) => c + c).join('')
  let alpha = 1
  if (body.length === 8) {
    alpha = parseInt(body.slice(0, 2), 16) / 255
    body = body.slice(2)
  }
  if (body.length !== 6) return null
  return `#${hex2(clampAlpha(alpha * alphaScale))}${body.toUpperCase()}`
}

/**
 * `#AARRGGBB`（Android）→ `#RRGGBBAA`（CSS）。
 *
 * ⚠️ **兩邊的 alpha 位置剛好相反**，而且兩種都是合法的八碼十六進位，
 * 所以搞錯不會噴任何錯誤——只會安靜地把 alpha 當成紅色、藍色當成 alpha，
 * 顏色與透明度雙雙錯掉。owner 2026-08-23 回報「改顏色和透明度沒有正確在
 * 預覽顯示」就是這個：設定頁把 {@link resolveWidgetColors} 的結果直接塞進
 * CSS `style`。
 *
 * 設定頁的預覽**一定要走這支轉換**，不要另外算一份 CSS 色票——那樣預覽與
 * 小工具實際顏色就會各自漂移（跟 §12.4「預覽走同一支計算」同一個理由）。
 */
export function toCssColor(androidColor: string): string {
  const m = androidColor.trim().match(/^#([0-9a-f]{2})([0-9a-f]{6})$/i)
  if (!m) return androidColor
  return `#${m[2]}${m[1]}`
}

/** 把整組色票轉成 CSS 可用的格式（給設定頁的預覽）。 */
export function widgetColorsToCss(colors: WidgetColors): WidgetColors {
  return {
    bg: toCssColor(colors.bg),
    text: toCssColor(colors.text),
    textSub: toCssColor(colors.textSub),
    border: toCssColor(colors.border),
    accent: toCssColor(colors.accent),
    accentStrong: toCssColor(colors.accentStrong)
  }
}

/**
 * 算出小工具要用的四個顏色。
 *
 * `appTheme` 是「跟隨 App 配色」時要用的那一組；飲食記錄 App 那邊沒有這個
 * 概念，傳 `'mint'`（全站預設）即可。
 */
export function resolveWidgetColors(appearance: WidgetAppearance, appTheme: ColorTheme = 'mint'): WidgetColors {
  const vars = THEMES[appearance.theme ?? appTheme] ?? THEMES.mint
  const scale = appearance.bgOpacity / 100
  return {
    bg: toAndroidColor(vars.bg, scale) ?? '#FFF7FFFC',
    text: toAndroidColor(vars.text) ?? '#FF3D5A52',
    textSub: toAndroidColor(vars.sub) ?? '#FF7AA898',
    border: toAndroidColor(vars.border) ?? '#14000000',
    accent: toAndroidColor(vars.mint) ?? '#FFCBFBC4',
    accentStrong: toAndroidColor(vars.mint2) ?? '#FFAAEEDD'
  }
}
