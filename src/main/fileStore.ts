import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, DesktopCharacterState, PersonaPreset, WorldPreset, LegacyAppSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

const DATA_DIR = path.join(app.getPath('userData'), 'DesktopST')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const CHARS_DIR = path.join(DATA_DIR, 'characters')
const CONVS_DIR = path.join(DATA_DIR, 'conversations')
const PERSONAS_DIR = path.join(DATA_DIR, 'personas')
const WORLDS_DIR = path.join(DATA_DIR, 'worlds')

function ensureDirs() {
  for (const dir of [DATA_DIR, CHARS_DIR, CONVS_DIR, PERSONAS_DIR, WORLDS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
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
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
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

    if (needsMigration) {
      saveSettings(settings)
    }

    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  ensureDirs()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
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

export function saveConversation(conv: Conversation): void {
  ensureDirs()
  fs.writeFileSync(path.join(CONVS_DIR, `${conv.id}.json`), JSON.stringify(conv, null, 2), 'utf-8')
}

export function deleteConversation(id: string): void {
  const file = path.join(CONVS_DIR, `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

// ── Init default characters ───────────────────────────────

export function initDefaultCharacters(appRoot: string): { chars: Character[]; desktopState: DesktopCharacterState[] } {
  const existing = loadCharacters()
  if (existing.length > 0) {
    return {
      chars: existing,
      desktopState: []
    }
  }

  const defaultChars: Array<{ jsonFile: string; imgFile: string; imgKey: string }> = [
    { jsonFile: '星離宸_DesktopST.json', imgFile: 'star_default.png', imgKey: 'star' },
    { jsonFile: '琉緋璃_DesktopST.json', imgFile: 'liu_default.png', imgKey: 'liu' }
  ]

  const created: Character[] = []

  for (const { jsonFile, imgFile } of defaultChars) {
    const jsonPath = path.join(appRoot, 'assets', jsonFile)
    const imgSrc = path.join(appRoot, 'assets', imgFile)
    if (!fs.existsSync(jsonPath)) continue

    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      const id = uuidv4()
      const charDir = path.join(CHARS_DIR, id)
      fs.mkdirSync(charDir, { recursive: true })

      // Copy avatar
      const avatarDest = path.join(charDir, 'avatar.png')
      if (fs.existsSync(imgSrc)) fs.copyFileSync(imgSrc, avatarDest)

      const data = raw.data ?? raw
      const char: Character = {
        id,
        name: data.name ?? raw.name ?? 'Unknown',
        nicknames: [],
        avatar: fs.existsSync(imgSrc) ? avatarDest : '',
        description: data.description ?? '',
        personality: data.personality ?? '',
        firstMessage: data.first_mes ?? raw.first_mes ?? '',
        exampleDialogue: data.mes_example ?? raw.mes_example ?? '',
        emotions: {},
        scenario: data.scenario ?? raw.scenario,
        systemPromptOverride: data.system_prompt ?? raw.system_prompt,
        creatorNotes: data.creator_notes ?? raw.creatorcomment,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      saveCharacter(char)
      created.push(char)
    } catch (e) {
      console.error('Failed to init default character', jsonFile, e)
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
}

// ── File serving path ─────────────────────────────────────

export function getDataDir(): string {
  return DATA_DIR
}
