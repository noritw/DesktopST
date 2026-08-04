import type { ColorTheme } from '@core/types'

/**
 * 9 種色彩主題（清單 G1）。
 *
 * **色值逐字沿用 `assets/mobile.html` 817–840 行**，不重新設計 ——
 * 兩份 UI 在過渡期會並存（roadmap §4.5：新 UI 完成前舊的繼續服役），
 * 顏色不一致會讓使用者以為切換模式時跑錯地方。
 *
 * 變數命名也沿用 mobile.html 的 `--mint` 系列，**刻意不與桌面的
 * `--color-mint` 系列統一**：桌面那套是 `src/styles/theme.css` 的資產，
 * CLAUDE.md 明訂視覺修改只動那幾個檔。兩套各自獨立，不互相牽動。
 */

export interface ThemeVars {
  mint: string
  mint2: string
  bg: string
  surface: string
  userBubble: string
  text: string
  sub: string
  border: string
  /**
   * 危險／錯誤色（刪除按鈕、錯誤 toast）。
   *
   * **做成主題變數而不是寫死在元件裡**，是因為淺色主題用的粉紅 `#FFBBBB`
   * 放到深色底上會過亮而刺眼（owner 2026-08-04 實機回報）。
   * 寫死的話深色主題就沒有辦法有自己的一組。
   */
  danger: string
  dangerText: string
}

/** 淺色主題共用的危險色。深色主題另有一組，見下方 `dark`。 */
const LIGHT_DANGER = { danger: '#FFBBBB', dangerText: '#5A2A3A' }

export const THEMES: Record<ColorTheme, ThemeVars> = {
  mint:     { mint: '#CBFBC4', mint2: '#AAEEDD', bg: '#F7FFFC', surface: '#ffffff', userBubble: '#AAEEFF', text: '#3D5A52', sub: '#7AA898', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  butter:   { mint: '#FFE8AA', mint2: '#F0D080', bg: '#FFFDF0', surface: '#ffffff', userBubble: '#FFF0CC', text: '#5A4A2A', sub: '#9A8A5A', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  peach:    { mint: '#FFD6B8', mint2: '#F0C0A0', bg: '#FFF8F4', surface: '#ffffff', userBubble: '#FFE8D8', text: '#5A3A2A', sub: '#9A7A6A', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  aqua:     { mint: '#B8F4EA', mint2: '#88E8D8', bg: '#F0FFFE', surface: '#ffffff', userBubble: '#AAEEFF', text: '#2A5050', sub: '#6A9A98', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  sky:      { mint: '#AAEEFF', mint2: '#88CCEE', bg: '#F0FAFF', surface: '#ffffff', userBubble: '#CCF0FF', text: '#2A4A6A', sub: '#6A8AAA', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  blush:    { mint: '#FFBBBB', mint2: '#F0A0B0', bg: '#FFF5F5', surface: '#ffffff', userBubble: '#FFD8E0', text: '#5A2A3A', sub: '#9A7A88', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  lavender: { mint: '#F0BBFF', mint2: '#DDA0EE', bg: '#FDF5FF', surface: '#ffffff', userBubble: '#E8D0FF', text: '#4A2A5A', sub: '#8A6A9A', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },
  white:    { mint: '#E8E8E8', mint2: '#CCCCCC', bg: '#FFFFFF', surface: '#F8F8F8', userBubble: '#DDDDDD', text: '#3D5A52', sub: '#7BA898', border: 'rgba(0,0,0,0.12)', ...LIGHT_DANGER },

  /**
   * ⚠️ **深色主題的值與 `mobile.html` 不同**（其餘八種仍逐字相同）。
   *
   * owner 2026-08-04 實機回報「整個黑掉、看不清楚」。原本 `bg #111111`
   * 配 `surface #1A1A1A` 只差 9 階亮度 —— 在桌機螢幕上看得出來，
   * 但手機通常在較亮的環境使用、又常開自動調光，那點差距會整個消失，
   * 卡片與 sheet 因此看起來像直接融進背景。
   *
   * 現在拉開到 `#121212` / `#242424`（18 階），header 再高一階做出三層。
   *
   * 危險色改暗紅：淺色那組粉紅 `#FFBBBB` 在深色底上會過亮而刺眼。
   */
  dark:     { mint: '#2E2E2E', mint2: '#3A3A3A', bg: '#121212', surface: '#242424', userBubble: '#24443F', text: '#EEEEEE', sub: '#9A9A9A', border: 'rgba(255,255,255,0.14)', danger: '#8A3A3A', dangerText: '#FFDCDC' }
}

export const THEME_IDS = Object.keys(THEMES) as ColorTheme[]

/**
 * 套用主題到 `<html>` 的 inline style。
 *
 * 順帶更新 `theme-color` meta —— Android Chrome 的網址列與工作列預覽會吃它，
 * 不更新的話深色主題下會出現一條亮綠色，很醒目。
 */
export function applyTheme(name: ColorTheme, root: HTMLElement, doc: Document): void {
  const t = THEMES[name] ?? THEMES.mint
  const s = root.style
  s.setProperty('--mint', t.mint)
  s.setProperty('--mint2', t.mint2)
  s.setProperty('--bg', t.bg)
  s.setProperty('--surface', t.surface)
  s.setProperty('--user-bubble', t.userBubble)
  s.setProperty('--text', t.text)
  s.setProperty('--text-sub', t.sub)
  s.setProperty('--border', t.border)
  s.setProperty('--danger', t.danger)
  s.setProperty('--danger-text', t.dangerText)
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.mint)
}
