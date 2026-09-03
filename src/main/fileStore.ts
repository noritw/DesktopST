import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, DesktopCharacterState, PersonaPreset, WorldPreset, ScenePreset, PinnedNote, Reminder } from './types'
import type { WeatherWatchSnapshot } from '../core/weather'
import { normalizeWeatherWatchSnapshot } from '../core/weather'
import type { MorningBriefingSnapshot } from '../core/greeting'
import { normalizeMorningBriefingSnapshot } from '../core/greeting'
import type { CharacterDisplayConfigMap, FaceCropRect } from '../core/character/displayImage'
import { type Lorebook, normalizeLorebook } from '../core/lore'
import { DEFAULT_SETTINGS } from './types'
import { isPinnedNote } from '../core/store/normalize'
import { pruneConversationDebugPrompts } from '../core/store/prune'
import { stampCharacterNames, type NamedCharacter } from '../core/chat/characterName'
import { hydrateSettings, toPersistedSettings } from '../core/store/settings'
import * as keys from '../core/store/keys'
import { electronSecrets, electronStorage } from './adapters'
import { getDataDir, getDefaultDataDir, setDataDir, saveDataDirMeta } from './dataDir'
import { loadDstPackZip, readCharacterFromZip, extractCharacterDirFromZip } from './dstPack'
import {
  hasRemoteControlModuleSettings,
  loadRemoteControlModuleSettings,
  normalizeRemoteControlSettings,
  saveRemoteControlModuleSettings
} from './modules/remote-control'

/**
 * API Key 解密失敗時的暫存：key = provider name（openai/claude/…），value = 'enc:v1:...'
 * 防止 renderer 送回空字串時把加密值覆寫掉。
 */
export const encryptedApiKeyFallbacks = new Map<string, string>()
/**
 * 把 core 的平台無關 key（`'personas/abc.json'`）解析成本機絕對路徑。
 *
 * 一般的讀寫一律走 `electronStorage`（它內部做同一件事），
 * 這支只留給**需要真實路徑**的少數地方：debounce 寫檔、dstpack 解壓的目的地。
 */
function resolveKey(key: string): string {
  return path.join(getDataDir(), ...key.split('/'))
}

/** 從儲存 key（`'personas/abc.json'`）取出最後一段檔名。 */
function baseName(key: string): string {
  return key.split('/').pop() ?? ''
}

let SETTINGS_FILE = resolveKey(keys.SETTINGS_KEY)
let PINNED_NOTES_FILE = resolveKey(keys.PINNED_NOTES_KEY)

function refreshPaths(nextDir: string): void {
  setDataDir(nextDir)
  SETTINGS_FILE = resolveKey(keys.SETTINGS_KEY)
  PINNED_NOTES_FILE = resolveKey(keys.PINNED_NOTES_KEY)
  _dirsEnsured = false
  _scenesCache = null
}

let _dirsEnsured = false
let _scenesCache: ScenePreset[] | null = null

refreshPaths(getDataDir())

/**
 * 目錄預建。**蓄意留在平台層**：目錄不是 `StorageAdapter` 的概念
 * （手機沙箱不需要預建，寫入時自動建立），桌面則要讓使用者開得了資料夾。
 */
