/**
 * 薄殼：實際抓取／解析邏輯搬到 `core/news/sources.ts`（B1 抽 core，
 * 見 `docs/news-standalone-kickoff.md` §3.1／步驟②）。
 * 桌面固定綁 `electronHttp` ＋ `electronRssParser`，維持既有呼叫端
 * （`readerFetch.ts`／`ipc.ts`／`trigger.ts`）不用改參數。
 */
import type { NewsItem, NewsModuleSettings, NewsSelectionContext, NewsSource } from './types'
import * as core from '../../../core/news/sources'
import { electronHttp } from '../../adapters/httpAdapter'
import { electronRssParser } from '../../adapters/rssParseAdapter'

const deps: core.NewsSourceDeps = { http: electronHttp, rss: electronRssParser }

export const clearNewsCache = core.clearNewsCache
export const buildKeywordRssUrl = core.buildKeywordRssUrl
export const buildTrendsRssUrl = core.buildTrendsRssUrl

export function fetchSource(source: NewsSource, options: { useCache?: boolean } = {}): Promise<NewsItem[]> {
  return core.fetchSource(deps, source, options)
}

export function fetchBreakoutItems(
  weight: NewsSource['weight'],
  options: { zhOnly?: boolean } = {}
): Promise<NewsItem[]> {
  return core.fetchBreakoutItems(deps, weight, options)
}

export function fetchAllSources(
  settings: NewsModuleSettings,
  options: { useCache?: boolean } = {},
  ctx: NewsSelectionContext = {}
): Promise<NewsItem[]> {
  return core.fetchAllSources(deps, settings, options, ctx)
}
