import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, DesktopCharacterState, PersonaPreset, WorldPreset, ScenePreset, PinnedNote, Reminder } from './types'
import { DEFAULT_SETTINGS } from './types'
import { isPinnedNote } from '../core/store/normalize'
import { pruneConversationDebugPrompts } from '../core/store/prune'
import { hydrateSettings, toPersistedSettings } from '../core/store/settings'
import * as keys from '../core/store/keys'
// 直接指到實作檔而非 adapters/index：index 會拉進 storageAdapter，那支 import 本檔 → 循環。
import { electronSecrets } from './adapters/secretAdapter'
import { loadDstPackZip, readCharacterFromZip, extractCharacterDirFromZip } from './dstPack'
import {
  hasRemoteControlModuleSettings,
  loadRemoteControlModuleSettings,
  normalizeRemoteControlSettings,
  saveRemoteControlModuleSettings
} from './modules/remote-control'
import { configureModuleSettingsRoot } from './modules/moduleSettings'

const DEFAULT_DATA_DIR = path.join(app.getPath('userData'), 'DesktopST')
const STORAGE_META_FILE = path.join(app.getPath('userData'), 'DesktopST-storage.json')

let DATA_DIR = DEFAULT_DATA_DIR

/**
 * API Key 解密失敗時的暫存：key = provider name（openai/claude/…），value = 'enc:v1:...'
 * 防止 renderer 送回空字串時把加密值覆寫掉。
 */
export const encryptedApiKeyFallbacks = new Map<string, string>()
/**
 * 把 core 的平台無關 key（`'personas/abc.json'`）解析成本機絕對路徑。
 * 檔案佈局的定義在 `core/store/keys.ts`，桌面與手機共用同一份（B2.7）。
 */
function resolveKey(key: string): string {
  return path.join(DATA_DIR, ...key.split('/'))
}

let SETTINGS_FILE = resolveKey(keys.SETTINGS_KEY)
let PINNED_NOTES_FILE = resolveKey(keys.PINNED_NOTES_KEY)
let REMINDERS_FILE = resolveKey(keys.REMINDERS_KEY)
let CHARS_DIR = resolveKey(keys.CHARACTERS_DIR)
let CONVS_DIR = resolveKey(keys.CONVERSATIONS_DIR)
let PERSONAS_DIR = resolveKey(keys.PERSONAS_DIR)
let WORLDS_DIR = resolveKey(keys.WORLDS_DIR)
let SCENES_DIR = resolveKey(keys.SCENES_DIR)

type DataDirMeta = { dataDir?: string }

function refreshPaths(nextDir: string): void {
  DATA_DIR = path.resolve(nextDir)
  configureModuleSettingsRoot(DATA_DIR)
  SETTINGS_FILE = resolveKey(keys.SETTINGS_KEY)
  PINNED_NOTES_FILE = resolveKey(keys.PINNED_NOTES_KEY)
  REMINDERS_FILE = resolveKey(keys.REMINDERS_KEY)
  CHARS_DIR = resolveKey(keys.CHARACTERS_DIR)
  CONVS_DIR = resolveKey(keys.CONVERSATIONS_DIR)
  PERSONAS_DIR = resolveKey(keys.PERSONAS_DIR)
  WORLDS_DIR = resolveKey(keys.WORLDS_DIR)
  SCENES_DIR = resolveKey(keys.SCENES_DIR)
  _dirsEnsured = false
  _scenesCache = null
}

function loadDataDirFromMeta(): string {
  if (!fs.existsSync(STORAGE_META_FILE)) return DEFAULT_DATA_DIR
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_META_FILE, 'utf-8')) as DataDirMeta
    const configured = typeof raw?.dataDir === 'string' ? raw.dataDir.trim() : ''
    return configured ? path.resolve(configured) : DEFAULT_DATA_DIR
  } catch {
    return DEFAULT_DATA_DIR
  }
}

function saveDataDirMeta(targetDir: string): void {
  try {
    fs.writeFileSync(
      STORAGE_META_FILE,
      JSON.stringify({ dataDir: path.resolve(targetDir) } satisfies DataDirMeta, null, 2),
      'utf-8'
    )
  } catch (e) {
    console.error('[fileStore] saveDataDirMeta failed:', e)
  }
}

let _dirsEnsured = false
let _scenesCache: ScenePreset[] | null = null

refreshPaths(loadDataDirFromMeta())

function ensureDirs() {
  if (_dirsEnsured) return
  _dirsEnsured = true
  for (const dir of [DATA_DIR, ...keys.DATA_SUBDIRS.map(resolveKey)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadPinnedNotes(): PinnedNote[] {
  ensureDirs()
  if (!fs.existsSync(PINNED_NOTES_FILE)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(PINNED_NOTES_FILE, 'utf-8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isPinnedNote)
  } catch {
    return []
  }
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
  if (!fs.existsSync(SETTINGS_FILE)) {
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
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, unknown> | null

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
  if (!fs.existsSync(REMINDERS_FILE)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8'))
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
  } catch {
    return []
  }
}

export function saveReminders(reminders: Reminder[]): void {
  ensureDirs()
  try {
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf-8')
  } catch (e) {
    console.error('[fileStore] saveReminders failed:', e)
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
  if (!fs.existsSync(PERSONAS_DIR)) return []
  return fs.readdirSync(PERSONAS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(PERSONAS_DIR, f), 'utf-8')) as PersonaPreset
      } catch { return null }
    })
    .filter(Boolean) as PersonaPreset[]
}

export function savePersonaPreset(preset: PersonaPreset): void {
  ensureDirs()
  fs.writeFileSync(resolveKey(keys.personaKey(preset.id)), JSON.stringify(preset, null, 2), 'utf-8')
}

export function deletePersonaPreset(id: string): void {
  const file = resolveKey(keys.personaKey(id))
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function loadPersonaPreset(id: string): PersonaPreset | null {
  const file = resolveKey(keys.personaKey(id))
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as PersonaPreset
  } catch { return null }
}

// ── World Presets ────────────────────────────────────────

export function loadWorldPresets(): WorldPreset[] {
  ensureDirs()
  if (!fs.existsSync(WORLDS_DIR)) return []
  return fs.readdirSync(WORLDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(WORLDS_DIR, f), 'utf-8')) as WorldPreset
      } catch { return null }
    })
    .filter(Boolean) as WorldPreset[]
}

