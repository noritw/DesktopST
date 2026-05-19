import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, DesktopCharacterState, PersonaPreset, WorldPreset, LegacyAppSettings, PinnedNote, Reminder } from './types'
import { DEFAULT_SETTINGS } from './types'
import * as secureStore from './secureStore'
import { loadDstPackZip, readCharacterFromZip, extractCharacterDirFromZip } from './dstPack'

const DEFAULT_DATA_DIR = path.join(app.getPath('userData'), 'DesktopST')
const STORAGE_META_FILE = path.join(app.getPath('userData'), 'DesktopST-storage.json')

let DATA_DIR = DEFAULT_DATA_DIR
let SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
let PINNED_NOTES_FILE = path.join(DATA_DIR, 'pinned-notes.json')
let REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json')
let CHARS_DIR = path.join(DATA_DIR, 'characters')
let CONVS_DIR = path.join(DATA_DIR, 'conversations')
let PERSONAS_DIR = path.join(DATA_DIR, 'personas')
let WORLDS_DIR = path.join(DATA_DIR, 'worlds')

type DataDirMeta = { dataDir?: string }

function refreshPaths(nextDir: string): void {
  DATA_DIR = path.resolve(nextDir)
  SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
  PINNED_NOTES_FILE = path.join(DATA_DIR, 'pinned-notes.json')
  REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json')
  CHARS_DIR = path.join(DATA_DIR, 'characters')
  CONVS_DIR = path.join(DATA_DIR, 'conversations')
  PERSONAS_DIR = path.join(DATA_DIR, 'personas')
  WORLDS_DIR = path.join(DATA_DIR, 'worlds')
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

refreshPaths(loadDataDirFromMeta())

function ensureDirs() {
  for (const dir of [DATA_DIR, CHARS_DIR, CONVS_DIR, PERSONAS_DIR, WORLDS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

function isPinnedNote(value: unknown): value is PinnedNote {
  if (!value || typeof value !== 'object') return false
  const note = value as PinnedNote
  return typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    typeof note.color === 'string' &&
    typeof note.visible === 'boolean' &&
    !!note.position &&
    typeof note.position.x === 'number' &&
    typeof note.position.y === 'number'
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

function migrateLegacySettings(raw: Record<string, unknown>): { migratedPersonaId: string; migratedWorldId: string } {
  ensureDirs()
  let migratedPersonaId = ''
  let migratedWorldId = ''

  const legacy = raw as unknown as LegacyAppSettings

  if (legacy.persona && typeof legacy.persona === 'object' && 'displayName' in legacy.persona) {
    const id = uuidv4()
    const preset: PersonaPreset = {
      id,
      name: '我的設定',
      displayName: legacy.persona.displayName ?? '主人',
      nickname: legacy.persona.nickname ?? '主人',
      description: legacy.persona.description ?? '',
      builtIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    savePersonaPreset(preset)
    migratedPersonaId = id
    delete (raw as Record<string, unknown>).persona
  }

  if (typeof legacy.worldSetting === 'string' || typeof legacy.interactionExample === 'string') {
    const ws = typeof legacy.worldSetting === 'string' ? legacy.worldSetting : ''
    const ie = typeof legacy.interactionExample === 'string' ? legacy.interactionExample : ''
    if (ws.trim() || ie.trim()) {
      const id = uuidv4()
      const preset: WorldPreset = {
        id,
        name: '我的世界觀',
        worldSetting: ws,
        interactionExample: ie,
        builtIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      saveWorldPreset(preset)
      migratedWorldId = id
    }
    delete (raw as Record<string, unknown>).worldSetting
    delete (raw as Record<string, unknown>).interactionExample
  }

  return { migratedPersonaId, migratedWorldId }
}

export function loadSettings(): AppSettings {
  ensureDirs()
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {
      ...DEFAULT_SETTINGS,
      ui: {
        ...DEFAULT_SETTINGS.ui,
        pinnedNotes: loadPinnedNotes()
      }
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, unknown> | null
    const s = raw && typeof raw === 'object' ? raw : {} as Record<string, unknown>

    const needsMigration = Object.prototype.hasOwnProperty.call(s, 'persona') ||
      (Object.prototype.hasOwnProperty.call(s, 'worldSetting') && typeof (s as any).worldSetting === 'string')

    let migratedPersonaId = ''
    let migratedWorldId = ''
    if (needsMigration) {
      const result = migrateLegacySettings(s)
      migratedPersonaId = result.migratedPersonaId
      migratedWorldId = result.migratedWorldId
    }

    const typed = s as Partial<AppSettings>
    const hasLegacyPinnedNotesField = !!typed.ui && Object.prototype.hasOwnProperty.call(typed.ui, 'pinnedNotes')
    const legacyPinnedNotes = Array.isArray(typed.ui?.pinnedNotes) ? typed.ui.pinnedNotes.filter(isPinnedNote) : []
    const pinnedNotesFromFile = loadPinnedNotes()
    const shouldMigratePinnedNotes = pinnedNotesFromFile.length === 0 && legacyPinnedNotes.length > 0
    const pinnedNotes = shouldMigratePinnedNotes ? legacyPinnedNotes : pinnedNotesFromFile

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...typed,
      activePersonaId: typed.activePersonaId || migratedPersonaId || '',
      activeWorldId: typed.activeWorldId || migratedWorldId || '',
      llm: {
        ...DEFAULT_SETTINGS.llm,
        ...typed.llm,
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
          return !hadOnboardingKey ? { onboardingCompleted: true as const } : {}
        })())
      }
    }

    if (shouldMigratePinnedNotes) {
      savePinnedNotes(pinnedNotes)
    }

    // Detect plaintext keys that need migration to encrypted storage
    const rawApiKeys = typed.llm?.apiKeys ?? {}
    const needsKeyMigration = Object.values(rawApiKeys).some(
      v => typeof v === 'string' && v.trim() && !v.startsWith('enc:v1:')
    )

    // Decrypt API keys for in-memory use
    for (const k of Object.keys(settings.llm.apiKeys)) {
      settings.llm.apiKeys[k] = secureStore.decrypt(settings.llm.apiKeys[k] ?? '')
    }

    if (needsMigration || hasLegacyPinnedNotesField || needsKeyMigration) {
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
    return raw.filter((r): r is Reminder =>
      !!r && typeof r.id === 'string' && typeof r.label === 'string' && !!r.schedule
    )
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
  savePinnedNotes(settings.ui.pinnedNotes ?? [])
  const encryptedApiKeys: Record<string, string> = {}
  for (const [k, v] of Object.entries(settings.llm.apiKeys)) {
    encryptedApiKeys[k] = secureStore.encrypt(v)
  }
  const persisted: AppSettings = {
    ...settings,
    llm: { ...settings.llm, apiKeys: encryptedApiKeys },
    ui: { ...settings.ui }
  }
  delete persisted.ui.pinnedNotes
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
  fs.writeFileSync(path.join(PERSONAS_DIR, `${preset.id}.json`), JSON.stringify(preset, null, 2), 'utf-8')
}

export function deletePersonaPreset(id: string): void {
  const file = path.join(PERSONAS_DIR, `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function loadPersonaPreset(id: string): PersonaPreset | null {
  const file = path.join(PERSONAS_DIR, `${id}.json`)
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
  fs.writeFileSync(path.join(WORLDS_DIR, `${preset.id}.json`), JSON.stringify(preset, null, 2), 'utf-8')
}

export function deleteWorldPreset(id: string): void {
  const file = path.join(WORLDS_DIR, `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export function loadWorldPreset(id: string): WorldPreset | null {
  const file = path.join(WORLDS_DIR, `${id}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as WorldPreset
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
      const cardPath = path.join(CHARS_DIR, id, 'card.json')
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
  const dir = path.join(CHARS_DIR, char.id)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'card.json'), JSON.stringify(char, null, 2), 'utf-8')
}

export function deleteCharacter(id: string): void {
  const dir = path.join(CHARS_DIR, id)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
}

// ── Conversations ─────────────────────────────────────────

export function loadConversation(id: string): Conversation | null {
  const file = path.join(CONVS_DIR, `${id}.json`)
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

export function saveConversation(conv: Conversation): void {
  ensureDirs()
  _pendingConvJson.set(conv.id, JSON.stringify(conv, null, 2))
  const existing = _saveConvTimers.get(conv.id)
  if (existing) clearTimeout(existing)
  _saveConvTimers.set(conv.id, setTimeout(() => {
    _saveConvTimers.delete(conv.id)
    const json = _pendingConvJson.get(conv.id)
    _pendingConvJson.delete(conv.id)
    if (json) fs.writeFile(path.join(CONVS_DIR, `${conv.id}.json`), json, 'utf-8', (err) => {
      if (err) console.error('[fileStore] saveConversation failed:', err)
    })
  }, 200))
}

export function deleteConversation(id: string): void {
  const file = path.join(CONVS_DIR, `${id}.json`)
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
        const destDir = path.join(CHARS_DIR, newId)
        await extractCharacterDirFromZip(zip, prefix, destDir)

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

        // If avatar exists as absolute path, use it
        if (avatarRaw && fs.existsSync(avatarRaw)) {
          resolved = avatarRaw
        } else if (avatarRaw && !path.isAbsolute(avatarRaw)) {
          // If relative path, resolve within destDir
          const abs = path.join(destDir, avatarRaw)
          if (fs.existsSync(abs)) {
            resolved = abs
          }
        }

        // If not resolved, look for avatar.* in destDir
        if (!resolved) {
          const cand = ['avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp']
            .map(n => path.join(destDir, n))
            .find(p => fs.existsSync(p))
          resolved = cand ?? ''
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
  pinnedNotes: number
} {
  return {
    dataDir: getDataDir(),
    estimatedSizeBytes: getPathSizeBytes(getDataDir()),
    characters: loadCharacters().length,
    conversations: listConversationIds().length,
    personas: loadPersonaPresets().length,
    worlds: loadWorldPresets().length,
    pinnedNotes: loadPinnedNotes().length
  }
}
