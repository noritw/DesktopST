import type { ColorTheme } from '@core/types'
import { THEMES } from '@shared/colorThemes'

/**
 * 手機端的主題套用。
 *
 * ⚠️ **色值本身在 `src/shared/colorThemes.ts`，不在這裡**（2026-08-23 搬過去的，
 * 理由見那份檔頭：飲食記錄 App 的小工具也要用同一組配色，而它碰不到
 * `src/mobile/`）。這裡只留「怎麼把主題套到 DOM 上」這件手機專屬的事，
 * 並 re-export 色表讓既有的 `import { THEMES } from '../theme'` 不用改。
 */

export type { ThemeVars } from '@shared/colorThemes'
export { THEMES, THEME_IDS, THEME_LABELS } from '@shared/colorThemes'

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
