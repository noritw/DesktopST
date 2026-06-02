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
