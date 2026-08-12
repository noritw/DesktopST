/**
 * 薄殼：正規化與讀寫本體搬到 `core/news/settings.ts`（B1 抽 core，
 * 見 `docs/news-standalone-kickoff.md` §4 步驟④／⑤）。
 * 桌面固定綁 `electronStorage`，維持既有呼叫端（`ipcHandlers.ts`／
 * `readerFetch.ts`／`mobileRoutes.ts`…）不用改參數。
 */
import { electronStorage } from '../../adapters/storageAdapter'
import * as core from '../../../core/news/settings'
import type { NewsModuleSettings } from './types'

export {
  NEWS_MODULE_ID,
  DEFAULT_KEYWORD_GROUP_ID,
  effectiveGroupId,
  keywordSourceInGroup,
  keywordSourceInReaderGroups,
  weightToValue,
  resolveReaderKeywordGroupIds,
  readerSelectionContext,
  defaultNewsModuleSettings,
  normalizeNewsModuleSettings
} from '../../../core/news/settings'

export function hasNewsModuleSettings(): boolean {
  return core.hasNewsModuleSettingsSync(electronStorage)
}

export function loadNewsModuleSettings(): NewsModuleSettings {
  return core.loadNewsModuleSettingsSync(electronStorage)
}

export function saveNewsModuleSettings(settings: Partial<NewsModuleSettings>): NewsModuleSettings {
  return core.saveNewsModuleSettingsSync(electronStorage, settings)
}

export function applyNewsFeedbackDelta(sourceId: string, delta: number): void {
  core.applyNewsFeedbackDeltaSync(electronStorage, sourceId, delta)
}
