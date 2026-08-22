/**
 * 薄殼：對話新聞搜尋本體搬到 `core/news/conversationSearch.ts`（搬手機獨立版，
 * 2026-08-22）。桌面固定綁 `electronHttp`／`electronRssParser`，對外函式簽章
 * 不變，`ipcHandlers.ts` 不用改呼叫端。
 */
import * as core from '../../../core/news/conversationSearch'
import { electronHttp } from '../../adapters/httpAdapter'
import { electronRssParser } from '../../adapters/rssParseAdapter'
import type { AppSettings } from '../../types'
import type { NewsModuleSettings } from './types'

export type { ConversationSearchResult } from '../../../core/news/conversationSearch'
export { buildConversationSearchInjection } from '../../../core/news/conversationSearch'

const deps: core.ConversationSearchDeps = { http: electronHttp, rss: electronRssParser }

export function getConversationSearchContext(
  userMessage: string,
  settings: AppSettings,
  newsSettings: NewsModuleSettings
): Promise<core.ConversationSearchResult> {
  return core.getConversationSearchContext(deps, userMessage, settings, newsSettings)
}

/** `disasterNewsSupplement.ts` 直接打 Google News RSS（不經過觸發詞/LLM 萃取關卡）。 */
export function searchGoogleNewsRss(query: string, maxAgeHours: number): ReturnType<typeof core.searchGoogleNewsRss> {
  return core.searchGoogleNewsRss(deps, query, maxAgeHours)
}
