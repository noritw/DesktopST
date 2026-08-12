/**
 * 薄殼：實際邏輯搬到 `core/news/readerState.ts`（B1 抽 core，
 * 見 `docs/news-standalone-kickoff.md` §4 步驟③）。
 */
import { electronStorage } from '../../adapters/storageAdapter'
import * as core from '../../../core/news/readerState'
import type { NewsReaderState } from '../../../core/news/readerState'

export type { NewsReaderState }

export function hasNewsReaderState(): boolean {
  return core.hasNewsReaderStateSync(electronStorage)
}

export function loadNewsReaderState(): NewsReaderState {
  return core.loadNewsReaderStateSync(electronStorage)
}

export function saveNewsReaderPinned(items: unknown): NewsReaderState {
  return core.saveNewsReaderPinnedSync(electronStorage, items)
}

export function saveNewsReaderDismissed(ids: unknown): NewsReaderState {
  return core.saveNewsReaderDismissedSync(electronStorage, ids)
}

/** 兩項一起寫（首次從 localStorage 搬移時用，省一次來回） */
export function saveNewsReaderState(state: Partial<NewsReaderState>): NewsReaderState {
  return core.saveNewsReaderStateSync(electronStorage, state)
}
