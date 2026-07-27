/**
 * readerState.ts
 * 個人新聞報的「內容狀態」：釘選的新聞、不想再看到的新聞 id。
 *
 * 為什麼放主程序而不是 renderer 的 localStorage：
 * 桌面視窗與手機是兩個不同的瀏覽器環境，localStorage 不共用。
 * 釘選與「這則不要看了」屬於內容狀態（在哪台裝置操作都該算數），所以集中在這裡。
 *
 * 顯示模式（標題／標題＋摘要）與目前分頁刻意**不**放進來——那是每台裝置各自的 UI 偏好，
 * 共用反而會讓桌機畫面在手機操作時跟著跳走。那兩項留在各自的 localStorage。
 */

import { hasModuleData, readModuleData, writeModuleData } from '../moduleSettings'
import { NEWS_MODULE_ID } from './settings'
import type { NewsItem } from './types'

const READER_STATE_FILE = 'reader-state.json'

/** 與 renderer 端一致的上限，避免無限增長 */
const MAX_DISMISSED = 500

export interface NewsReaderState {
  pinnedItems: NewsItem[]
  dismissedIds: string[]
}

function normalizeItems(value: unknown): NewsItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((it): it is NewsItem =>
    !!it && typeof it === 'object' &&
    typeof (it as NewsItem).id === 'string' &&
    typeof (it as NewsItem).title === 'string'
  )
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(-MAX_DISMISSED)
}

/** 這台機器是否已經有共用狀態檔（false = renderer 端該把舊的 localStorage 內容搬上來） */
export function hasNewsReaderState(): boolean {
  return hasModuleData(NEWS_MODULE_ID, READER_STATE_FILE)
}

export function loadNewsReaderState(): NewsReaderState {
  const raw = readModuleData<Partial<NewsReaderState>>(NEWS_MODULE_ID, READER_STATE_FILE)
  return {
    pinnedItems: normalizeItems(raw?.pinnedItems),
    dismissedIds: normalizeIds(raw?.dismissedIds)
  }
}

function save(state: NewsReaderState): NewsReaderState {
  writeModuleData(NEWS_MODULE_ID, READER_STATE_FILE, state)
  return state
}

export function saveNewsReaderPinned(items: unknown): NewsReaderState {
  const current = loadNewsReaderState()
  return save({ ...current, pinnedItems: normalizeItems(items) })
}

export function saveNewsReaderDismissed(ids: unknown): NewsReaderState {
  const current = loadNewsReaderState()
  return save({ ...current, dismissedIds: normalizeIds(ids) })
}

/** 兩項一起寫（首次從 localStorage 搬移時用，省一次來回） */
export function saveNewsReaderState(state: Partial<NewsReaderState>): NewsReaderState {
  const current = loadNewsReaderState()
  return save({
    pinnedItems: state.pinnedItems !== undefined ? normalizeItems(state.pinnedItems) : current.pinnedItems,
    dismissedIds: state.dismissedIds !== undefined ? normalizeIds(state.dismissedIds) : current.dismissedIds
  })
}
