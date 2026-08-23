import type { ColorTheme } from '@core/types'

/**
 * 12 種色彩主題（清單 G1）——**色值的唯一真相**。
 *
 * 原本住在 `src/mobile/ui/theme.ts`；2026-08-23 搬到 `shared/` 是因為
 * **飲食記錄 App 的桌面小工具也要用同一組配色**（owner 要求，見
 * `docs/mobile-android-widget-plan.md` §14.2），而那個 App 只吃得到
 * `@core` 與 `@shared` 兩個 alias，碰不到 `src/mobile/`。
 * 抄一份過去就是計畫書再三警告的那種雙邊定義漂移，所以改成搬到共用層。
 * `src/mobile/ui/theme.ts` 仍然 re-export 這裡的東西，既有的 import 不用動。
 *
 * 變數命名沿用 `--mint` 系列，**刻意不與桌面的 `--color-mint` 系列統一**：
 * 桌面那套是 `src/renderer/src/styles/theme.css` 的資產，
 * CLAUDE.md 明訂視覺修改只動那幾個檔。兩套各自獨立，不互相牽動，
 * 但**色值要對齊**——同一個主題在電腦與手機上看起來必須是同一個主題。
 *
 * 深色三組（dark／sepia／cyber）的 `surface` 比桌面再亮一階，理由見 `dark` 的註解。
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

  /** 森林：葉綠＋嫩芽黃。底色帶暖黃，與 `mint` 那組偏藍綠的冷白刻意分開。 */
  forest:   { mint: '#CBE8A6', mint2: '#A6D179', bg: '#F5FAEE', surface: '#ffffff', userBubble: '#E6F3CC', text: '#2F4A26', sub: '#6B8A57', border: 'rgba(0,0,0,0.08)', ...LIGHT_DANGER },

  /** 純白：無彩度。原本 text／sub 還是薄荷綠系，切過來看得出殘留的綠。 */
  white:    { mint: '#E8E8E8', mint2: '#CFCFCF', bg: '#FFFFFF', surface: '#F7F7F7', userBubble: '#E4E4E4', text: '#2B2B2B', sub: '#767676', border: 'rgba(0,0,0,0.12)', ...LIGHT_DANGER },

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
   *
   * 使用者泡泡原本是 `#24443F`（帶綠），與「無彩度」的定位不合，已改中性灰。
   */
  dark:     { mint: '#2E2E2E', mint2: '#3A3A3A', bg: '#121212', surface: '#242424', userBubble: '#2C2C2C', text: '#EEEEEE', sub: '#9A9A9A', border: 'rgba(255,255,255,0.14)', danger: '#8A3A3A', dangerText: '#FFDCDC' },

  /** 復古：舊紙、紅茶、木質。暖色低飽和，主文字用米紙白而不是純白。 */
  sepia:    { mint: '#3A2C22', mint2: '#56402F', bg: '#1A1512', surface: '#2A231D', userBubble: '#33281F', text: '#ECE0CC', sub: '#A99479', border: 'rgba(255,255,255,0.12)', danger: '#B05744', dangerText: '#FFDCD2' },

  /**
   * 賽博：深綠＋深藍。**刻意不用純黑配霓虹字** —— 手機在暗處看那個組合，
   * 高飽和亮字的邊緣會發散、久看很累。所以底色抬到 `#0F1518`、
   * 主文字用帶灰的冷白，深綠深藍只當區塊底，明顯的彩度只出現在使用者泡泡。
   */
  cyber:    { mint: '#143A33', mint2: '#1B3A52', bg: '#0F1518', surface: '#1B242B', userBubble: '#143A33', text: '#DCE6E9', sub: '#8AA0AA', border: 'rgba(255,255,255,0.12)', danger: '#C2605E', dangerText: '#FFE2E0' }
}

export const THEME_IDS = Object.keys(THEMES) as ColorTheme[]

/**
 * 底色偏暗的三組。
 *
 * 用在「語意色要選哪一版」——例如飲食記錄 App 的「超標紅字／達標綠字」，
 * 淺色主題那組深紅深綠放到深色底上會糊掉，需要換一組亮一點的。
 * 這種判斷沒辦法從 `ThemeVars` 自動推（要算亮度又要處理邊界情況），
 * 手動列三個 id 反而準確又好懂。**新增深色主題時記得加進來。**
 */
export const DARK_THEME_IDS: ColorTheme[] = ['dark', 'sepia', 'cyber']

export function isDarkTheme(id: ColorTheme): boolean {
  return DARK_THEME_IDS.includes(id)
}

/** 主題名稱是 UI 文案，所以留在 shared／UI 層不進 core（roadmap §3.3）。 */
export const THEME_LABELS: Record<ColorTheme, string> = {
  mint: '薄荷',
  butter: '奶油',
  peach: '蜜桃',
  aqua: '水藍',
  sky: '天空',
  blush: '腮紅',
  lavender: '薰衣草',
  forest: '森林',
  white: '純白',
  dark: '黑白灰',
  sepia: '復古',
  cyber: '賽博'
}
