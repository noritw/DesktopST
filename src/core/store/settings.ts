/**
 * 設定的載入與存檔轉換（B2.7）。
 *
 * 這是 `fileStore.loadSettings` 裡那 130 行編排的核心，也是最會靜默出錯的一塊
 * （設定遷移寫歪不會有錯誤訊息，使用者只會發現設定跑掉）。搬進 core 讓桌面與
 * 手機共用同一份，避免 drift（roadmap §4.1）。
 *
 * **不碰 I/O**：檔案由平台層讀好後傳進來，該回寫什麼由回傳值告知
 * （roadmap §4.4b：core 收已讀好的資料、不自己讀檔）。
 * 因此這裡沒有同步／非同步的問題 —— 桌面照舊同步、手機照舊非同步。
 */

import type { AppSettings, PersonaPreset, PinnedNote, RemoteControlSettings, WorldPreset } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import type { SecretAdapter } from '../adapters'
import { SECRET_PREFIX } from '../adapters'
import { isPinnedNote, renameModelId, renameModelIdMap } from './normalize'
import type { MigrateDeps } from './migrate'
import { migrateLegacySettings, needsLegacyMigration } from './migrate'

export interface HydrateSettingsDeps {
  secrets: SecretAdapter
  migrate: MigrateDeps
  /**
   * 由平台層決定 `remoteControl` 的最終值（桌面會另外存成獨立的模組設定檔）。
   * 收到的是 settings.json 裡的舊值，可能為 undefined。
   */
  resolveRemoteControl(legacy: RemoteControlSettings | undefined): RemoteControlSettings
}

export interface HydrateSettingsResult {
  settings: AppSettings
  /** 需要把 settings 回寫一次（跑過遷移、或有明文金鑰要改存加密）。 */
  needsResave: boolean
  /** 便利貼是從舊 settings 欄位搬出來的，需要另存成 pinned-notes 檔。 */
  shouldSavePinnedNotes: boolean
  /** 舊欄位遷移產生、待平台層存檔的 preset。 */
  personaToSave: PersonaPreset | null
  worldToSave: WorldPreset | null
  /** 解密失敗、需要保留原密文以免被空字串覆寫的欄位。 */
  apiKeyFallbacksToSet: Record<string, string>
  /** 解密成功、應清掉既有 fallback 的欄位。 */
  apiKeyFallbacksToDelete: string[]
}

/**
 * 把讀進來的 raw settings 補齊成完整的 `AppSettings`。
 *
 * ⚠️ 會就地修改 `raw`（舊欄位遷移會刪掉 `persona` 等），呼叫端不要重複使用它。
 */
