/**
 * 薄殼：抓取邏輯搬到 `core/news/readerFetch.ts`（B1 抽 core，
 * 見 `docs/news-standalone-kickoff.md` §4 步驟④）。
 * 桌面固定綁 `electronHttp`／`electronRssParser`／`electronStorage`，
 * 對外函式簽章不變，`ipc.ts`／`mobileRoutes.ts` 都不用改。
 */
import * as core from '../../../core/news/readerFetch'
import { electronHttp } from '../../adapters/httpAdapter'
import { electronRssParser } from '../../adapters/rssParseAdapter'
import { electronStorage } from '../../adapters/storageAdapter'

export type {
  ReaderFetchRequest,
  ReaderBatchRequest,
  ReaderSectionRequest,
  ReaderSettingsSnapshot,
  ReaderFetchResult
} from '../../../core/news/readerFetch'

const deps: core.ReaderFetchDeps = { http: electronHttp, rss: electronRssParser, storage: electronStorage }

export function fetchReaderBatch(req?: core.ReaderBatchRequest): Promise<core.ReaderFetchResult> {
  return core.fetchReaderBatch(deps, req)
}

export function fetchReaderSection(req?: core.ReaderSectionRequest): Promise<core.ReaderFetchResult> {
  return core.fetchReaderSection(deps, req)
}