export function saveWorldPreset(preset: WorldPreset): void {
  ensureDirs()
  fs.writeFileSync(resolveKey(keys.worldKey(preset.id)), JSON.stringify(preset, null, 2), 'utf-8')
}

export function deleteWorldPreset(id: string): void {
  const file = resolveKey(keys.worldKey(id))
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function loadWorldPreset(id: string): WorldPreset | null {
  const file = resolveKey(keys.worldKey(id))
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as WorldPreset
  } catch { return null }
}

// ── Scene Presets ────────────────────────────────────────

export function loadScenePresets(): ScenePreset[] {
  if (_scenesCache) return _scenesCache
  ensureDirs()
  if (!fs.existsSync(SCENES_DIR)) return []
  _scenesCache = fs.readdirSync(SCENES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SCENES_DIR, f), 'utf-8')) as ScenePreset
      } catch { return null }
    })
    .filter(Boolean) as ScenePreset[]
  return _scenesCache
}

export function saveScenePreset(preset: ScenePreset): void {
  ensureDirs()
  fs.writeFileSync(resolveKey(keys.sceneKey(preset.id)), JSON.stringify(preset, null, 2), 'utf-8')
  _scenesCache = null
}

export function deleteScenePreset(id: string): void {
  const file = resolveKey(keys.sceneKey(id))
  if (fs.existsSync(file)) fs.unlinkSync(file)
  _scenesCache = null
}

export function loadScenePreset(id: string): ScenePreset | null {
  const file = resolveKey(keys.sceneKey(id))
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ScenePreset
  } catch { return null }
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
  if (!fs.existsSync(CHARS_DIR)) return []
  return fs.readdirSync(CHARS_DIR)
    .map(id => {
      const cardPath = resolveKey(keys.characterCardKey(id))
      if (!fs.existsSync(cardPath)) return null
      try {
        return JSON.parse(fs.readFileSync(cardPath, 'utf-8')) as Character
      } catch {
        return null
      }
    })
    .filter(Boolean) as Character[]
}

export function saveCharacter(char: Character): void {
  ensureDirs()
  const dir = resolveKey(keys.characterDirKey(char.id))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify(char, null, 2), 'utf-8')
}

export function deleteCharacter(id: string): void {
  const dir = resolveKey(keys.characterDirKey(id))
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
}

// ── Conversations ─────────────────────────────────────────

export function loadConversation(id: string): Conversation | null {
  const file = resolveKey(keys.conversationKey(id))
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Conversation
  } catch {
    return null
  }
}

export function listConversationIds(): string[] {
  ensureDirs()
  return fs.readdirSync(CONVS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
}

const _pendingConvJson = new Map<string, string>()
const _saveConvTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 由 loadSettings / saveSettings 同步；saveConversation 用它決定 debug prompt 保留則數。 */
let _keepDebugPromptN = DEFAULT_SETTINGS.memory.keepDebugPromptN

export function saveConversation(conv: Conversation): void {
  ensureDirs()
  pruneConversationDebugPrompts(conv, _keepDebugPromptN)
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
  const file = resolveKey(keys.conversationKey(id))
  if (fs.existsSync(file)) fs.unlinkSync(file)
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

export function getDataDir(): string {
  return DATA_DIR
}

export function getDefaultDataDir(): string {
  return DEFAULT_DATA_DIR
}

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
  if (isSamePath(next, DATA_DIR)) return { ok: true, dataDir: DATA_DIR }
  if (isNestedPath(next, DATA_DIR)) {
    return { ok: false, error: '新路徑不可與舊資料夾互為包含關係。請改選其他資料夾。' }
  }

  flushSaveSettings()
  try {
    if (!fs.existsSync(next)) fs.mkdirSync(next, { recursive: true })
    if (fs.existsSync(DATA_DIR)) {
      const entries = fs.readdirSync(DATA_DIR)
      for (const name of entries) {
        const src = path.join(DATA_DIR, name)
        const dst = path.join(next, name)
        fs.cpSync(src, dst, { recursive: true, force: true })
      }
    }
    const oldDir = DATA_DIR
    refreshPaths(next)
    ensureDirs()
    rewriteCharacterPathsForRelocatedDir(oldDir, DATA_DIR)
    saveDataDirMeta(next)
    try {
      if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true })
    } catch {
      // 搬移成功但清除舊資料夾失敗不阻擋流程。
    }
    return { ok: true, dataDir: DATA_DIR }
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
