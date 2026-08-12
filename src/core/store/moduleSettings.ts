/**
 * 模組設定的儲存位置與讀寫（B1 抽 core，news-standalone-kickoff §3.2／步驟①）。
 *
 * 桌面（`main/modules/moduleSettings.ts`）與手機（`mobile/data/localDataSource.ts`）
 * 都要用同一套 key 佈局 `modules/<moduleId>/settings.json`，
 * 否則同一份資料在兩個平台叫不同名字，S2 同步與搬家包會對不起來。
 *
 * 桌面既有呼叫端都是同步的（IPC handler 裡直接呼叫，沒有 await），
 * 所以這裡同時提供同步版（給 `SyncStorageAdapter`，桌面沿用）與
 * 非同步版（給 `StorageAdapter`，手機獨立版新寫的路徑用）。
 */
import type { StorageAdapter, SyncStorageAdapter } from '../adapters/storage'
import { MODULES_DIR } from './keys'

export function moduleSettingsKey(moduleId: string): string {
  return `${MODULES_DIR}/${moduleId}/settings.json`
}

/** 模組自有資料檔（settings.json 以外），例如新聞報的釘選／已讀清單。 */
export function moduleDataKey(moduleId: string, fileName: string): string {
  return `${MODULES_DIR}/${moduleId}/${fileName}`
}

// ── 同步版：桌面沿用 ─────────────────────────────────────────

export function hasModuleSettingsSync(adapter: SyncStorageAdapter, moduleId: string): boolean {
  return adapter.existsSync(moduleSettingsKey(moduleId))
}

export function readModuleSettingsSync<T>(adapter: SyncStorageAdapter, moduleId: string): T | undefined {
  return adapter.readJsonSync<T>(moduleSettingsKey(moduleId)) ?? undefined
}

export function writeModuleSettingsSync<T>(adapter: SyncStorageAdapter, moduleId: string, value: T): void {
  adapter.writeJsonSync(moduleSettingsKey(moduleId), value)
}

export function hasModuleDataSync(adapter: SyncStorageAdapter, moduleId: string, fileName: string): boolean {
  return adapter.existsSync(moduleDataKey(moduleId, fileName))
}

export function readModuleDataSync<T>(adapter: SyncStorageAdapter, moduleId: string, fileName: string): T | undefined {
  return adapter.readJsonSync<T>(moduleDataKey(moduleId, fileName)) ?? undefined
}

export function writeModuleDataSync<T>(adapter: SyncStorageAdapter, moduleId: string, fileName: string, value: T): void {
  adapter.writeJsonSync(moduleDataKey(moduleId, fileName), value)
}

// ── 非同步版：手機獨立版新路徑用 ────────────────────────────────

export async function hasModuleSettings(adapter: StorageAdapter, moduleId: string): Promise<boolean> {
  return adapter.exists(moduleSettingsKey(moduleId))
}

export async function readModuleSettings<T>(adapter: StorageAdapter, moduleId: string): Promise<T | undefined> {
  const value = await adapter.readJson<T>(moduleSettingsKey(moduleId))
  return value ?? undefined
}

export async function writeModuleSettings<T>(adapter: StorageAdapter, moduleId: string, value: T): Promise<void> {
  await adapter.writeJson(moduleSettingsKey(moduleId), value)
}

export async function hasModuleData(adapter: StorageAdapter, moduleId: string, fileName: string): Promise<boolean> {
  return adapter.exists(moduleDataKey(moduleId, fileName))
}

export async function readModuleData<T>(adapter: StorageAdapter, moduleId: string, fileName: string): Promise<T | undefined> {
  const value = await adapter.readJson<T>(moduleDataKey(moduleId, fileName))
  return value ?? undefined
}

export async function writeModuleData<T>(adapter: StorageAdapter, moduleId: string, fileName: string, value: T): Promise<void> {
  await adapter.writeJson(moduleDataKey(moduleId, fileName), value)
}
