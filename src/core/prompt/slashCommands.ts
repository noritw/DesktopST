/**
 * 聊天輸入的斜線指令解析（`/news`／`/weather`）。
 *
 * 從 `main/ipcHandlers.ts` 抽出來的原因是**它原本會咬壞網址**
 * （2026-09-13 owner 貼新聞連結時實測發現）：
 *
 * ```
 * 原本：  content.replace(/\/news\b/gi, '')
 * 輸入：  https://news.cnyes.com/news/id/6551476
 * 輸出：  https:/.cnyes.com/id/6551476
 * ```
 *
 * 新聞網站的網址幾乎必然含 `/news`，所以連結閱讀一上線就整批中招——
 * 症狀是角色說「我看不懂這些網址」（它看到的真的是壞的），而且 `slashNews`
 * 被誤判成 true，每貼一次新聞連結就白花一次對話新聞搜尋的輔助模型呼叫。
 *
 * 修法：**斜線指令前面只能是開頭或空白**。`https://news…` 的 `/news` 前面是
 * `/`，不算指令；`今天 /news` 與行首的 `/news` 照樣認得。
 *
 * 搬到 `core/` 是為了測得到——`src/main/` 不在 vitest 範圍內。
 */

/** 指令前綴：開頭或空白（含換行）。用 `/news` 當路徑片段的網址因此不會中。 */
const SLASH_NEWS = /(^|\s)\/news\b/i
const SLASH_WEATHER = /(^|\s)\/weather\b/i

export interface SlashCommandParse {
  /** 使用者是否下了 `/news`（強制搜尋新聞） */
  news: boolean
  /** 使用者是否下了 `/weather`（強制查 CWA 天氣） */
  weather: boolean
  /** 指令文字移除後、要送進 prompt 的內容 */
  stripped: string
}

export function parseSlashCommands(content: string): SlashCommandParse {
  const news = SLASH_NEWS.test(content)
  const weather = SLASH_WEATHER.test(content)
  if (!news && !weather) return { news, weather, stripped: content }
  const stripped = content
    .replace(/(^|\s)\/news\b/gi, '$1')
    .replace(/(^|\s)\/weather\b/gi, '$1')
    .trim()
  return { news, weather, stripped }
}