function ensureDirs() {
  if (_dirsEnsured) return
  _dirsEnsured = true
  for (const dir of [getDataDir(), ...keys.DATA_SUBDIRS.map(resolveKey)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadPinnedNotes(): PinnedNote[] {
  ensureDirs()
  const raw = electronStorage.readJsonSync<unknown>(keys.PINNED_NOTES_KEY)
  if (!Array.isArray(raw)) return []
  return raw.filter(isPinnedNote)
}

// ── Settings ──────────────────────────────────────────────

/** 遷移出來的 preset 名稱與暱稱預設值（core 不寫死中文，由此處傳入）。 */
const MIGRATE_LABELS = {
  personaPresetName: '我的設定',
  worldPresetName: '我的世界觀',
  fallbackDisplayName: '主人',
  fallbackNickname: '主人'
}

export function loadSettings(): AppSettings {
  ensureDirs()
  if (!electronStorage.existsSync(keys.SETTINGS_KEY)) {
    const remoteControl = saveRemoteControlModuleSettings(DEFAULT_SETTINGS.remoteControl!)
    return {
      ...DEFAULT_SETTINGS,
      remoteControl,
      ui: {
        ...DEFAULT_SETTINGS.ui,
        pinnedNotes: loadPinnedNotes()
      }
    }
  }
  try {
    // 刻意不用 readJsonSync：JSON 壞掉要走下面的 catch（保住磁碟上的舊檔），
    // 而「內容就是 null」要正常往下走 hydrateSettings。兩者不可收斂成同一個 null。
    const text = electronStorage.readTextSync(keys.SETTINGS_KEY)
    if (text === null) throw new Error('settings.json unreadable')
    const raw = JSON.parse(text) as Record<string, unknown> | null

    const result = hydrateSettings(raw, loadPinnedNotes(), {
      secrets: electronSecrets,
      migrate: { newId: uuidv4, now: () => Date.now(), labels: MIGRATE_LABELS },
      resolveRemoteControl: (legacy) => {
        const legacyRemoteControl = normalizeRemoteControlSettings({
          ...DEFAULT_SETTINGS.remoteControl!,
          ...legacy
        })
        return hasRemoteControlModuleSettings()
          ? loadRemoteControlModuleSettings() ?? legacyRemoteControl
          : saveRemoteControlModuleSettings(legacyRemoteControl)
      }
    })
    const settings = result.settings

    // 遷移出來的 preset 由平台層存檔（core 不碰 I/O）
    if (result.personaToSave) savePersonaPreset(result.personaToSave)
    if (result.worldToSave) saveWorldPreset(result.worldToSave)

    if (result.shouldSavePinnedNotes) {
      savePinnedNotes(settings.ui.pinnedNotes ?? [])
    }

    for (const [k, v] of Object.entries(result.apiKeyFallbacksToSet)) encryptedApiKeyFallbacks.set(k, v)
    for (const k of result.apiKeyFallbacksToDelete) encryptedApiKeyFallbacks.delete(k)

    _keepDebugPromptN = settings.memory.keepDebugPromptN

    if (result.needsResave) {
      saveSettings(settings)
    }

    return settings
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      ui: {
        ...DEFAULT_SETTINGS.ui,
        pinnedNotes: loadPinnedNotes()
      }
    }
  }
}

/**
 * ⚠️ 底下這幾支 debounce 寫檔**蓄意留在 fs**（B2.7 已定調 debounce 屬平台層）：
 * 它們手上是「呼叫當下就序列化好的字串」——這是刻意的，之後對話物件再怎麼被改動
 * 都不會影響已排程的那次寫入。`StorageAdapter` 收的是物件、由它自己序列化，
 * 改走 adapter 等於把序列化時機延到 timer 觸發時，語意會變。
 * 手機端的節流要另外寫一份，這不是可共用的邏輯。
 */
let _pendingSettingsJson: string | null = null
let _saveSettingsTimer: ReturnType<typeof setTimeout> | null = null
let _pendingPinnedNotesJson: string | null = null
let _savePinnedNotesTimer: ReturnType<typeof setTimeout> | null = null

export function savePinnedNotes(notes: PinnedNote[]): void {
  ensureDirs()
  _pendingPinnedNotesJson = JSON.stringify(Array.isArray(notes) ? notes.filter(isPinnedNote) : [], null, 2)
  if (_savePinnedNotesTimer) clearTimeout(_savePinnedNotesTimer)
  _savePinnedNotesTimer = setTimeout(() => {
    _savePinnedNotesTimer = null
    const json = _pendingPinnedNotesJson
    _pendingPinnedNotesJson = null
    if (json) fs.writeFile(PINNED_NOTES_FILE, json, 'utf-8', (err) => {
      if (err) console.error('[fileStore] savePinnedNotes failed:', err)
    })
  }, 150)
}

// ── Reminders ─────────────────────────────────────────────

export function loadReminders(): Reminder[] {
  const raw = electronStorage.readJsonSync<unknown>(keys.REMINDERS_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Reminder =>
      !!r && typeof r.id === 'string' && typeof r.label === 'string' && !!r.schedule
    )
    .map(r => {
      const s = r.schedule
      if (s.type === 'weekly' && (!Array.isArray(s.days) || s.days.length === 0)) {
        return { ...r, schedule: { ...s, days: [new Date().getDay()] } }
      }
      return r
    })
}

export function saveReminders(reminders: Reminder[]): void {
  ensureDirs()
  try {
    electronStorage.writeJsonSync(keys.REMINDERS_KEY, reminders)
  } catch (e) {
    console.error('[fileStore] saveReminders failed:', e)
  }
}

// ── 天氣主動發話：上次觀測快照（桌面限定，見 `core/store/keys.ts` 附註）─

export function loadWeatherWatchSnapshot(): WeatherWatchSnapshot {
  const raw = electronStorage.readJsonSync<unknown>(keys.WEATHER_WATCH_SNAPSHOT_KEY)
  return normalizeWeatherWatchSnapshot(raw)
}

export function saveWeatherWatchSnapshot(snapshot: WeatherWatchSnapshot): void {
  ensureDirs()
  try {
    electronStorage.writeJsonSync(keys.WEATHER_WATCH_SNAPSHOT_KEY, snapshot)
  } catch (e) {
    console.error('[fileStore] saveWeatherWatchSnapshot failed:', e)
  }
}

// ── 早安簡報：上次講過早安的日期快照（裝置本地狀態，見 `core/store/keys.ts` 附註）─

export function loadMorningBriefingSnapshot(): MorningBriefingSnapshot {
  const raw = electronStorage.readJsonSync<unknown>(keys.MORNING_BRIEFING_KEY)
  return normalizeMorningBriefingSnapshot(raw)
}

export function saveMorningBriefingSnapshot(snapshot: MorningBriefingSnapshot): void {
  ensureDirs()
  try {
    electronStorage.writeJsonSync(keys.MORNING_BRIEFING_KEY, snapshot)
  } catch (e) {
    console.error('[fileStore] saveMorningBriefingSnapshot failed:', e)
  }
}

// ── 日曆驅動提醒：未推送到手機旗標（§6，桌面限定裝置本地狀態）─────

export function loadCalendarSyncFlag(): boolean {
  const raw = electronStorage.readJsonSync<unknown>(keys.CALENDAR_SYNC_FLAG_KEY)
  return !!(raw && typeof raw === 'object' && (raw as { unsynced?: boolean }).unsynced)
}

export function saveCalendarSyncFlag(unsynced: boolean): void {
  ensureDirs()
  try {
    electronStorage.writeJsonSync(keys.CALENDAR_SYNC_FLAG_KEY, { unsynced })
  } catch (e) {
    console.error('[fileStore] saveCalendarSyncFlag failed:', e)
  }
}

// ── 角色顯示裁切（faceCrop，2026-08-25 起雙端同步，見 `core/store/keys.ts` 附註）──

export function loadCharacterDisplayConfig(): CharacterDisplayConfigMap {
  ensureDirs()
  const raw = electronStorage.readJsonSync<unknown>(keys.CHARACTER_DISPLAY_CONFIG_KEY)
  return raw && typeof raw === 'object' ? (raw as CharacterDisplayConfigMap) : {}
}

/**
 * `rect` 是 `null` 時**不刪掉這個角色的紀錄**，只清掉 `faceCrop`（保留
 * `updatedAt`）——理由跟手機端 `faceCropConfig.ts` 的 `setFaceCrop` 一致：
 * 「已清除」本身要能被 S2 同步比對出來，見那支檔案的檔頭說明。
 */
export function saveCharacterDisplayConfig(characterId: string, rect: FaceCropRect | null): void {
  ensureDirs()
  const map = loadCharacterDisplayConfig()
  map[characterId] = { faceCrop: rect ?? undefined, updatedAt: Date.now() }
  try {
    electronStorage.writeJsonSync(keys.CHARACTER_DISPLAY_CONFIG_KEY, map)
  } catch (e) {
    console.error('[fileStore] saveCharacterDisplayConfig failed:', e)
  }
}

export function saveSettings(settings: AppSettings): void {
  ensureDirs()
  _keepDebugPromptN = settings.memory.keepDebugPromptN
  savePinnedNotes(settings.ui.pinnedNotes ?? [])
  if (settings.remoteControl) {
    settings.remoteControl = saveRemoteControlModuleSettings(settings.remoteControl)
  }
  const persisted = toPersistedSettings(settings, electronSecrets)
  _pendingSettingsJson = JSON.stringify(persisted, null, 2)
  if (_saveSettingsTimer) clearTimeout(_saveSettingsTimer)
  _saveSettingsTimer = setTimeout(() => {
    _saveSettingsTimer = null
    const json = _pendingSettingsJson
    _pendingSettingsJson = null
    if (json) fs.writeFile(SETTINGS_FILE, json, 'utf-8', (err) => {
      if (err) console.error('[fileStore] saveSettings failed:', err)
    })
  }, 150)
}

/** App 結束前呼叫，確保 pending 的 debounced write 立即同步寫入 */
export function flushSaveSettings(): void {
  if (_saveSettingsTimer) {
    clearTimeout(_saveSettingsTimer)
    _saveSettingsTimer = null
  }
  if (_pendingSettingsJson) {
    try { fs.writeFileSync(SETTINGS_FILE, _pendingSettingsJson, 'utf-8') } catch { /* ignore */ }
    _pendingSettingsJson = null
  }
  if (_savePinnedNotesTimer) {
    clearTimeout(_savePinnedNotesTimer)
    _savePinnedNotesTimer = null
  }
  if (_pendingPinnedNotesJson) {
    try { fs.writeFileSync(PINNED_NOTES_FILE, _pendingPinnedNotesJson, 'utf-8') } catch { /* ignore */ }
    _pendingPinnedNotesJson = null
  }
}

// ── Persona Presets ──────────────────────────────────────

export function loadPersonaPresets(): PersonaPreset[] {
  ensureDirs()
  return electronStorage.listSync(keys.PERSONAS_DIR)
    .filter(k => k.endsWith('.json'))
    .map(k => electronStorage.readJsonSync<PersonaPreset>(k))
    .filter(Boolean) as PersonaPreset[]
}

export function savePersonaPreset(preset: PersonaPreset): void {
  ensureDirs()
  electronStorage.writeJsonSync(keys.personaKey(preset.id), preset)
}

export function deletePersonaPreset(id: string): void {
  electronStorage.removeSync(keys.personaKey(id))
}

export function loadPersonaPreset(id: string): PersonaPreset | null {
  return electronStorage.readJsonSync<PersonaPreset>(keys.personaKey(id))
}

// ── World Presets ────────────────────────────────────────

export function loadWorldPresets(): WorldPreset[] {
  ensureDirs()
  return electronStorage.listSync(keys.WORLDS_DIR)
    .filter(k => k.endsWith('.json'))
    .map(k => electronStorage.readJsonSync<WorldPreset>(k))
    .filter(Boolean) as WorldPreset[]
}

export function saveWorldPreset(preset: WorldPreset): void {
  ensureDirs()
  electronStorage.writeJsonSync(keys.worldKey(preset.id), preset)
}

export function deleteWorldPreset(id: string): void {
  electronStorage.removeSync(keys.worldKey(id))
}

export function loadWorldPreset(id: string): WorldPreset | null {
  return electronStorage.readJsonSync<WorldPreset>(keys.worldKey(id))
}

// ── Lorebooks（用語解說）────────────────────────────────
// 讀取失敗一律靜默略過該本，聊天流程不中斷（docs/future-lorebook.md §6.6）

export function loadLorebooks(): Lorebook[] {
  ensureDirs()
  return electronStorage.listSync(keys.LOREBOOKS_DIR)
    .filter(k => k.endsWith('.json'))
    .map(k => readLorebookAt(k))
    .filter(Boolean) as Lorebook[]
}

function readLorebookAt(key: string): Lorebook | null {
  const raw = electronStorage.readJsonSync<Lorebook>(key)
  if (!raw) return null
  try {
    return normalizeLorebook(raw)
  } catch { return null }
}

export function loadLorebook(id: string): Lorebook | null {
  return readLorebookAt(keys.lorebookKey(id))
}

export function saveLorebook(book: Lorebook): void {
  ensureDirs()
  electronStorage.writeJsonSync(keys.lorebookKey(book.id), book)
}

export function deleteLorebook(id: string): void {
  electronStorage.removeSync(keys.lorebookKey(id))
}

// ── Scene Presets ────────────────────────────────────────

export function loadScenePresets(): ScenePreset[] {
  if (_scenesCache) return _scenesCache
  ensureDirs()
  _scenesCache = electronStorage.listSync(keys.SCENES_DIR)
    .filter(k => k.endsWith('.json'))
    .map(k => electronStorage.readJsonSync<ScenePreset>(k))
    .filter(Boolean) as ScenePreset[]
  return _scenesCache
}

export function saveScenePreset(preset: ScenePreset): void {
  ensureDirs()
  electronStorage.writeJsonSync(keys.sceneKey(preset.id), preset)
  _scenesCache = null
}

export function deleteScenePreset(id: string): void {
  electronStorage.removeSync(keys.sceneKey(id))
  _scenesCache = null
}

export function loadScenePreset(id: string): ScenePreset | null {
  return electronStorage.readJsonSync<ScenePreset>(keys.sceneKey(id))
}

// ── Init default presets ─────────────────────────────────

export function initDefaultPresets(appRoot: string): { personas: PersonaPreset[]; worlds: WorldPreset[] } {
  ensureDirs()
  const existingPersonas = loadPersonaPresets()
  const existingWorlds = loadWorldPresets()

  const createdPersonas: PersonaPreset[] = []
  const createdWorlds: WorldPreset[] = []

  if (existingPersonas.length === 0) {
    const jsonPath = path.join(appRoot, 'assets', 'default-persona.json')
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        const id = uuidv4()
        const preset: PersonaPreset = {
          id,
          name: raw.name ?? '預設使用者',
          displayName: raw.displayName ?? '使用者',
          nickname: raw.nickname ?? '主人',
          description: raw.description ?? '',
          builtIn: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        savePersonaPreset(preset)
        createdPersonas.push(preset)
      } catch (e) {
        console.error('Failed to init default persona preset', e)
      }
    }
  }

  if (existingWorlds.length === 0) {
    const jsonPath = path.join(appRoot, 'assets', 'default-world.json')
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
        const id = uuidv4()
        const preset: WorldPreset = {
          id,
          name: raw.name ?? '預設世界觀',
          worldSetting: raw.worldSetting ?? '',
          interactionExample: raw.interactionExample ?? '',
          builtIn: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        saveWorldPreset(preset)
        createdWorlds.push(preset)
      } catch (e) {
        console.error('Failed to init default world preset', e)
      }
    }
  }

  return {
    personas: createdPersonas.length > 0 ? createdPersonas : existingPersonas,
    worlds: createdWorlds.length > 0 ? createdWorlds : existingWorlds
  }
}

