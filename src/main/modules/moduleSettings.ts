import type { ModuleSettingsBridge } from './moduleTypes'
import { electronStorage } from '../adapters/storageAdapter'
import * as core from '../../core/store/moduleSettings'

/**
 * 薄殼：實際的 key 佈局與讀寫邏輯在 `core/store/moduleSettings.ts`
 * （B1 抽 core，見 `docs/news-standalone-kickoff.md` §3.2／步驟①）。
 *
 * `electronStorage` 每次呼叫都重新取 `getDataDir()`，資料夾搬家後自動生效，
 * 不再需要 `configureModuleSettingsRoot` 這種另外快取根目錄的機制。
 */

export function hasModuleSettings(moduleId: string): boolean {
  return core.hasModuleSettingsSync(electronStorage, moduleId)
}

export function readModuleSettings<T>(moduleId: string): T | undefined {
  return core.readModuleSettingsSync<T>(electronStorage, moduleId)
}

export function writeModuleSettings<T>(moduleId: string, value: T): void {
  core.writeModuleSettingsSync(electronStorage, moduleId, value)
}

export const moduleSettingsBridge: ModuleSettingsBridge = {
  get: readModuleSettings,
  set: writeModuleSettings
}

// ── 模組自有資料檔（settings.json 以外）──────────────────────
// 給「不是設定、但要跟著資料夾搬家」的東西用，例如新聞報的釘選 / 已讀清單。
// 與 settings.json 分開，才不會被設定正規化剪掉，也不會被搬家包帶走。

export function hasModuleData(moduleId: string, fileName: string): boolean {
  return core.hasModuleDataSync(electronStorage, moduleId, fileName)
}

export function readModuleData<T>(moduleId: string, fileName: string): T | undefined {
  return core.readModuleDataSync<T>(electronStorage, moduleId, fileName)
}

export function writeModuleData<T>(moduleId: string, fileName: string, value: T): void {
  core.writeModuleDataSync(electronStorage, moduleId, fileName, value)
}
