import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, DesktopCharacterState } from './types'
import { DEFAULT_SETTINGS } from './types'

const DATA_DIR = path.join(app.getPath('userData'), 'DesktopST')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const CHARS_DIR = path.join(DATA_DIR, 'characters')
const CONVS_DIR = path.join(DATA_DIR, 'conversations')

function ensureDirs() {
  for (const dir of [DATA_DIR, CHARS_DIR, CONVS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

// ── Settings ──────────────────────────────────────────────

export function loadSettings(): AppSettings {
  ensureDirs()
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as AppSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings): void {
  ensureDirs()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
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
    { jsonFile: '紀天行_文本版.json', imgFile: 'KT_default.png', imgKey: 'KT' },
    { jsonFile: '汪逸彤_文本版.json', imgFile: 'YT_default.png', imgKey: 'YT' }
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
    muted: false,
    zIndex: i + 1
  }))

  return { chars: created, desktopState }
}

// ── File serving path ─────────────────────────────────────

export function getDataDir(): string {
  return DATA_DIR
}