// ── Characters ────────────────────────────────────────────

export function loadCharacters(): Character[] {
  ensureDirs()
  return electronStorage.listSync(keys.CHARACTERS_DIR)
    .map(k => electronStorage.readJsonSync<Character>(keys.characterCardKey(baseName(k))))
    .filter(Boolean) as Character[]
}

export function saveCharacter(char: Character): void {
  ensureDirs()
  // writeJsonSync 會自動補上角色資料夾。
  electronStorage.writeJsonSync(keys.characterCardKey(char.id), char)
}

export function deleteCharacter(id: string): void {
  electronStorage.removeSync(keys.characterDirKey(id))
}

// ── Conversations ─────────────────────────────────────────

export function loadConversation(id: string): Conversation | null {
  return electronStorage.readJsonSync<Conversation>(keys.conversationKey(id))
}

export function listConversationIds(): string[] {
  ensureDirs()
  return electronStorage.listSync(keys.CONVERSATIONS_DIR)
    .map(k => keys.idFromJsonName(baseName(k)))
    .filter(Boolean) as string[]
}

const _pendingConvJson = new Map<string, string>()
const _saveConvTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 由 loadSettings / saveSettings 同步；saveConversation 用它決定 debug prompt 保留則數。 */
let _keepDebugPromptN = DEFAULT_SETTINGS.memory.keepDebugPromptN