export function hydrateSettings(
  raw: Record<string, unknown> | null,
  pinnedNotesFromFile: PinnedNote[],
  deps: HydrateSettingsDeps
): HydrateSettingsResult {
  const s = raw && typeof raw === 'object' ? raw : {} as Record<string, unknown>

  const needsMigration = needsLegacyMigration(s)

  let migratedPersonaId = ''
  let migratedWorldId = ''
  let personaToSave: PersonaPreset | null = null
  let worldToSave: WorldPreset | null = null
  if (needsMigration) {
    const result = migrateLegacySettings(s, deps.migrate)
    migratedPersonaId = result.migratedPersonaId
    migratedWorldId = result.migratedWorldId
    personaToSave = result.personaToSave
    worldToSave = result.worldToSave
  }

  const typed = s as Partial<AppSettings>
  const hasLegacyPinnedNotesField = !!typed.ui && Object.prototype.hasOwnProperty.call(typed.ui, 'pinnedNotes')
  const legacyPinnedNotes = Array.isArray(typed.ui?.pinnedNotes) ? typed.ui.pinnedNotes.filter(isPinnedNote) : []
  const shouldMigratePinnedNotes = pinnedNotesFromFile.length === 0 && legacyPinnedNotes.length > 0
  const pinnedNotes = shouldMigratePinnedNotes ? legacyPinnedNotes : pinnedNotesFromFile
  const remoteControl = deps.resolveRemoteControl(typed.remoteControl)

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...typed,
    activePersonaId: typed.activePersonaId || migratedPersonaId || '',
    activeWorldId: typed.activeWorldId || migratedWorldId || '',
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...typed.llm,
      // Migrate: 官方改名／下架的模型 ID 自動換成現行 ID
      model: renameModelId(typed.llm?.model) ?? DEFAULT_SETTINGS.llm.model,
      models: renameModelIdMap(typed.llm?.models) ?? DEFAULT_SETTINGS.llm.models,
      utilityModels: renameModelIdMap(typed.llm?.utilityModels) ?? DEFAULT_SETTINGS.llm.utilityModels,
      // Migrate: if apiKeys missing but legacy apiKey exists, seed openai key
      apiKeys: typed.llm?.apiKeys ?? {
        openai: typed.llm?.apiKey ?? '',
        claude: '',
        gemini: '',
        grok: ''
      }
    },
    memory: {
      ...DEFAULT_SETTINGS.memory,
      ...typed.memory
    },
    remoteControl,
    ui: {
      ...DEFAULT_SETTINGS.ui,
      ...typed.ui,
      pinnedNotes,
      desktopCharacters: (typed.ui?.desktopCharacters ?? DEFAULT_SETTINGS.ui.desktopCharacters).map(dc => ({
        ...dc,
        flipped: !!dc?.flipped
      })),
      ...((() => {
        const rawUi = typed.ui
        const hadOnboardingKey = !!(rawUi && Object.prototype.hasOwnProperty.call(rawUi, 'onboardingCompleted'))
        // If the key doesn't exist in saved settings (legacy/first-run), default to false
        // so onboarding screen appears. Never automatically skip onboarding.
        return !hadOnboardingKey ? { onboardingCompleted: false as const } : {}
      })())
    }
  }

  // Detect plaintext keys that need migration to encrypted storage
  const rawApiKeys = typed.llm?.apiKeys ?? {}
  const needsKeyMigration = Object.values(rawApiKeys).some(
    v => typeof v === 'string' && v.trim() && !v.startsWith(SECRET_PREFIX)
  )

  const apiKeyFallbacksToSet: Record<string, string> = {}
  const apiKeyFallbacksToDelete: string[] = []

  // Decrypt API keys for in-memory use
  // If decryption fails, secrets.decrypt returns the original 'enc:v1:...' string.
  // We convert those to '' so the UI shows an empty field (prompting re-entry)
  // instead of showing the garbage encrypted blob which users tend to clear and save,
  // accidentally destroying the stored value.
  // The encrypted blob is preserved in the fallbacks so settings:save
  // can write it back when the renderer sends '' without the user explicitly clearing it.
  for (const k of Object.keys(settings.llm.apiKeys)) {
    const stored = settings.llm.apiKeys[k] ?? ''
    const decrypted = deps.secrets.decrypt(stored)
    if (decrypted.startsWith(SECRET_PREFIX)) {
      apiKeyFallbacksToSet[k] = decrypted
      settings.llm.apiKeys[k] = ''
    } else {
      apiKeyFallbacksToDelete.push(k)
      settings.llm.apiKeys[k] = decrypted
    }
  }

  // Decrypt CWA API Key (same pattern as LLM keys)
  const rq = settings.weather?.realtimeQuery
  if (rq?.cwaApiKey) {
    const decrypted = deps.secrets.decrypt(rq.cwaApiKey)
    if (decrypted.startsWith(SECRET_PREFIX)) {
      apiKeyFallbacksToSet['cwaApiKey'] = decrypted
      rq.cwaApiKey = ''
    } else {
      apiKeyFallbacksToDelete.push('cwaApiKey')
      rq.cwaApiKey = decrypted
    }
  }

  return {
    settings,
    needsResave: needsMigration || hasLegacyPinnedNotesField || needsKeyMigration,
    shouldSavePinnedNotes: shouldMigratePinnedNotes,
    personaToSave,
    worldToSave,
    apiKeyFallbacksToSet,
    apiKeyFallbacksToDelete
  }
}

/**
 * 設定寫檔前的轉換：加密金鑰、剝掉存在別處的欄位。
 *
 * 回傳的是**新物件**，不動傳入的 settings（那是記憶體裡正在用的那份）。
 * `pinnedNotes` 與 `remoteControl` 由平台層另外存檔，故此處移除。
 */
export function toPersistedSettings(settings: AppSettings, secrets: SecretAdapter): AppSettings {
  const encryptedApiKeys: Record<string, string> = {}
  for (const [k, v] of Object.entries(settings.llm.apiKeys)) {
    encryptedApiKeys[k] = secrets.encrypt(v)
  }
  const persisted: AppSettings = {
    ...settings,
    llm: { ...settings.llm, apiKeys: encryptedApiKeys },
    ui: { ...settings.ui }
  }
  // Encrypt CWA API Key before persisting
  if (persisted.weather?.realtimeQuery) {
    persisted.weather = {
      ...persisted.weather,
      realtimeQuery: {
        ...persisted.weather.realtimeQuery,
        cwaApiKey: secrets.encrypt(persisted.weather.realtimeQuery.cwaApiKey)
      }
    }
  }
  delete persisted.ui.pinnedNotes
  delete persisted.remoteControl
  return persisted
}
