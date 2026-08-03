/**
 * 舊版 settings.json 的欄位遷移（B2.7）。
 *
 * 原本在 `main/fileStore.ts` 裡邊算邊存檔，搬進 core 後改成**純函式**：
 * 只回傳「該建立哪些 preset」，實際存檔由平台層負責（roadmap §4.4b：
 * core 收已讀好的資料、不自己讀寫檔）。
 *
 * ⚠️ 仍會**就地刪除** `raw` 上的舊欄位（`persona` / `worldSetting` /
 * `interactionExample`），這是刻意保留的原行為 —— 呼叫端接著會把 `raw`
 * 展開進新設定，不刪的話舊欄位會被一起帶進去。
 *
 * 文案（preset 名稱、暱稱預設值）一律由平台層傳入，core 不寫死中文（roadmap §3.3）。
 */

import type { LegacyAppSettings, PersonaPreset, WorldPreset } from '../types'

export interface MigrateLabels {
  /** 遷移出來的 Persona preset 名稱 */
  personaPresetName: string
  /** 遷移出來的 World preset 名稱 */
  worldPresetName: string
  /** 舊資料缺 displayName 時的替代值 */
  fallbackDisplayName: string
  /** 舊資料缺 nickname 時的替代值 */
  fallbackNickname: string
}

export interface MigrateDeps {
  newId: () => string
  now: () => number
  labels: MigrateLabels
}

export interface MigrateResult {
  migratedPersonaId: string
  migratedWorldId: string
  /** 平台層要寫入的 preset（core 不存檔）。 */
  personaToSave: PersonaPreset | null
  worldToSave: WorldPreset | null
}

/** 判斷這份 raw settings 是否需要跑舊欄位遷移。 */
export function needsLegacyMigration(raw: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(raw, 'persona') ||
    (Object.prototype.hasOwnProperty.call(raw, 'worldSetting') && typeof raw.worldSetting === 'string')
}

export function migrateLegacySettings(raw: Record<string, unknown>, deps: MigrateDeps): MigrateResult {
  let migratedPersonaId = ''
  let migratedWorldId = ''
  let personaToSave: PersonaPreset | null = null
  let worldToSave: WorldPreset | null = null

  const { labels } = deps
  const legacy = raw as unknown as LegacyAppSettings

  if (legacy.persona && typeof legacy.persona === 'object' && 'displayName' in legacy.persona) {
    const id = deps.newId()
    personaToSave = {
      id,
      name: labels.personaPresetName,
      displayName: legacy.persona.displayName ?? labels.fallbackDisplayName,
      nickname: legacy.persona.nickname ?? labels.fallbackNickname,
      description: legacy.persona.description ?? '',
      builtIn: false,
      createdAt: deps.now(),
      updatedAt: deps.now()
    }
    migratedPersonaId = id
    delete (raw as Record<string, unknown>).persona
  }

  if (typeof legacy.worldSetting === 'string' || typeof legacy.interactionExample === 'string') {
    const ws = typeof legacy.worldSetting === 'string' ? legacy.worldSetting : ''
    const ie = typeof legacy.interactionExample === 'string' ? legacy.interactionExample : ''
    if (ws.trim() || ie.trim()) {
      const id = deps.newId()
      worldToSave = {
        id,
        name: labels.worldPresetName,
        worldSetting: ws,
        interactionExample: ie,
        builtIn: false,
        createdAt: deps.now(),
        updatedAt: deps.now()
      }
      migratedWorldId = id
    }
    delete (raw as Record<string, unknown>).worldSetting
    delete (raw as Record<string, unknown>).interactionExample
  }

  return { migratedPersonaId, migratedWorldId, personaToSave, worldToSave }
}