/**
 * 目前的角色名單，`saveConversation` 拿它把角色名字快照補進訊息裡
 * （`core/chat/characterName.ts`，理由見 `Message.characterName` 的註解）。
 *
 * 用注入而不是讓 fileStore 直接讀角色檔：角色的真相在 `ipcHandlers` 的記憶體
 * 名單上（新增／改名都先進那裡），fileStore 自己去讀檔會拿到落後一步的版本。
 * 沒注入時就是空陣列 —— 補不了名字就不補，不會擋住存檔。
 */
let _characterNameSource: () => readonly NamedCharacter[] = () => []

export function setCharacterNameSource(fn: () => readonly NamedCharacter[]): void {
  _characterNameSource = fn
}

export function saveConversation(conv: Conversation): void {
  ensureDirs()
  pruneConversationDebugPrompts(conv, _keepDebugPromptN)
  stampCharacterNames(conv, _characterNameSource())
  _pendingConvJson.set(conv.id, JSON.stringify(conv, null, 2))
  const existing = _saveConvTimers.get(conv.id)
  if (existing) clearTimeout(existing)
  _saveConvTimers.set(conv.id, setTimeout(() => {
    _saveConvTimers.delete(conv.id)
    const json = _pendingConvJson.get(conv.id)
    _pendingConvJson.delete(conv.id)
    if (json) fs.writeFile(resolveKey(keys.conversationKey(conv.id)), json, 'utf-8', (err) => {
      if (err) console.error('[fileStore] saveConversation failed:', err)
    })
  }, 200))
}

