/**
 * 薄殼：新聞進 Prompt 的 enrichment 本體搬到 `core/news/enrich.ts`（B1 抽 core，
 * 見 `docs/news-standalone-kickoff.md` §4 步驟⑥）。桌面固定綁 `electronHttp`／
 * `electronStorage`，對外函式簽章不變，`ipc.ts`／`mobileRoutes.ts`／`trigger.ts`
 * 都不用改。
 */
import * as core from '../../../core/news/enrich'
import { electronHttp } from '../../adapters/httpAdapter'
import { electronStorage } from '../../adapters/storageAdapter'
import type { NewsItem, NewsModuleSettings } from './types'
import type { AppSettings } from '../../types'

export {
  clearNewsEnrichCache,
  cacheManualPromptContext,
  isGoogleNewsArticleUrl,
  extractArticleText,
  applyEnrichToItem
} from '../../../core/news/enrich'
export type { EnrichNewsResult } from '../../../core/news/enrich'

const deps: core.EnrichDeps = { http: electronHttp, storage: electronStorage }

export function resolveGoogleNewsArticleUrl(articleUrl: string): Promise<string | null> {
  return core.resolveGoogleNewsArticleUrl(electronHttp, articleUrl)
}

export function resolveFetchUrl(url: string): Promise<{ url: string; viaGoogleNews: boolean }> {
  return core.resolveFetchUrl(electronHttp, url)
}

export interface EnrichNewsOptions {
  forceRefresh?: boolean
  settings?: NewsModuleSettings
  appSettings?: AppSettings
}

export function enrichNewsForChat(item: NewsItem, options: EnrichNewsOptions = {}): Promise<core.EnrichNewsResult> {
  return core.enrichNewsForChat(deps, item, options)
}
