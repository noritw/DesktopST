/**
 * 個人新聞報的「內容狀態」：釘選的新聞、不想再看到的新聞 id（B1 抽 core，
 * news-standalone-kickoff §4 步驟③）。
 *
 * 為什麼跟設定分開存：釘選／不看了是**內容狀態**（在哪台裝置操作都該算數），
 * 桌機與手機共用同一份；顯示模式與目前分頁是各裝置的 UI 偏好，不進這裡。
 *
 * 桌面既有呼叫端是同步的，手機獨立版新路徑用非同步版；
 * 兩邊 key 佈局一致（`modules/desktopst.news/reader-state.json`），
 * 見 `core/store/moduleSettings.ts` 的說明。
 */
import type { StorageAdapter, SyncStorageAdapter } from '../adapters/storage'
import {
  hasModuleData,
  hasModuleDataSync,
  readModuleData,
  readModuleDataSync,
  writeModuleData,
  writeModuleDataSync
} from '../store/moduleSettings'
import type { NewsItem } from './types'
import { NEWS_MODULE_ID } from './moduleId'

export const READER_STATE_FILE = 'reader-state.json'

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

// ── 同步版：桌面沿用 ─────────────────────────────────────────

/** 這台機器是否已經有共用狀態檔（false = renderer 端該把舊的 localStorage 內容搬上來） */
export function hasNewsReaderStateSync(adapter: SyncStorageAdapter): boolean {
  return hasModuleDataSync(adapter, NEWS_MODULE_ID, READER_STATE_FILE)
}

export function loadNewsReaderStateSync(adapter: SyncStorageAdapter): NewsReaderState {
  const raw = readModuleDataSync<Partial<NewsReaderState>>(adapter, NEWS_MODULE_ID, READER_STATE_FILE)
  return {
    pinnedItems: normalizeItems(raw?.pinnedItems),
    dismissedIds: normalizeIds(raw?.dismissedIds)
  }
}

function saveSync(adapter: SyncStorageAdapter, state: NewsReaderState): NewsReaderState {
  writeModuleDataSync(adapter, NEWS_MODULE_ID, READER_STATE_FILE, state)
  return state
}

export function saveNewsReaderPinnedSync(adapter: SyncStorageAdapter, items: unknown): NewsReaderState {
  const current = loadNewsReaderStateSync(adapter)
  return saveSync(adapter, { ...current, pinnedItems: normalizeItems(items) })
}

export function saveNewsReaderDismissedSync(adapter: SyncStorageAdapter, ids: unknown): NewsReaderState {
  const current = loadNewsReaderStateSync(adapter)
  return saveSync(adapter, { ...current, dismissedIds: normalizeIds(ids) })
}

/** 兩項一起寫（首次從 localStorage 搬移時用，省一次來回） */
export function saveNewsReaderStateSync(adapter: SyncStorageAdapter, state: Partial<NewsReaderState>): NewsReaderState {
  const current = loadNewsReaderStateSync(adapter)
  return saveSync(adapter, {
    pinnedItems: state.pinnedItems !== undefined ? normalizeItems(state.pinnedItems) : current.pinnedItems,
    dismissedIds: state.dismissedIds !== undefined ? normalizeIds(state.dismissedIds) : current.dismissedIds
  })
}

// ── 非同步版：手機獨立版新路徑用 ────────────────────────────────

export async function hasNewsReaderState(adapter: StorageAdapter): Promise<boolean> {
  return hasModuleData(adapter, NEWS_MODULE_ID, READER_STATE_FILE)
}

export async function loadNewsReaderState(adapter: StorageAdapter): Promise<NewsReaderState> {
  const raw = await readModuleData<Partial<NewsReaderState>>(adapter, NEWS_MODULE_ID, READER_STATE_FILE)
  return {
    pinnedItems: normalizeItems(raw?.pinnedItems),
    dismissedIds: normalizeIds(raw?.dismissedIds)
  }
}

async function save(adapter: StorageAdapter, state: NewsReaderState): Promise<NewsReaderState> {
  await writeModuleData(adapter, NEWS_MODULE_ID, READER_STATE_FILE, state)
  return state
}

export async function saveNewsReaderPinned(adapter: StorageAdapter, items: unknown): Promise<NewsReaderState> {
  const current = await loadNewsReaderState(adapter)
  return save(adapter, { ...current, pinnedItems: normalizeItems(items) })
}

export async function saveNewsReaderDismissed(adapter: StorageAdapter, ids: unknown): Promise<NewsReaderState> {
  const current = await loadNewsReaderState(adapter)
  return save(adapter, { ...current, dismissedIds: normalizeIds(ids) })
}