/** @see core/store/prune —— 實體已移入 core，此處轉出以維持既有 import 路徑。 */
export { pruneConversationDebugPrompts }

export function deleteConversation(id: string): void {
  electronStorage.removeSync(keys.conversationKey(id))
}

// ── Init default characters ───────────────────────────────

export async function initDefaultCharacters(appRoot: string): Promise<{ chars: Character[]; desktopState: DesktopCharacterState[] }> {
  const existing = loadCharacters()
  if (existing.length > 0) {
    return { chars: existing, desktopState: [] }
  }

  const packPath = path.join(appRoot, 'assets', 'DesktopST_DefaultChara.dstpack')
  if (!fs.existsSync(packPath)) {
    console.warn('[fileStore] Default character pack not found:', packPath)
    return { chars: [], desktopState: [] }
  }

  try {
    const buffer = fs.readFileSync(packPath)
    const { parsed, zip } = await loadDstPackZip(buffer)

    const created: Character[] = []
    ensureDirs()

    for (const prefix of parsed.characterZipPrefixes) {
      const segs = prefix.split('/').filter(Boolean)
      const packFolderId = segs[1] ?? ''
      if (!packFolderId) continue

      try {
        const charPreview = await readCharacterFromZip(zip, prefix)
        const newId = uuidv4()
        const destDir = resolveKey(keys.characterDirKey(newId))
        await extractCharacterDirFromZip(zip, prefix, destDir)
        const extractedFiles = fs.readdirSync(destDir)
        fs.writeFileSync(path.join(destDir, '_extract_debug.txt'), `Extracted ${charPreview.name}\nFiles: ${extractedFiles.join('\n')}`)
        console.log(`[fileStore] Extracted character ${charPreview.name} to ${destDir}, files: ${extractedFiles.join(', ')}`)

        let diskCard: Character
        try {
          diskCard = JSON.parse(fs.readFileSync(path.join(destDir, 'card.json'), 'utf-8')) as Character
        } catch {
          diskCard = charPreview
        }
        diskCard.id = newId
        diskCard.createdAt = diskCard.createdAt || Date.now()
        diskCard.updatedAt = Date.now()

        // Fix avatar path: avatar should be absolute path within destDir
        const avatarRaw = (diskCard.avatar || '').trim()
        let resolved = ''

        console.log(`[fileStore] Fixing avatar for ${diskCard.name}: raw="${avatarRaw}"`)

        // If avatar exists as absolute path, use it
        if (avatarRaw && fs.existsSync(avatarRaw)) {
          resolved = avatarRaw
          console.log(`[fileStore]   → found absolute path: ${resolved}`)
        } else if (avatarRaw && !path.isAbsolute(avatarRaw)) {
          // If relative path, resolve within destDir
          const abs = path.join(destDir, avatarRaw)
          if (fs.existsSync(abs)) {
            resolved = abs
            console.log(`[fileStore]   → found relative path: ${resolved}`)
          }
        }

        // If not resolved, look for avatar.* in destDir (including avatar-*.png with timestamps)
        if (!resolved) {
          const files = fs.readdirSync(destDir)
          console.log(`[fileStore]   → files in ${destDir}: ${files.join(', ')}`)
          // Look for any file starting with "avatar" that's an image
          const avatarFile = files.find(f =>
            /^avatar[-.]?\w*\.(png|jpg|jpeg|webp)$/i.test(f)
          )
          if (avatarFile) {
            resolved = path.join(destDir, avatarFile)
            console.log(`[fileStore]   → found auto: ${resolved}`)
          } else {
            console.log(`[fileStore]   → NOT FOUND`)
          }
        }

        diskCard.avatar = resolved

        // Fix emotion paths similarly
        const emotions: Record<string, string> = {}
        for (const [k, v] of Object.entries(diskCard.emotions ?? {})) {
          if (v && fs.existsSync(v)) {
            emotions[k] = v
          } else {
            // Try relative path first (emotions/xxx.png)
            let local = path.join(destDir, v || '')
            if (!fs.existsSync(local)) {
              // Fallback: look for the file in emotions/ subfolder
              const base = path.basename(v || '')
              local = base ? path.join(destDir, 'emotions', base) : ''
            }
            emotions[k] = local && fs.existsSync(local) ? local : (v || '')
          }
        }
        diskCard.emotions = emotions

        // Fix spriteIds: convert relative path keys to absolute
        if (diskCard.spriteIds && typeof diskCard.spriteIds === 'object') {
          const newSpriteIds: Record<string, string> = {}
          for (const [k, v] of Object.entries(diskCard.spriteIds)) {
            if (!k || typeof v !== 'string') continue
            let resolvedKey = k
            if (!path.isAbsolute(k)) {
              resolvedKey = path.resolve(destDir, k)
            }
            newSpriteIds[resolvedKey] = v
          }
          diskCard.spriteIds = newSpriteIds
        }

        saveCharacter(diskCard)
        created.push(diskCard)
      } catch (e) {
        console.error('[fileStore] Failed to import default character from pack:', prefix, e)
      }
    }

    const desktopState: DesktopCharacterState[] = created.map((c, i) => ({
      characterId: c.id,
      position: { x: 80 + i * 220, y: 400 },
      size: 1,
      flipped: false,
      muted: false,
      zIndex: i + 1
    }))

    return { chars: created, desktopState }
  } catch (e) {
    console.error('[fileStore] Failed to load default character pack:', e)
    return { chars: [], desktopState: [] }
  }
}

