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
}

export const THEMES: Record<ColorTheme, ThemeVars> = {
  mint:     { mint: '#CBFBC4', mint2: '#AAEEDD', bg: '#F7FFFC', surface: '#ffffff', userBubble: '#AAEEFF', text: '#3D5A52', sub: '#7AA898', border: 'rgba(0,0,0,0.08)' },
  butter:   { mint: '#FFE8AA', mint2: '#F0D080', bg: '#FFFDF0', surface: '#ffffff', userBubble: '#FFF0CC', text: '#5A4A2A', sub: '#9A8A5A', border: 'rgba(0,0,0,0.08)' },
  peach:    { mint: '#FFD6B8', mint2: '#F0C0A0', bg: '#FFF8F4', surface: '#ffffff', userBubble: '#FFE8D8', text: '#5A3A2A', sub: '#9A7A6A', border: 'rgba(0,0,0,0.08)' },
  aqua:     { mint: '#B8F4EA', mint2: '#88E8D8', bg: '#F0FFFE', surface: '#ffffff', userBubble: '#AAEEFF', text: '#2A5050', sub: '#6A9A98', border: 'rgba(0,0,0,0.08)' },
  sky:      { mint: '#AAEEFF', mint2: '#88CCEE', bg: '#F0FAFF', surface: '#ffffff', userBubble: '#CCF0FF', text: '#2A4A6A', sub: '#6A8AAA', border: 'rgba(0,0,0,0.08)' },
  blush:    { mint: '#FFBBBB', mint2: '#F0A0B0', bg: '#FFF5F5', surface: '#ffffff', userBubble: '#FFD8E0', text: '#5A2A3A', sub: '#9A7A88', border: 'rgba(0,0,0,0.08)' },
  lavender: { mint: '#F0BBFF', mint2: '#DDA0EE', bg: '#FDF5FF', surface: '#ffffff', userBubble: '#E8D0FF', text: '#4A2A5A', sub: '#8A6A9A', border: 'rgba(0,0,0,0.08)' },
  white:    { mint: '#E8E8E8', mint2: '#CCCCCC', bg: '#FFFFFF', surface: '#F8F8F8', userBubble: '#DDDDDD', text: '#3D5A52', sub: '#7BA898', border: 'rgba(0,0,0,0.12)' },
  dark:     { mint: '#252525', mint2: '#333333', bg: '#111111', surface: '#1A1A1A', userBubble: '#1E3838', text: '#EEEEEE', sub: '#888888', border: 'rgba(255,255,255,0.1)' }
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
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.mint)
}
