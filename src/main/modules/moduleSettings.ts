import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { ModuleSettingsBridge } from './moduleTypes'

const MODULES_DIR_NAME = 'modules'
const SETTINGS_FILE_NAME = 'settings.json'

let moduleSettingsRoot = path.join(app.getPath('userData'), 'DesktopST', MODULES_DIR_NAME)

export function configureModuleSettingsRoot(dataDir: string): void {
  moduleSettingsRoot = path.join(path.resolve(dataDir), MODULES_DIR_NAME)
}

function getModuleDir(moduleId: string): string {
  return path.join(moduleSettingsRoot, moduleId)
}

function getModuleSettingsFile(moduleId: string): string {
  return path.join(getModuleDir(moduleId), SETTINGS_FILE_NAME)
}

function ensureModuleDir(moduleId: string): void {
  const dir = getModuleDir(moduleId)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function hasModuleSettings(moduleId: string): boolean {
  return fs.existsSync(getModuleSettingsFile(moduleId))
}

export function readModuleSettings<T>(moduleId: string): T | undefined {
  const file = getModuleSettingsFile(moduleId)
  if (!fs.existsSync(file)) return undefined

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
    return raw as T
  } catch (e) {
    console.error(`[modules] read settings failed for ${moduleId}:`, e)
    return undefined
  }
}

export function writeModuleSettings<T>(moduleId: string, value: T): void {
  ensureModuleDir(moduleId)
  const file = getModuleSettingsFile(moduleId)
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8')
}

export const moduleSettingsBridge: ModuleSettingsBridge = {
  get: readModuleSettings,
  set: writeModuleSettings
}

// ── 模組自有資料檔（settings.json 以外）──────────────────────
// 給「不是設定、但要跟著資料夾搬家」的東西用，例如新聞報的釘選 / 已讀清單。
// 與 settings.json 分開，才不會被設定正規化剪掉，也不會被搬家包帶走。

export function hasModuleData(moduleId: string, fileName: string): boolean {
  return fs.existsSync(path.join(getModuleDir(moduleId), fileName))
}

export function readModuleData<T>(moduleId: string, fileName: string): T | undefined {
  const file = path.join(getModuleDir(moduleId), fileName)
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch (e) {
    console.error(`[modules] read data failed for ${moduleId}/${fileName}:`, e)
    return undefined
  }
}

export function writeModuleData<T>(moduleId: string, fileName: string, value: T): void {
  ensureModuleDir(moduleId)
  fs.writeFileSync(path.join(getModuleDir(moduleId), fileName), JSON.stringify(value, null, 2), 'utf-8')
}