// ── File serving path ─────────────────────────────────────

/** @see dataDir —— 實體已移出本檔（storageAdapter 也要用），此處轉出以維持既有 import 路徑。 */
export { getDataDir, getDefaultDataDir }

function isSamePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b)
}

function isNestedPath(a: string, b: string): boolean {
  const aa = path.resolve(a)
  const bb = path.resolve(b)
  return aa.startsWith(`${bb}${path.sep}`) || bb.startsWith(`${aa}${path.sep}`)
}

function remapAbsolutePathPrefix(value: string, oldRoot: string, newRoot: string): string {
  const resolved = path.resolve(value)
  const oldResolved = path.resolve(oldRoot)
  if (resolved === oldResolved || resolved.startsWith(`${oldResolved}${path.sep}`)) {
    return path.join(newRoot, path.relative(oldResolved, resolved))
  }
  return value
}

function rewriteCharacterPathsForRelocatedDir(oldDir: string, newDir: string): void {
  const chars = loadCharacters()
  for (const char of chars) {
    const nextAvatar = char.avatar ? remapAbsolutePathPrefix(char.avatar, oldDir, newDir) : char.avatar
    const nextEmotions: Record<string, string> = {}
    for (const [k, v] of Object.entries(char.emotions ?? {})) {
      nextEmotions[k] = typeof v === 'string' ? remapAbsolutePathPrefix(v, oldDir, newDir) : v
    }
    const nextSpriteIds: Record<string, string> | undefined = char.spriteIds
      ? Object.fromEntries(Object.entries(char.spriteIds).map(([k, v]) => [remapAbsolutePathPrefix(k, oldDir, newDir), v]))
      : undefined
    saveCharacter({
      ...char,
      avatar: nextAvatar,
      emotions: nextEmotions,
      ...(nextSpriteIds ? { spriteIds: nextSpriteIds } : {})
    })
  }
}

