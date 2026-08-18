/**
 * 平台 adapter 介面總集（B2）。
 *
 * `core/` 的邏輯一律透過這些介面碰外界，不直接碰 `fs` / `electron` / 平台 API。
 * 桌面版實作在 `src/main/adapters/`，手機版未來實作在 `src/mobile/adapters/`。
 *
 * 使用方式：需要平台能力的 core 函式**用參數收 adapter**，不要用模組層單例。
 * 單例會讓同一個 process 內無法有兩份設定，也讓測試無法替換。
 *
 *   export async function loadCharacters(storage: StorageAdapter): Promise<Character[]>
 *
 * 若某個流程要用到很多個，收一包 `PlatformAdapters` 即可。
 */
export type { StorageAdapter, SyncStorageAdapter } from './storage'
export type { SecretAdapter } from './secrets'
export { SECRET_PREFIX } from './secrets'
export type { HttpAdapter } from './http'
export type { SchedulerAdapter } from './scheduler'
export type { NotifierAdapter, NotifyOptions } from './notifier'
export type { HealthAdapter, HealthSnapshot } from './health'

import type { StorageAdapter } from './storage'
import type { SecretAdapter } from './secrets'
import type { HttpAdapter } from './http'
import type { SchedulerAdapter } from './scheduler'
import type { NotifierAdapter } from './notifier'

/** 一整包平台能力。流程層（如聊天、提醒）用這個收。 */
export interface PlatformAdapters {
  storage: StorageAdapter
  secrets: SecretAdapter
  http: HttpAdapter
  scheduler: SchedulerAdapter
  notifier: NotifierAdapter
}
