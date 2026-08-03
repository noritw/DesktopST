/**
 * 對話存檔前的剪枝（B2.7）。純函式，就地修改傳入的 conversation。
 */

import type { Conversation } from '../types'

/** 新聞原文連結保留則數：只有最近幾則新聞發話訊息事後從對話記錄重開時還能看到連結卡與互動按鈕。 */
export const NEWS_LINK_KEEP_N = 5

/**
 * 只保留最近 keepN 則訊息的完整 debug prompt，較舊的剪掉以減輕 Log 載入負擔。
 * 就地修改 conv.messages：視窗內有 debug 的標 hasDebugPrompt=true，視窗外的刪 debug 並標 false。
 * keepN <= 0 代表全部剪掉。
 */
export function pruneConversationDebugPrompts(conv: Conversation, keepN: number): void {
  const msgs = conv.messages
  const threshold = msgs.length - Math.max(0, keepN)
  // 新聞 debug 只保留最近 1 則（避免對話檔膨脹）
  const newsThreshold = msgs.length - 1
  // 新聞原文連結只保留最近幾則，供事後從對話記錄重開泡泡時使用（更早的訊息視同「已無視＝沒興趣」，不再保留可互動連結）
  const newsLinkThreshold = msgs.length - NEWS_LINK_KEEP_N
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    // ── 主要 / 輔助 / 對話搜尋 LLM debug ──
    const hasDebug = !!(m.debugPrompt || m.utilityDebugPrompt || m.convSearchDebugPrompt)
    if (i >= threshold && hasDebug) {
      m.hasDebugPrompt = true
    } else if (m.debugPrompt || m.utilityDebugPrompt || m.convSearchDebugPrompt || m.hasDebugPrompt) {
      delete m.debugPrompt
      delete m.utilityDebugPrompt
      delete m.convSearchDebugPrompt
      delete m.convSearchInputTokens
      delete m.convSearchOutputTokens
      m.hasDebugPrompt = false
    }
    // ── 新聞 debug（最近 1 則）──
    if (i >= newsThreshold && m.newsDebug) {
      m.hasNewsDebug = true
    } else if (m.newsDebug || m.hasNewsDebug) {
      delete m.newsDebug
      m.hasNewsDebug = false
    }
    // ── 新聞原文連結（最近 NEWS_LINK_KEEP_N 則）──
    if (i < newsLinkThreshold && m.newsLink) {
      delete m.newsLink
    }
  }
}