export function relocateDataDir(targetDir: string): { ok: true; dataDir: string } | { ok: false; error: string } {
  const next = path.resolve(String(targetDir ?? '').trim())
  if (!next) return { ok: false, error: '目標資料夾無效。' }
  const current = getDataDir()
  if (isSamePath(next, current)) return { ok: true, dataDir: current }
  if (isNestedPath(next, current)) {
    return { ok: false, error: '新路徑不可與舊資料夾互為包含關係。請改選其他資料夾。' }
  }

  flushSaveSettings()
  try {
    if (!fs.existsSync(next)) fs.mkdirSync(next, { recursive: true })
    if (fs.existsSync(current)) {
      const entries = fs.readdirSync(current)
      for (const name of entries) {
        const src = path.join(current, name)
        const dst = path.join(next, name)
        fs.cpSync(src, dst, { recursive: true, force: true })
      }
    }
    const oldDir = current
    refreshPaths(next)
    ensureDirs()
    rewriteCharacterPathsForRelocatedDir(oldDir, getDataDir())
    saveDataDirMeta(next)
    try {
      if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true })
    } catch {
      // 搬移成功但清除舊資料夾失敗不阻擋流程。
    }
    return { ok: true, dataDir: getDataDir() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function getPathSizeBytes(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0
  try {
    const stat = fs.statSync(targetPath)
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
    let total = 0
    for (const name of fs.readdirSync(targetPath)) {
      total += getPathSizeBytes(path.join(targetPath, name))
    }
    return total
  } catch {
    return 0
  }
}

export function getDataDirSummary(): {
  dataDir: string
  estimatedSizeBytes: number
  characters: number
  conversations: number
  personas: number
  worlds: number
  scenes: number
  pinnedNotes: number
} {
  return {
    dataDir: getDataDir(),
    estimatedSizeBytes: getPathSizeBytes(getDataDir()),
    characters: loadCharacters().length,
    conversations: listConversationIds().length,
    personas: loadPersonaPresets().length,
    worlds: loadWorldPresets().length,
    scenes: loadScenePresets().length,
    pinnedNotes: loadPinnedNotes().length
  }
}
