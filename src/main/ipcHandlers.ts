import { ipcMain, shell, BrowserWindow, dialog, app, desktopCapturer, clipboard, nativeImage, screen } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, Character, Conversation, Message, PersonaPreset, WorldPreset, PinnedNote } from './types'
import * as fileStore from './fileStore'
import { chatWithLLM, testLLMConnection, testLLMMessage } from './llm/index'
import { normalizeEmotion, buildEmotionIdList, parseEmotion, resolveModel } from './llm/promptUtils'
import { extractCharaJson, embedCharaJson, getExportPngBaseBuffer } from './pngUtils'
import { importStJson, exportToStJson } from './stCardMapper'
import {
  buildDstPackBuffer,
  extractCharacterDirFromZip,
  loadDstPackZip,
  readCharacterFromZip
} from './dstPack'
import {
  createCharacterWindow, closeCharacterWindow, getCharacterWindow,
  resizeCharacterWindow, getCharacterWindowSize,
  toggleInputWindow, toggleLogWindow, openLogWindow, openSettingsWindow,
  broadcastToAll, getAllCharacterWindows, setCharacterWindowClickThrough,
  restoreAuxWindowsFromRememberedState, bringCharacterToFront, raiseAuxAboveCharacters, raiseAuxWindowToFront,
  showSpeechBubble, hideSpeechBubble, persistSpeechBubble, hideAllCharacterSpeechBubbles, updateSpeechBubbleSize, syncSpeechBubblePosition,
  showUserSpeechBubble, hideUserSpeechBubble, updateUserSpeechBubbleSize,
  reconcileSpeechBubbleAfterCharacterDrag, setCharacterHitRects,
  beginCharacterDrag, moveDraggedCharacter, endCharacterDrag, suppressAuxAutoHide, configureAuxWindowPersistence,
  setUnfocusedBubbleOpacity, setCharactersAlwaysOnTop, getCharactersAlwaysOnTop,
  createCharacterLibraryWindow,
  hideAllWindowsForScreenshot, hideAuxWindowsForScreenshotKeepingCharacters, restoreAllWindowsAfterScreenshot,
  showPreviewWindow,
  createPinnedNoteWindow, updatePinnedNoteContent, updatePinnedNoteColor, closePinnedNote, getPinnedNoteWindow, getPinnedNoteWindowState,
  openPinnedNotesManager, configurePinnedNotePersistence, getBubbleWindow,
  hideAllAuxWindowsExceptPinnedNotes, focusPinnedNoteWindow, showPinnedNoteColorMenu, raiseCharactersAbovePinnedNotes,
  createEmojiPickerWindow, closeEmojiPickerWindow, getEmojiPickerWindow, getInputWindow,
  getLogWindow, getVisibleAuxWindowSnapshot, restoreAuxWindowsFromSnapshot, getVisiblePinnedNoteWindowIds,
  broadcastConversationUpdate,
  type VisibleAuxWindowSnapshotEntry
} from './windowManager'

// ── Helpers ──────────────────────────────────────────────

function isPositionOffscreen(pos: { x: number; y: number }, winSize: { width: number; height: number }): boolean {
  const px = Number.isFinite(pos.x) ? pos.x : 0
  const py = Number.isFinite(pos.y) ? pos.y : 0
  const rect = { x: px, y: py, w: winSize.width, h: winSize.height }
  const displays = screen.getAllDisplays()
  return !displays.some(d => {
    const wa = d.workArea
    const x1 = Math.max(rect.x, wa.x)
    const y1 = Math.max(rect.y, wa.y)
    const x2 = Math.min(rect.x + rect.w, wa.x + wa.width)
    const y2 = Math.min(rect.y + rect.h, wa.y + wa.height)
    return x2 > x1 && y2 > y1
  })
}

// ── In-memory state ───────────────────────────────────────

let settings: AppSettings
let characters: Character[]
let activeConversationId: string | null = null
let conversations: Map<string, Conversation> = new Map()

function syncLastActiveConversationToSettings(): void {
  if (activeConversationId) settings.ui.lastActiveConversationId = activeConversationId
  else delete settings.ui.lastActiveConversationId
  fileStore.saveSettings(settings)
}

function pickStartupConversationId(ids: string[], saved?: string): string {
  if (saved && ids.includes(saved) && fileStore.loadConversation(saved)) return saved
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i]
    if (fileStore.loadConversation(id)) return id
  }
  return ids[ids.length - 1]
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function normalizeUnfocusedBubbleOpacity(v: unknown): number {
  const n = Number(v)
  return clamp01(Number.isFinite(n) ? n : 0.1)
}

function estimateBubbleWidth(text: string): number {
  const len = String(text ?? '').length
  const approx = 180 + Math.max(0, Math.min(220, Math.floor(len / 14) * 30))
  return Math.max(200, Math.min(420, approx))
}

function normalizeLegacyPinnedNoteSizes(): boolean {
  let changed = false
  for (const note of settings.ui.pinnedNotes ?? []) {
    if (!note.characterId || !note.size) continue
    const width = Math.round(Number(note.size.width))
    const height = Math.round(Number(note.size.height))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 420 || height <= 0) continue

    const expectedWidth = estimateBubbleWidth(note.content)
    const factor = width / expectedWidth
    if (factor < 1.25) continue

    note.size = {
      width: expectedWidth,
      height: Math.max(78, Math.round(height / factor))
    }
    note.updatedAt = Date.now()
    changed = true
  }
  return changed
}

function formatSystemTimeLabel(d: Date): string {
  const hours = d.getHours()
  return hours < 5 ? '凌晨'
    : hours < 8 ? '清晨'
    : hours < 12 ? '上午'
    : hours < 13 ? '中午'
    : hours < 18 ? '下午'
    : hours < 19 ? '傍晚'
    : hours < 23 ? '晚上'
    : '深夜'
}

function formatSystemTimeStamp(d: Date): string {
  const timeLabel = formatSystemTimeLabel(d)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${timeLabel}`
}

function normalizeText(s: string): string {
  return s.toLowerCase()
}

function copyDataUrlImageToClipboard(dataUrl: string): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('Failed to convert screenshot for clipboard')
  clipboard.writeImage(image)
}

function getActivePersona(): PersonaPreset | null {
  if (!settings.activePersonaId) return null
  return fileStore.loadPersonaPreset(settings.activePersonaId)
}

function getActiveWorld(): WorldPreset | null {
  if (!settings.activeWorldId) return null
  return fileStore.loadWorldPreset(settings.activeWorldId)
}

function getPersonaDisplayName(): string {
  const p = getActivePersona()
  return p?.displayName?.trim() || p?.nickname?.trim() || '使用者'
}

function characterAliases(char: Character): string[] {
  const nn = Array.isArray(char.nicknames) ? char.nicknames : []
  return [char.name, ...nn].map(s => String(s ?? '').trim()).filter(Boolean)
}

function isAddressed(content: string, char: Character): boolean {
  const text = normalizeText(content)
  for (const a of characterAliases(char)) {
    const aa = normalizeText(a)
    if (!aa) continue
    if (text.includes(`@${aa}`) || text.includes(aa)) return true
  }
  return false
}

function shuffleIds(ids: string[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pickPrimaryResponderId(respondingIds: string[], mentionedIds: string[]): string | null {
  if (respondingIds.length === 0) return null
  if (mentionedIds.length > 0) return respondingIds[0]
  return respondingIds[0]
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    const match = String(s ?? '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}


function normalizeForCompare(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[，、。！？!?,.]+/g, '')
    .toLowerCase()
}

function escapeRegExp(s: string): string {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function maybeUnwrapSingleDialogueQuote(text: string): string {
  const s = String(text ?? '').trim()
  const pairs: Array<[string, string]> = [['「', '」'], ['『', '』'], ['"', '"']]
  for (const [left, right] of pairs) {
    if (!s.startsWith(left) || !s.endsWith(right)) continue
    const inner = s.slice(left.length, s.length - right.length).trim()
    if (!inner) return ''
    // Keep quotes when text is intentionally quoting something inside.
    if (inner.includes(left) || inner.includes(right)) return s
    return inner
  }
  return s
}

function stripSpeakerPrefixFromLine(line: string, aliases: string[]): string {
  let text = String(line ?? '').trim()
  if (!text) return ''
  const sorted = aliases.filter(Boolean).sort((a, b) => b.length - a.length)
  for (const alias of sorted) {
    const escaped = escapeRegExp(alias)
    const pattern = new RegExp(`^(?:[【\\[]\\s*)?${escaped}(?:\\s*[】\\]]\\s*)?\\s*[：:]\\s*`)
    if (pattern.test(text)) {
      text = text.replace(pattern, '').trim()
      break
    }
  }
  return maybeUnwrapSingleDialogueQuote(text)
}

function normalizeCharacterDialogue(raw: string, char: Character): string {
  const text = parseEmotion(String(raw ?? ''), buildEmotionIdList(char)).content.trim()
  if (!text) return ''
  const aliases = characterAliases(char)
  const normalizedLines = text
    .split(/\r?\n/)
    .map(line => stripSpeakerPrefixFromLine(line, aliases))
  return maybeUnwrapSingleDialogueQuote(normalizedLines.join('\n').trim())
}

function stripOtherCharacterSpeakerLines(text: string, selfCharId: string): string {
  const otherAliases = characters
    .filter(c => c.id !== selfCharId)
    .flatMap(c => characterAliases(c))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (otherAliases.length === 0) return String(text ?? '').trim()

  const isOtherSpeakerPrefixed = (line: string): boolean => {
    const t = String(line ?? '').trim()
    if (!t) return false
    for (const alias of otherAliases) {
      const escaped = escapeRegExp(alias)
      const pattern = new RegExp(`^(?:[【\\[]\\s*)?${escaped}(?:\\s*[】\\]]\\s*)?\\s*[：:]\\s*`)
      if (pattern.test(t)) return true
    }
    return false
  }

  return String(text ?? '')
    .split(/\r?\n/)
    .filter(line => !isOtherSpeakerPrefixed(line))
    .join('\n')
    .trim()
}

const MAX_MEDIA_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

function normalizeImageExt(ext: string): string {
  const t = String(ext ?? '').trim().toLowerCase()
  return t.startsWith('.') ? t : `.${t}`
}

function safeCharacterDir(characterId: string): string | null {
  const dir = path.join(fileStore.getDataDir(), 'characters', characterId)
  return fs.existsSync(path.join(dir, 'card.json')) ? dir : null
}

function cleanupOldAvatarFiles(dir: string, keepPath: string): void {
  const keep = path.resolve(keepPath)
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file)
    if (path.resolve(full) === keep) continue
    if (!file.startsWith('avatar')) continue
    if (!ALLOWED_IMAGE_EXT.has(path.extname(file).toLowerCase())) continue
    try {
      if (fs.statSync(full).isFile()) fs.unlinkSync(full)
    } catch {
      // Best-effort cleanup only; saving the new avatar is the important part.
    }
  }
}

export function getSettings(): AppSettings { return settings }

export function initState(
  s: AppSettings,
  chars: Character[],
  desktopState: { characterId: string; position: { x: number; y: number }; size: number; flipped: boolean; muted: boolean; zIndex: number }[]
) {
  settings = s
  settings.ui.unfocusedBubbleOpacity = normalizeUnfocusedBubbleOpacity(settings.ui.unfocusedBubbleOpacity)
  const didNormalizePinnedNoteSizes = normalizeLegacyPinnedNoteSizes()
  setUnfocusedBubbleOpacity(settings.ui.unfocusedBubbleOpacity)
  setCharactersAlwaysOnTop(settings.ui.alwaysOnTop ?? true)
  characters = chars
  configureAuxWindowPersistence(
    (kind) => kind === 'input' ? settings.ui.inputWindowBounds : settings.ui.logWindowBounds,
    (kind, bounds) => {
      if (kind === 'input') {
        settings.ui.inputWindowBounds = bounds
        settings.ui.inputWindowPosition = { x: bounds.x, y: bounds.y }
      } else {
        settings.ui.logWindowBounds = bounds
      }
      fileStore.saveSettings(settings)
    }
  )
  configurePinnedNotePersistence((noteId, bounds) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      note.position = { x: bounds.x, y: bounds.y }
      note.size = { width: bounds.width, height: bounds.height }
      note.updatedAt = Date.now()
      fileStore.saveSettings(settings)
    }
  })

  if (didNormalizePinnedNoteSizes) {
    fileStore.saveSettings(settings)
  }

  // Ensure desktop characters are set
  if (desktopState.length > 0 && s.ui.desktopCharacters.length === 0) {
    settings.ui.desktopCharacters = desktopState
    fileStore.saveSettings(settings)
  }

  // Load or create active conversation
  const ids = fileStore.listConversationIds()
  if (ids.length > 0) {
    const pick = pickStartupConversationId(ids, settings.ui.lastActiveConversationId)
    activeConversationId = pick
    const conv = getOrLoadConversation(pick)
    if (conv) conversations.set(conv.id, conv)
    syncLastActiveConversationToSettings()
  } else {
    createNewConversation()
  }

  // 恢復已保存的便利貼（只恢復 visible=true 的）
  const visibleNotes = (settings.ui.pinnedNotes ?? []).filter(n => n.visible)
  if (visibleNotes.length > 0) {
    setImmediate(() => {
      for (const note of visibleNotes) {
        createPinnedNoteWindow(note.id, note.position, note.content, note.title, note.color, note.size, note.fontSize)
      }
    })
  }
}

function getActiveConversation(): Conversation | null {
  if (!activeConversationId) return null
  return conversations.get(activeConversationId) ?? null
}

function createNewConversation(): Conversation {
  const id = uuidv4()
  const conv: Conversation = {
    id,
    title: '新對話',
    participantIds: settings.ui.desktopCharacters.map(d => d.characterId),
    messages: [],
    summary: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  conversations.set(id, conv)
  activeConversationId = id
  fileStore.saveConversation(conv)
  syncLastActiveConversationToSettings()
  return conv
}

function getCharacter(id: string): Character | undefined {
  return characters.find(c => c.id === id)
}

function getSpeakerNameById(): Record<string, string> {
  return Object.fromEntries(characters.map(c => [c.id, c.name]))
}

function getOrLoadConversation(id: string): Conversation | null {
  const cached = conversations.get(id)
  if (cached) return cached
  const loaded = fileStore.loadConversation(id)
  if (!loaded) return null
  conversations.set(loaded.id, loaded)
  return loaded
}

function pickNextConversationId(excludingId?: string): string | null {
  const ids = fileStore.listConversationIds().filter(id => id !== excludingId)
  const candidates: Array<{ id: string; updatedAt: number; hasMessages: boolean }> = []
  for (const id of ids) {
    const conv = getOrLoadConversation(id)
    if (!conv) continue
    candidates.push({ id, updatedAt: conv.updatedAt ?? 0, hasMessages: (conv.messages?.length ?? 0) > 0 })
  }
  // Prefer conversations with messages, newest first
  candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const withMessages = candidates.find(c => c.hasMessages)
  return withMessages?.id ?? (candidates[0]?.id ?? null)
}

// ── IPC handlers ──────────────────────────────────────────

function fixCharacterPathsAfterImport(char: Character, dir: string): Character {
  let avatar = (char.avatar || '').trim()
  if (!avatar || !fs.existsSync(avatar)) {
    const cand = ['avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp', 'avatar.gif']
      .map(n => path.join(dir, n))
      .find(p => fs.existsSync(p))
    avatar = cand ?? ''
  } else {
    const resolvedA = path.resolve(avatar)
    const resolvedD = path.resolve(dir)
    if (!resolvedA.startsWith(resolvedD)) {
      const local = path.join(dir, path.basename(avatar))
      avatar = fs.existsSync(local) ? local : avatar
    }
  }
  const emotions: Record<string, string> = { ...(char.emotions || {}) }
  for (const k of Object.keys(emotions)) {
    const v = emotions[k]
    if (v && fs.existsSync(v)) continue
    const base = path.basename(v || '')
    if (!base) {
      emotions[k] = ''
      continue
    }
    const inEmo = path.join(dir, 'emotions', base)
    const inRoot = path.join(dir, base)
    emotions[k] = fs.existsSync(inEmo) ? inEmo : fs.existsSync(inRoot) ? inRoot : ''
  }
  return { ...char, avatar, emotions }
}

type DismissedAuxWindowSnapshot = {
  auxWindows: VisibleAuxWindowSnapshotEntry[]
  pinnedNotes: Array<{ id: string; bounds?: { x: number; y: number; width: number; height: number } }>
}

let dismissedAuxWindowSnapshot: DismissedAuxWindowSnapshot | null = null

export function hasDismissedAuxWindows(): boolean {
  return dismissedAuxWindowSnapshot !== null
}

export async function dismissAllAuxWindows(): Promise<boolean> {
  const auxWindows = getVisibleAuxWindowSnapshot()
  const visiblePinnedNoteIds = new Set(getVisiblePinnedNoteWindowIds())
  const pinnedNotes: DismissedAuxWindowSnapshot['pinnedNotes'] = []
  const notes = settings?.ui?.pinnedNotes ?? []
  for (const note of notes) {
    if (!note.visible && !visiblePinnedNoteIds.has(note.id)) continue
    const b = await getPinnedNoteWindowState(note.id)
    if (b) {
      note.position = { x: b.x, y: b.y }
      note.size = { width: b.width, height: b.height }
    }
    pinnedNotes.push({
      id: note.id,
      bounds: b ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined
    })
    note.visible = false
    note.updatedAt = Date.now()
    closePinnedNote(note.id)
  }
  dismissedAuxWindowSnapshot = auxWindows.length > 0 || pinnedNotes.length > 0
    ? { auxWindows, pinnedNotes }
    : null
  if (settings) {
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
  }
  hideAllAuxWindowsExceptPinnedNotes()
  return dismissedAuxWindowSnapshot !== null
}

export function restoreDismissedAuxWindows(): boolean {
  const snapshot = dismissedAuxWindowSnapshot
  if (!snapshot || !settings) return false
  dismissedAuxWindowSnapshot = null

  // 延到下一個 tick 才建窗，讓 tray 選單先關閉並釋放 main thread，
  // 避免同步建立多個 BrowserWindow 阻塞 event loop 造成游標凍結。
  setImmediate(() => {
    if (!settings) return

    // Collect note creation data up front (before any async gaps mutate settings)
    type NoteCreateData = {
      id: string
      position: { x: number; y: number }
      content: string
      title: string
      color: string
      size: { width: number; height: number } | undefined
      fontSize: number | undefined
    }
    const notesToCreate: NoteCreateData[] = []
    for (const savedNote of snapshot.pinnedNotes) {
      const note = settings.ui.pinnedNotes?.find(n => n.id === savedNote.id)
      if (!note) continue
      if (savedNote.bounds) {
        note.position = { x: savedNote.bounds.x, y: savedNote.bounds.y }
        note.size = { width: savedNote.bounds.width, height: savedNote.bounds.height }
      }
      note.visible = true
      note.updatedAt = Date.now()
      notesToCreate.push({ id: note.id, position: note.position, content: note.content, title: note.title, color: note.color, size: note.size, fontSize: note.fontSize })
    }

    const finalize = () => {
      restoreAuxWindowsFromSnapshot(snapshot.auxWindows)
      if (settings) {
        fileStore.saveSettings(settings)
        broadcastToAll('settings:updated', settings)
      }
    }

    if (notesToCreate.length === 0) {
      finalize()
      return
    }

    // Create one pinned note window per event-loop tick so mouse events are processed between each.
    const runNext = (i: number): void => {
      const d = notesToCreate[i]
      createPinnedNoteWindow(d.id, d.position, d.content, d.title, d.color, d.size, d.fontSize, { skipActivation: true })
      if (i + 1 < notesToCreate.length) {
        setImmediate(() => runNext(i + 1))
      } else {
        setImmediate(finalize)
      }
    }
    runNext(0)
  })
  return true
}

export function registerIpcHandlers() {

  // Store: get initial snapshot for any renderer
  ipcMain.handle('store:get-all', () => ({
    settings,
    characters,
    desktopCharacters: settings.ui.desktopCharacters,
    activeConversationId,
    conversation: getActiveConversation()
  }))

  // Settings
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:save', (_, s: AppSettings) => {
    s.ui.unfocusedBubbleOpacity = normalizeUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setCharactersAlwaysOnTop(s.ui.alwaysOnTop ?? true)
    const prevPointer = settings.ui.lastActiveConversationId
    const ui = { ...s.ui }
    if (!Object.prototype.hasOwnProperty.call(ui, 'lastActiveConversationId')) {
      ui.lastActiveConversationId = prevPointer
    }
    settings = { ...s, ui }
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
    return true
  })

  ipcMain.handle('app:set-always-on-top', (_, enabled: boolean) => {
    settings.ui.alwaysOnTop = enabled
    setCharactersAlwaysOnTop(enabled)
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
    return true
  })

  ipcMain.handle('app:get-always-on-top', () => getCharactersAlwaysOnTop())

  // Characters
  ipcMain.handle('characters:list', () => characters)

  ipcMain.handle('character:save', (_, char: Character) => {
    char.updatedAt = Date.now()
    const idx = characters.findIndex(c => c.id === char.id)
    if (idx >= 0) characters[idx] = char
    else characters.push(char)
    fileStore.saveCharacter(char)
    broadcastToAll('characters:updated', characters)
    return true
  })

  ipcMain.handle('character:delete', (_, id: string) => {
    characters = characters.filter(c => c.id !== id)
    fileStore.deleteCharacter(id)
    // Remove from desktop if present
    settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== id)
    fileStore.saveSettings(settings)
    closeCharacterWindow(id)
    broadcastToAll('characters:updated', characters)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('character-library:open', (_, payload?: { mode?: 'home' | 'edit'; characterId?: string }) => {
    try {
      createCharacterLibraryWindow(payload)
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  })

  ipcMain.handle('character:import-png', (_, payload: { buffer: ArrayBuffer }) => {
    try {
      const buf = Buffer.from(payload.buffer ?? new ArrayBuffer(0))
      if (buf.length > MAX_MEDIA_BYTES) return { error: '檔案超過 10 MB 上限' }
      let jsonStr: string
      try {
        jsonStr = extractCharaJson(buf)
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonStr)
      } catch {
        return { error: '內容無法解析為有效角色卡資料' }
      }
      const id = uuidv4()
      let char = importStJson(parsed, id)
      const dir = path.join(fileStore.getDataDir(), 'characters', id)
      fs.mkdirSync(dir, { recursive: true })
      const avatarPath = path.join(dir, 'avatar.png')
      fs.writeFileSync(avatarPath, buf)
      char = { ...char, avatar: avatarPath }
      characters.push(char)
      fileStore.saveCharacter(char)
      broadcastToAll('characters:updated', characters)
      return char
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:export-json', (_, char: Character) => {
    try {
      return { json: exportToStJson(char) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:export-png', (_, char: Character) => {
    try {
      if (!char?.id?.trim() || !char?.name?.trim()) {
        return { error: '角色資料不完整' }
      }
      const appRoot = app.getAppPath()
      let baseBuf: Buffer
      if (char.avatar && fs.existsSync(char.avatar)) {
        baseBuf = fs.readFileSync(char.avatar)
      } else {
        baseBuf = getExportPngBaseBuffer(appRoot)
      }
      const jsonStr = exportToStJson(char)
      const out = embedCharaJson(baseBuf, jsonStr)
      const arrayBuffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
      return { buffer: arrayBuffer }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:build-dstpack', async (_, payload: { characterIds: string[]; includeGlobalSettings: boolean }) => {
    try {
      const ids = Array.isArray(payload?.characterIds) ? payload.characterIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
      if (ids.length === 0) return { error: '尚未選擇任何角色' }
      const buf = await buildDstPackBuffer({
        charsRoot: path.join(fileStore.getDataDir(), 'characters'),
        characterIds: ids,
        includeGlobalSettings: !!payload?.includeGlobalSettings,
        settings,
        persona: getActivePersona(),
        world: getActiveWorld()
      })
      const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return { buffer: arrayBuffer }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:import-dstpack', async (event, payload: { buffer: ArrayBuffer }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const buffer = Buffer.from(payload?.buffer ?? new ArrayBuffer(0))
      if (buffer.length < 32) return { error: '檔案過小或已損毀' }
      const { parsed, zip } = await loadDstPackZip(buffer)
      const charsRoot = path.join(fileStore.getDataDir(), 'characters')
      let imported = 0
      let skipped = 0

      const conflictBox = {
        type: 'question' as const,
        buttons: ['覆蓋', '建立新角色', '取消匯入此角色'],
        defaultId: 2,
        cancelId: 2,
        title: 'DesktopST'
      }

      for (const prefix of parsed.characterZipPrefixes) {
        const segs = prefix.split('/').filter(Boolean)
        const packFolderId = segs[1] ?? ''
        if (!packFolderId) continue

        const charPreview = await readCharacterFromZip(zip, prefix)
        const idHit = characters.find(c => c.id === charPreview.id)
        const nameHit = characters.find(
          c => c.name.trim().toLowerCase() === charPreview.name.trim().toLowerCase()
        )

        let targetDirId = charPreview.id

        if (idHit) {
          const r = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, {
              ...conflictBox,
              message: `角色「${charPreview.name}」匯入衝突`,
              detail: '本機已存在相同角色 ID。要覆蓋、建立成另一個角色，或略過此角色？'
            })
            : await dialog.showMessageBox({
              ...conflictBox,
              message: `角色「${charPreview.name}」匯入衝突`,
              detail: '本機已存在相同角色 ID。要覆蓋、建立成另一個角色，或略過此角色？'
            })
          if (r.response === 2) {
            skipped++
            continue
          }
          if (r.response === 1) {
            targetDirId = uuidv4()
          } else {
            targetDirId = charPreview.id
            fs.rmSync(path.join(charsRoot, targetDirId), { recursive: true, force: true })
          }
        } else if (nameHit && nameHit.id !== charPreview.id) {
          const r = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, {
              ...conflictBox,
              message: `角色「${charPreview.name}」匯入衝突`,
              detail: '本機已存在同名但不同 ID 的角色。要覆蓋本機同名角色、建立成另一個角色，或略過此角色？'
            })
            : await dialog.showMessageBox({
              ...conflictBox,
              message: `角色「${charPreview.name}」匯入衝突`,
              detail: '本機已存在同名但不同 ID 的角色。要覆蓋本機同名角色、建立成另一個角色，或略過此角色？'
            })
          if (r.response === 2) {
            skipped++
            continue
          }
          if (r.response === 1) {
            targetDirId = uuidv4()
          } else {
            targetDirId = nameHit.id
            fs.rmSync(path.join(charsRoot, targetDirId), { recursive: true, force: true })
          }
        }

        const destDir = path.join(charsRoot, targetDirId)
        await extractCharacterDirFromZip(zip, prefix, destDir)

        let diskCard: Character
        try {
          diskCard = JSON.parse(fs.readFileSync(path.join(destDir, 'card.json'), 'utf-8')) as Character
        } catch {
          diskCard = charPreview
        }
        diskCard.id = targetDirId
        diskCard.updatedAt = Date.now()
        if (!diskCard.createdAt) diskCard.createdAt = Date.now()
        const fixed = fixCharacterPathsAfterImport(diskCard, destDir)
        fileStore.saveCharacter(fixed)
        const idx = characters.findIndex(c => c.id === fixed.id)
        if (idx >= 0) characters[idx] = fixed
        else characters.push(fixed)
        imported++
      }

      broadcastToAll('characters:updated', characters)

      if (parsed.manifest.includeGlobalSettings && parsed.globalPartial) {
        const g = parsed.globalPartial
        const dialogOpts = {
          type: 'question' as const,
          buttons: ['套用', '不要套用'],
          defaultId: 1,
          title: 'DesktopST',
          message: '此封裝包含世界觀與使用者資訊',
          detail: '是否套用匯入的世界觀與使用者資訊？（不會變更 API Key）'
        }
        const r = win && !win.isDestroyed()
          ? await dialog.showMessageBox(win, dialogOpts)
          : await dialog.showMessageBox(dialogOpts)
        if (r.response === 0) {
          const now = Date.now()
          if (g.persona) {
            const pid = uuidv4()
            const personaPreset: PersonaPreset = {
              id: pid,
              name: '匯入的使用者',
              displayName: g.persona.displayName ?? '使用者',
              nickname: g.persona.nickname ?? '主人',
              description: g.persona.description ?? '',
              builtIn: false,
              createdAt: now,
              updatedAt: now
            }
            fileStore.savePersonaPreset(personaPreset)
            settings.activePersonaId = pid
          }
          if (g.worldSetting || g.interactionExample) {
            const wid = uuidv4()
            const worldPreset: WorldPreset = {
              id: wid,
              name: '匯入的世界觀',
              worldSetting: g.worldSetting ?? '',
              interactionExample: g.interactionExample ?? '',
              builtIn: false,
              createdAt: now,
              updatedAt: now
            }
            fileStore.saveWorldPreset(worldPreset)
            settings.activeWorldId = wid
          }
          settings.injectSystemTime = !!g.injectSystemTime
          fileStore.saveSettings(settings)
          broadcastToAll('settings:updated', settings)
          broadcastToAll('presets:updated', null)
        }
      }

      return { ok: true as const, imported, skipped }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:save-avatar', (_, payload: { id: string; buffer: ArrayBuffer; ext: string }) => {
    try {
      const ext = normalizeImageExt(payload.ext)
      if (!ALLOWED_IMAGE_EXT.has(ext)) return { error: '不支援的圖片格式' }
      const buf = Buffer.from(payload.buffer ?? new ArrayBuffer(0))
      if (buf.length > MAX_MEDIA_BYTES) return { error: '檔案超過 10 MB 上限' }
      const dir = safeCharacterDir(payload.id)
      if (!dir) return { error: 'Character not found' }
      const dest = path.join(dir, `avatar-${Date.now()}${ext}`)
      fs.writeFileSync(dest, buf)
      cleanupOldAvatarFiles(dir, dest)
      return { path: dest }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('character:save-emotion-sprite', (_, payload: { id: string; filename: string; buffer: ArrayBuffer; ext: string }) => {
    try {
      const ext = normalizeImageExt(payload.ext)
      if (!ALLOWED_IMAGE_EXT.has(ext)) return { error: '不支援的圖片格式' }
      const buf = Buffer.from(payload.buffer ?? new ArrayBuffer(0))
      if (buf.length > MAX_MEDIA_BYTES) return { error: '檔案超過 10 MB 上限' }
      const dir = safeCharacterDir(payload.id)
      if (!dir) return { error: 'Character not found' }
      const emotionsDir = path.join(dir, 'emotions')
      fs.mkdirSync(emotionsDir, { recursive: true })
      const rawName = payload.filename?.trim() || 'sprite'
      let stem = path.basename(rawName, path.extname(rawName))
      stem = stem.replace(/[^\w.\-()\u4e00-\u9fff]/g, '_') || 'sprite'
      let dest = path.join(emotionsDir, `${stem}${ext}`)
      if (fs.existsSync(dest)) {
        dest = path.join(emotionsDir, `${Date.now()}_${stem}${ext}`)
      }
      fs.writeFileSync(dest, buf)
      return { path: dest }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('file:save-dialog', async (event, opts: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOpts = {
        defaultPath: opts.defaultPath,
        filters: opts.filters ?? [{ name: 'All Files', extensions: ['*'] }]
      }
      const { canceled, filePath } =
        win && !win.isDestroyed()
          ? await dialog.showSaveDialog(win, dialogOpts)
          : await dialog.showSaveDialog(dialogOpts)
      if (canceled || !filePath) return { filePath: undefined }
      return { filePath }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('file:write-file', (_, payload: { path: string; data: ArrayBuffer | string }) => {
    try {
      if (typeof payload.data === 'string') {
        fs.writeFileSync(payload.path, payload.data, 'utf-8')
      } else {
        fs.writeFileSync(payload.path, Buffer.from(payload.data))
      }
      return { ok: true as const }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  // Desktop characters
  ipcMain.handle('desktop:add-character', (_, characterId: string) => {
    if (settings.ui.desktopCharacters.some(d => d.characterId === characterId)) return false
    const char = getCharacter(characterId)
    const size = (char?.lastDesktopSize && Number.isFinite(char.lastDesktopSize) && char.lastDesktopSize > 0)
      ? char.lastDesktopSize : 1
    const flipped = char?.lastDesktopFlipped ?? false
    const defaultPos = { x: 100, y: 400 }
    let position = defaultPos
    if (char?.lastDesktopPosition) {
      const winSize = getCharacterWindowSize(size)
      if (!isPositionOffscreen(char.lastDesktopPosition, winSize)) {
        position = char.lastDesktopPosition
      }
    }
    const state = { characterId, position, size, flipped, muted: false, zIndex: Date.now() }
    settings.ui.desktopCharacters.push(state)
    fileStore.saveSettings(settings)
    createCharacterWindow(characterId, state.position, state.size)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:remove-character', (_, characterId: string) => {
    if (settings.ui.desktopCharacters.length <= 1) return false
    const removing = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (removing) {
      const char = getCharacter(characterId)
      if (char) {
        char.lastDesktopSize = removing.size
        char.lastDesktopFlipped = removing.flipped
        char.lastDesktopPosition = removing.position
        fileStore.saveCharacter(char)
        broadcastToAll('characters:updated', characters)
      }
    }
    settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== characterId)
    fileStore.saveSettings(settings)
    closeCharacterWindow(characterId)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:update-position', (_, characterId: string, pos: { x: number; y: number }) => {
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (d) {
      d.position = pos
      fileStore.saveSettings(settings)
    }
    const win = getCharacterWindow(characterId)
    if (win && !win.isDestroyed()) {
      win.setPosition(Math.round(pos.x), Math.round(pos.y))
    }
    // Pass pos directly so syncSpeechBubblePosition doesn't read stale getBounds() after setPosition.
    syncSpeechBubblePosition(characterId, pos)
    return true
  })

  ipcMain.handle('desktop:update-size', (_, characterId: string, size: number) => {
    const nextSize = Math.min(4, Math.max(0.25, Number(size) || 1))
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    const nextPos = resizeCharacterWindow(characterId, nextSize)
    if (d) {
      d.size = nextPos?.size ?? nextSize
      if (nextPos) d.position = nextPos.position
      fileStore.saveSettings(settings)
      broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    }
    return true
  })

  ipcMain.handle('desktop:preview-size', (_, characterId: string, size: number) => {
    const nextSize = Math.min(4, Math.max(0.25, Number(size) || 1))
    resizeCharacterWindow(characterId, nextSize)
    return true
  })

  ipcMain.handle('desktop:update-flipped', (_, characterId: string, flipped: boolean) => {
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (!d) return false
    d.flipped = !!flipped
    fileStore.saveSettings(settings)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:drag-start', (_, characterId: string, startX: number, startY: number) => {
    const ok = beginCharacterDrag(characterId, startX, startY, pos => {
      const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
      if (d) d.position = pos
    })
    return ok
  })

  ipcMain.on('desktop:drag-move', (_, characterId: string, cursorX: number, cursorY: number) => {
    moveDraggedCharacter(characterId, cursorX, cursorY)
  })

  ipcMain.handle('desktop:drag-end', (_, characterId: string) => {
    const pos = endCharacterDrag(characterId)
    if (pos) {
      reconcileSpeechBubbleAfterCharacterDrag(characterId, pos)
    }
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (d && pos) {
      d.position = pos
      fileStore.saveSettings(settings)
      broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    }
    // 拖曳結束後確保角色保持在便利貼之上（同 z 層）
    bringCharacterToFront(characterId)
    return true
  })

  // Mouse hit-test IPC removed — click-through is handled via CSS pointer-events
  ipcMain.handle('desktop:set-click-through', (_, characterId: string, clickThrough: boolean) => {
    return setCharacterWindowClickThrough(characterId, clickThrough)
  })

  ipcMain.on('desktop:update-hit-rects', (_, characterId: string, rects: {
    sprite: { x: number; y: number; w: number; h: number } | null
    buttons: { x: number; y: number; w: number; h: number } | null
  } | null) => {
    setCharacterHitRects(characterId, rects)
  })

  ipcMain.handle('ui:character-activated', (_, characterId: string) => {
    bringCharacterToFront(characterId)
    return true
  })

  ipcMain.handle('ui:aux-activated', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) return raiseAuxWindowToFront(win)
    raiseAuxAboveCharacters()
    return false
  })

  ipcMain.handle('bubble:set-size', (_, characterId: string, size: { width: number; height: number }) => {
    return updateSpeechBubbleSize(characterId, size)
  })

  ipcMain.handle('bubble:close', (_, characterId: string) => {
    return hideSpeechBubble(characterId)
  })

  ipcMain.handle('bubble:debug-show', (_, payload: { characterId: string; speakerName: string; text: string; emotion?: string }) => {
    const { characterId, speakerName, text, emotion } = payload ?? { characterId: '', speakerName: '', text: '' }
    if (!characterId) return false
    showSpeechBubble(characterId, speakerName || (getCharacter(characterId)?.name ?? '角色'), String(text ?? ''), emotion)
    return true
  })

  ipcMain.handle('user-bubble:set-size', (_, size: { width?: number; height: number }) => {
    return updateUserSpeechBubbleSize(size)
  })

  ipcMain.handle('user-bubble:close', () => {
    return hideUserSpeechBubble()
  })

  ipcMain.handle('user-bubble:debug-show', (_, payload: { speakerName?: string; text: string }) => {
    const speakerName = String(payload?.speakerName ?? getPersonaDisplayName())
    const text = String(payload?.text ?? '')
    if (!text.trim()) return false
    showUserSpeechBubble(speakerName, text)
    return true
  })

  ipcMain.handle('character:set-emotion', (_, payload: { characterId: string; emotion: string }) => {
    const { characterId, emotion } = payload ?? {}
    if (!characterId) return false
    const cw = getCharacterWindow(characterId)
    if (cw && !cw.isDestroyed()) {
      cw.webContents.send('character:display-emotion', { emotion })
    }
    return true
  })

  // Window controls
  ipcMain.handle('window:toggle-input', () => {
    toggleInputWindow()
    return true
  })

  ipcMain.handle('window:toggle-log', () => {
    toggleLogWindow()
    return true
  })

  ipcMain.handle('window:open-log', (_, options?: { focusTitleInput?: boolean }) => {
    openLogWindow(options)
    return true
  })

  ipcMain.handle('log:focus-window', () => {
    const win = getLogWindow()
    if (win && !win.isDestroyed()) win.focus()
    return true
  })

  ipcMain.handle('window:open-settings', (_, tab?: string) => {
    openSettingsWindow(tab)
    return true
  })

  ipcMain.handle('window:close-self', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      suppressAuxAutoHide()
      win.setOpacity(1)
      win.hide()
    }
    return true
  })

  ipcMain.handle('window:open-data-folder', () => {
    shell.openPath(fileStore.getDataDir())
    return true
  })

  // Conversation
  ipcMain.handle('conversation:get', () => getActiveConversation())

  ipcMain.handle('conversation:list', () => {
    const ids = fileStore.listConversationIds()
    const list = ids.map(id => {
      const conv = getOrLoadConversation(id)
      return conv
        ? { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, createdAt: conv.createdAt }
        : { id, title: '對話', updatedAt: 0, createdAt: 0 }
    })
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return list
  })

  ipcMain.handle('conversation:new', () => {
    const conv = createNewConversation()
    broadcastConversationUpdate(conv)
    return conv
  })

  ipcMain.handle('conversation:load', (_, id: string) => {
    const conv = getOrLoadConversation(id)
    if (!conv) return { error: 'Not found' }
    activeConversationId = id
    syncLastActiveConversationToSettings()
    broadcastConversationUpdate(conv)
    return conv
  })

  ipcMain.handle('conversation:rename', (_, title: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.title = String(title || '').trim() || '新對話'
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  ipcMain.handle('conversation:clear', () => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.messages = []
    conv.summary = ''
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    hideAllCharacterSpeechBubbles()
    broadcastConversationUpdate(conv)
    return true
  })

  ipcMain.handle('conversation:delete-current', () => {
    const conv = getActiveConversation()
    if (!conv) return false
    const deletingId = conv.id
    // Remove file + cache
    fileStore.deleteConversation(deletingId)
    conversations.delete(deletingId)
    activeConversationId = null

    // Jump to next conversation with messages (or newest); otherwise create a new one.
    const nextId = pickNextConversationId(deletingId)
    if (nextId) {
      activeConversationId = nextId
      const next = getOrLoadConversation(nextId)
      if (next) {
        syncLastActiveConversationToSettings()
        broadcastConversationUpdate(next)
        return true
      }
    }

    const fresh = createNewConversation()
    broadcastConversationUpdate(fresh)
    return true
  })

  ipcMain.handle('conversation:delete-message', (_, messageId: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.messages = conv.messages.filter(m => m.id !== messageId)
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  ipcMain.handle('conversation:edit-message', (_, payload: { messageId: string; content: string; emotion?: string }) => {
    const conv = getActiveConversation()
    if (!conv) return false
    const msg = conv.messages.find(m => m.id === payload.messageId)
    if (!msg) return false
    msg.content = String(payload.content ?? '')
    if (payload.emotion !== undefined) {
      msg.emotion = payload.emotion
    }
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  // Messaging
  ipcMain.handle('message:send', async (_, payload: { content: string; images?: string[] }) => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    const userContentForPrompt = payload.content

    // Add user message
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: payload.content,
      images: payload.images,
      timestamp: Date.now()
    }
    conv.messages.push(userMsg)
    broadcastConversationUpdate(conv)
    const shownUserText = String(payload.content ?? '').trim()
    if (shownUserText) {
      showUserSpeechBubble(getPersonaDisplayName(), shownUserText)
    }
    const userMsgForPrompt: Message = { ...userMsg, content: userContentForPrompt }

    const desktopAll = settings.ui.desktopCharacters.map(d => d.characterId)
    const desktopResponders = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)
    const desktopCharacterNames = desktopAll.map(id => getCharacter(id)?.name ?? '').filter(Boolean)

    // If user mentioned a name/nickname, that character should respond first (and definitely respond if not muted).
    const mentionedAll = desktopAll.filter(id => {
      const c = getCharacter(id)
      return c ? isAddressed(payload.content, c) : false
    })
    const mentionedIds = mentionedAll.filter(id => desktopResponders.includes(id))

    const respondingIds = mentionedIds.length > 0
      ? [
        ...shuffleIds(mentionedIds),
        ...shuffleIds(desktopResponders.filter(id => !mentionedIds.includes(id)))
      ]
      : shuffleIds(desktopResponders)

    if (respondingIds.length === 0) {
      // If there are desktop characters but all are muted, surface a hint in conversation.
      if (desktopAll.length > 0) {
        const hinted = mentionedAll.length > 0
          ? `你點名的角色目前在禁言狀態（${mentionedAll.map(id => getCharacter(id)?.name ?? '角色').join('、')}）。`
          : '所有桌面角色目前都在禁言狀態。'
        const hintMsg: Message = {
          id: uuidv4(),
          role: 'system',
          content: `[提示] ${hinted} 請在角色旁邊點「🔊」解除禁言後再試。`,
          llmProvider: settings.llm.provider,
          llmModel: resolveModel(settings),
          timestamp: Date.now()
        }
        conv.messages.push(hintMsg)
        broadcastConversationUpdate(conv)
      }
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    const primaryId = pickPrimaryResponderId(respondingIds, mentionedIds)
    if (!primaryId) return { ok: true }

    const primaryChar = getCharacter(primaryId)
    if (!primaryChar) return { ok: true }

    const recentMessagesBase = [...conv.messages.slice(0, -1), userMsgForPrompt].slice(-(settings.memory.keepRecentN))
    let lastReplyText = ''

    // 1) Primary responder always replies
    try {
      raiseCharactersAbovePinnedNotes()
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: true })
      const { content, emotion, debugPrompt } = await chatWithLLM({
        settings,
        character: primaryChar,
        messages: recentMessagesBase,
        images: payload.images,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames
      })
      const primaryReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, primaryChar),
        primaryChar.id
      )
      if (!primaryReply) {
        throw new Error('模型輸出包含其他角色台詞，已拒絕這次回覆。')
      }
      userMsg.debugPrompt = debugPrompt
      lastReplyText = primaryReply
      const charMsg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId: primaryId,
        content: primaryReply,
        llmProvider: settings.llm.provider,
        llmModel: resolveModel(settings),
        debugPrompt,
        emotion,
        timestamp: Date.now()
      }
      conv.messages.push(charMsg)
      conv.updatedAt = Date.now()
      broadcastConversationUpdate(conv)
      broadcastToAll('character:new-message', { characterId: primaryId, message: charMsg })
      showSpeechBubble(primaryId, primaryChar.name, primaryReply)
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: false })
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errMsg2: Message = {
        id: uuidv4(),
        role: 'system',
        content: `[錯誤] ${errMsg}`,
        llmProvider: settings.llm.provider,
        llmModel: resolveModel(settings),
        timestamp: Date.now()
      }
      conv.messages.push(errMsg2)
      broadcastConversationUpdate(conv)
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: false })
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    // 2) Others: only reply if they have a distinct thought
    // Persist the primary character's bubble so it doesn't auto-close while waiting for secondaries.
    // Delay ensures the renderer has already processed bubble:show and started the close timer.
    setTimeout(() => persistSpeechBubble(primaryId), 350)

    // maxGroupRounds controls how many additional (non-primary) character replies can be appended.
    const maxAdditionalReplies = Math.max(0, Math.floor(Number(settings.llm.maxGroupRounds) || 0))
    const others = respondingIds
      .filter(id => id !== primaryId)
      .slice(0, maxAdditionalReplies)
    for (const charId of others) {
      const char = getCharacter(charId)
      if (!char) continue

      try {
        raiseCharactersAbovePinnedNotes()
        broadcastToAll('character:thinking', { characterId: charId, thinking: true })
        const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
        const { content: reply, emotion, debugPrompt } = await chatWithLLM({
          settings,
          character: char,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById(),
          persona: activePersona,
          world: activeWorld,
          desktopCharacterNames
        })
        const cleanReply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(reply.trim(), char),
          char.id
        )

        if (!cleanReply) {
          broadcastToAll('character:thinking', { characterId: charId, thinking: false })
          continue
        }
        // Skip near-duplicates
        const replyNorm = normalizeForCompare(cleanReply)
        const lastNorm = normalizeForCompare(lastReplyText)
        if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
          broadcastToAll('character:thinking', { characterId: charId, thinking: false })
          continue
        }

        const charMsg: Message = {
          id: uuidv4(),
          role: 'character',
          characterId: charId,
          content: cleanReply,
          llmProvider: settings.llm.provider,
          llmModel: resolveModel(settings),
          debugPrompt,
          emotion: normalizeEmotion(emotion) || 'neutral',
          timestamp: Date.now()
        }
        lastReplyText = cleanReply
        conv.messages.push(charMsg)
        conv.updatedAt = Date.now()
        broadcastConversationUpdate(conv)
        broadcastToAll('character:new-message', { characterId: charId, message: charMsg })
        showSpeechBubble(charId, char.name, cleanReply)
        broadcastToAll('character:thinking', { characterId: charId, thinking: false })
      } catch (e: unknown) {
        // If a secondary decision fails, don't break the whole send flow.
        broadcastToAll('character:thinking', { characterId: charId, thinking: false })
      }
    }

    fileStore.saveConversation(conv)
    return { ok: true }
  })

  // Force speak: one character speaks now
  ipcMain.handle('character:force-speak', async (_, characterId: string) => {
    const conv = getActiveConversation()
    const char = getCharacter(characterId)
    if (!conv || !char) return { error: 'Not found' }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    raiseCharactersAbovePinnedNotes()
    broadcastToAll('character:thinking', { characterId, thinking: true })
    try {
      const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
      const desktopCharNamesForce = settings.ui.desktopCharacters.map(d => getCharacter(d.characterId)?.name ?? '').filter(Boolean)
      const { content, emotion, debugPrompt } = await chatWithLLM({
        settings,
        character: char,
        messages: recentMessages,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames: desktopCharNamesForce
      })
      const forcedReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, char),
        char.id
      )
      if (!forcedReply) {
        return { error: '模型輸出包含其他角色台詞，已拒絕這次強制發話。' }
      }
      const msg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId,
        content: forcedReply,
        llmProvider: settings.llm.provider,
        llmModel: resolveModel(settings),
        debugPrompt,
        emotion,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      fileStore.saveConversation(conv)
      broadcastConversationUpdate(conv)
      broadcastToAll('character:new-message', { characterId, message: msg })
      showSpeechBubble(characterId, char.name, forcedReply)
      return { ok: true }
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) }
    } finally {
      broadcastToAll('character:thinking', { characterId, thinking: false })
    }
  })

  // Mute toggle
  ipcMain.handle('desktop:toggle-mute', (_, characterId: string) => {
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (!d) return false
    d.muted = !d.muted
    fileStore.saveSettings(settings)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return d.muted
  })

  // Emoji picker window
  ipcMain.handle('emoji-picker:open', (_, buttonScreenX: number, buttonScreenY: number) => {
    const W = 352
    const H = 460
    const iw = getInputWindow()
    const offset = settings.ui.emojiPickerOffset
    let x: number
    let y: number
    if (iw && offset) {
      // Restore relative position to input window
      const ib = iw.getBounds()
      x = ib.x + offset.x
      y = ib.y + offset.y
    } else {
      // First time: open above and right-aligned to the button
      x = Math.round(buttonScreenX) - W
      y = Math.round(buttonScreenY) - H - 10
    }
    createEmojiPickerWindow(x, y, (newOffset) => {
      settings.ui.emojiPickerOffset = newOffset
      fileStore.saveSettings(settings)
    })
    return true
  })

  ipcMain.handle('emoji-picker:close', () => {
    closeEmojiPickerWindow()
    return true
  })

  ipcMain.handle('emoji-picker:select', (_, unicode: string) => {
    closeEmojiPickerWindow()
    broadcastToAll('emoji-picker:selected', unicode)
    return true
  })

  // Image preview window
  ipcMain.handle('desktop:show-image-preview', (_, payload: string | { images?: string[]; index?: number }) => {
    if (typeof payload === 'string') {
      showPreviewWindow(payload)
      return true
    }
    const images = Array.isArray(payload?.images)
      ? payload.images.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    const indexRaw = Number(payload?.index ?? 0)
    const index = Number.isFinite(indexRaw) ? Math.max(0, Math.floor(indexRaw)) : 0
    showPreviewWindow({ images, index })
    return true
  })

  // Screenshot: hide windows, capture screen, restore, return data URL
  ipcMain.handle('desktop:capture-screenshot', async () => {
    const info = hideAllWindowsForScreenshot()
    await new Promise(resolve => setTimeout(resolve, 300))
    try {
      const all = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: info.displayWidth, height: info.displayHeight }
      })
      const source = all.find(s => parseInt(s.display_id) === info.displayId) ?? all[0]
      if (!source) return { ok: false, error: 'No screen source found' }
      const dataUrl = source.thumbnail.toDataURL()
      if (!dataUrl || dataUrl.length < 100) return { ok: false, error: 'Empty thumbnail' }
      try {
        copyDataUrlImageToClipboard(dataUrl)
      } catch (clipboardErr) {
        console.warn('[Screenshot] Clipboard write failed:', clipboardErr)
      }
      return { ok: true, dataUrl }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      restoreAllWindowsAfterScreenshot()
    }
  })

  // Screenshot: keep character/bubble windows, hide UI windows, return data URL
  ipcMain.handle('desktop:capture-screenshot-with-characters', async () => {
    const info = hideAuxWindowsForScreenshotKeepingCharacters()
    await new Promise(resolve => setTimeout(resolve, 300))
    try {
      const all = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: info.displayWidth, height: info.displayHeight }
      })
      const source = all.find(s => parseInt(s.display_id) === info.displayId) ?? all[0]
      if (!source) return { ok: false, error: 'No screen source found' }
      const dataUrl = source.thumbnail.toDataURL()
      if (!dataUrl || dataUrl.length < 100) return { ok: false, error: 'Empty thumbnail' }
      try {
        copyDataUrlImageToClipboard(dataUrl)
      } catch (clipboardErr) {
        console.warn('[Screenshot] Clipboard write failed:', clipboardErr)
      }
      return { ok: true, dataUrl }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally {
      restoreAllWindowsAfterScreenshot()
    }
  })

  // LLM connection test: verify API key (provider-aware)
  ipcMain.handle('llm:test-connection', async (_, payload?: { apiKey?: string; apiKeys?: Record<string, string>; endpoint?: string; provider?: string }) => {
    const provider = payload?.provider?.trim() || settings.llm.provider || 'openai'
    const apiKeys = { ...settings.llm.apiKeys, ...payload?.apiKeys }
    const apiKey = payload?.apiKey?.trim() || settings.llm.apiKey?.trim() || ''
    return testLLMConnection({ provider, apiKey, apiKeys, endpoint: payload?.endpoint?.trim() || settings.llm.endpoint?.trim() || undefined })
  })

  // LLM test message: send a minimal prompt and return the reply (provider-aware)
  ipcMain.handle('llm:test-message', async (_, payload?: { apiKey?: string; apiKeys?: Record<string, string>; endpoint?: string; model?: string; provider?: string }) => {
    const provider = payload?.provider?.trim() || settings.llm.provider || 'openai'
    const apiKeys = { ...settings.llm.apiKeys, ...payload?.apiKeys }
    const apiKey = payload?.apiKey?.trim() || settings.llm.apiKey?.trim() || ''
    return testLLMMessage({ provider, apiKey, apiKeys, model: payload?.model?.trim() || resolveModel(settings).trim(), endpoint: payload?.endpoint?.trim() || settings.llm.endpoint?.trim() || undefined })
  })

  // Import ST character card (JSON)
  ipcMain.handle('character:import-json', (_, jsonStr: string) => {
    try {
      const raw = JSON.parse(jsonStr)
      const id = uuidv4()
      const char = importStJson(raw, id)
      characters.push(char)
      fileStore.saveCharacter(char)
      broadcastToAll('characters:updated', characters)
      return char
    } catch (e) {
      return { error: String(e) }
    }
  })

  // ── Persona Presets ──────────────────────────────────────
  ipcMain.handle('presets:persona:list', () => fileStore.loadPersonaPresets())

  ipcMain.handle('presets:persona:save', (_, preset: PersonaPreset) => {
    preset.updatedAt = Date.now()
    fileStore.savePersonaPreset(preset)
    broadcastToAll('presets:updated', null)
    return true
  })

  ipcMain.handle('presets:persona:delete', (_, id: string) => {
    fileStore.deletePersonaPreset(id)
    if (settings.activePersonaId === id) {
      const remaining = fileStore.loadPersonaPresets()
      settings.activePersonaId = remaining[0]?.id ?? ''
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    }
    broadcastToAll('presets:updated', null)
    return true
  })

  // ── World Presets ────────────────────────────────────────
  ipcMain.handle('presets:world:list', () => fileStore.loadWorldPresets())

  ipcMain.handle('presets:world:save', (_, preset: WorldPreset) => {
    preset.updatedAt = Date.now()
    fileStore.saveWorldPreset(preset)
    broadcastToAll('presets:updated', null)
    return true
  })

  ipcMain.handle('presets:world:delete', (_, id: string) => {
    fileStore.deleteWorldPreset(id)
    if (settings.activeWorldId === id) {
      const remaining = fileStore.loadWorldPresets()
      settings.activeWorldId = remaining[0]?.id ?? ''
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    }
    broadcastToAll('presets:updated', null)
    return true
  })

  ipcMain.handle('shell:open-external', (_, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('app:open-api-guide', () => {
    const appRoot = app.getAppPath()
    const guideFile = path.join(appRoot, 'docs/api-key-guide.html')
    return shell.openPath(guideFile)
  })

  // ── Pinned Notes ──────────────────────────────────────────
  const DEFAULT_NOTE_COLOR = '#FFE8AA'
  function defaultNoteFontSize(): number {
    const map: Record<string, number> = { xs: 12, sm: 13, md: 14, lg: 16, xl: 18 }
    return map[settings.ui.chatFontSize ?? 'md'] ?? 14
  }

  function savePinnedNotes() {
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
  }

  const PINNED_NOTE_WARN_LIMIT = 50
  const PINNED_NOTE_DOUBLE_CONFIRM_LIMIT = 100

  function getPinnedNoteLimitWarning(force: unknown): { needsConfirm: true; level: 'warn' | 'double'; count: number } | null {
    if (force === true) return null
    const count = settings.ui.pinnedNotes?.length ?? 0
    if (count >= PINNED_NOTE_DOUBLE_CONFIRM_LIMIT) return { needsConfirm: true, level: 'double', count }
    if (count >= PINNED_NOTE_WARN_LIMIT) return { needsConfirm: true, level: 'warn', count }
    return null
  }

  // 建立便利貼（角色便利貼每角色上限 10 張，超出需 force=true 才清理最舊的）
  ipcMain.handle('pinned-note:create', (_, characterId: string, title: string, position: { x: number; y: number }, content: string, force?: boolean, sourceRect?: { x: number; y: number; width: number; height: number }) => {
    if (!settings.ui.pinnedNotes) settings.ui.pinnedNotes = []

    const limitWarning = getPinnedNoteLimitWarning(force)
    if (limitWarning) return limitWarning

        // force=true：刪最舊的幾張，讓總數降到 limit-1 以空出位置
    const id = uuidv4()
    // 如果有 characterId，嘗試從泡泡視窗取得真實螢幕座標與大小
    let notePos = position
    let noteSize: { width: number; height: number } | undefined
    if (characterId) {
      const bubbleWin = getBubbleWindow(characterId)
      if (bubbleWin && !bubbleWin.isDestroyed()) {
        const b = bubbleWin.getBounds()
        const rect = sourceRect && Number.isFinite(sourceRect.width) && Number.isFinite(sourceRect.height)
          ? sourceRect
          : null
        notePos = rect
          ? { x: b.x + Math.round(rect.x), y: b.y + Math.round(rect.y) }
          : { x: b.x, y: b.y }
        noteSize = rect
          ? { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
          : { width: b.width, height: b.height }
      }
    }
    const noteContent = characterId ? parseEmotion(content).content : content
    const note: PinnedNote = {
      id,
      characterId,
      title: title || '便利貼',
      content: noteContent,
      color: DEFAULT_NOTE_COLOR,
      visible: true,
      position: notePos,
      size: noteSize,
      fontSize: defaultNoteFontSize(),
      updatedAt: Date.now()
    }
    settings.ui.pinnedNotes.push(note)
    createPinnedNoteWindow(id, notePos, noteContent, title, note.color, noteSize, note.fontSize)
    savePinnedNotes()
    return { noteId: id }
  })

  // 收起便利貼：關閉視窗，但保留資料（visible=false）
  ipcMain.handle('pinned-note:hide', async (_, noteId: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (!note) return false
    // 記住最新位置與大小再關窗
    const b = await getPinnedNoteWindowState(noteId)
    if (b) {
      note.position = { x: b.x, y: b.y }
      note.size = { width: b.width, height: b.height }
    }
    note.visible = false
    note.updatedAt = Date.now()
    closePinnedNote(noteId)
    savePinnedNotes()
    return true
  })

  // 還原便利貼到桌面（從管理介面貼回）
  ipcMain.handle('pinned-note:restore', (_, noteId: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (!note) return false
    note.visible = true
    note.updatedAt = Date.now()
    savePinnedNotes()
    // Defer BrowserWindow creation to next tick so the IPC response is sent first,
    // preventing the window-creation cost from blocking the main thread during the reply.
    setImmediate(() => {
      createPinnedNoteWindow(note.id, note.position, note.content, note.title, note.color, note.size, note.fontSize)
      focusPinnedNoteWindow(note.id)
    })
    return true
  })

  // 真正刪除便利貼
  ipcMain.handle('pinned-note:focus', (_, noteId: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (!note) return false
    if (!note.visible) {
      note.visible = true
      note.updatedAt = Date.now()
      createPinnedNoteWindow(note.id, note.position, note.content, note.title, note.color, note.size, note.fontSize)
      savePinnedNotes()
    }
    return focusPinnedNoteWindow(note.id)
  })

  ipcMain.handle('pinned-note:hide-all', async () => {
    const notes = settings.ui.pinnedNotes ?? []
    const visible = notes.filter(n => n.visible)
    const bounds = await Promise.all(visible.map(n => getPinnedNoteWindowState(n.id)))
    visible.forEach((note, i) => {
      const b = bounds[i]
      if (b) {
        note.position = { x: b.x, y: b.y }
        note.size = { width: b.width, height: b.height }
      }
      note.visible = false
      note.updatedAt = Date.now()
      closePinnedNote(note.id)
    })
    savePinnedNotes()
    return true
  })

  ipcMain.handle('pinned-note:delete-all', () => {
    const notes = settings.ui.pinnedNotes ?? []
    for (const note of notes) closePinnedNote(note.id)
    settings.ui.pinnedNotes = []
    savePinnedNotes()
    return true
  })

  ipcMain.handle('pinned-note:delete', (_, noteId: string) => {
    closePinnedNote(noteId)
    if (settings.ui.pinnedNotes) {
      settings.ui.pinnedNotes = settings.ui.pinnedNotes.filter(n => n.id !== noteId)
      savePinnedNotes()
    }
    return true
  })

  ipcMain.handle('pinned-note:update-content', (_, noteId: string, content: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      note.content = content
      note.updatedAt = Date.now()
      updatePinnedNoteContent(noteId, content)
      savePinnedNotes()
    }
    return true
  })

  ipcMain.handle('pinned-note:update-title', (_, noteId: string, title: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      note.title = title
      note.updatedAt = Date.now()
      savePinnedNotes()
    }
    return true
  })

  ipcMain.handle('pinned-note:update-color', (_, noteId: string, color: string) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      note.color = color
      note.updatedAt = Date.now()
      updatePinnedNoteColor(noteId, color)
      savePinnedNotes()
    }
    return true
  })

  ipcMain.handle('pinned-note:update-font-size', (_, noteId: string, fontSize: number | null) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      if (fontSize === null) {
        delete note.fontSize
      } else {
        note.fontSize = Math.max(11, Math.min(48, fontSize))
      }
      note.updatedAt = Date.now()
      savePinnedNotes()
    }
    return true
  })

  ipcMain.handle('pinned-note:show-color-menu', (_, noteId: string, anchor?: { x: number; y: number; width: number; height: number }) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (!note) return false
    return showPinnedNoteColorMenu(noteId, note.color, anchor)
  })

  ipcMain.handle('pinned-note:update-position', (_, noteId: string, position: { x: number; y: number }) => {
    const note = settings.ui.pinnedNotes?.find(n => n.id === noteId)
    if (note) {
      note.position = position
      note.updatedAt = Date.now()
      fileStore.saveSettings(settings)
    }
    return true
  })

  ipcMain.handle('pinned-note:get-position', (_, noteId: string) => {
    const win = getPinnedNoteWindow(noteId)
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds()
      return { x: bounds.x, y: bounds.y }
    }
    return null
  })

  ipcMain.handle('pinned-note:list', () => {
    // 清洗舊版資料，防止欄位型別錯誤（e.g. title 被存成 {x,y} position）
    return (settings.ui.pinnedNotes ?? []).map(n => ({
      ...n,
      title: typeof n.title === 'string' ? n.title : '便利貼',
      content: typeof n.content === 'string' ? n.content : '',
      color: typeof n.color === 'string' ? n.color : '#FFE8AA',
      visible: typeof n.visible === 'boolean' ? n.visible : true,
    }))
  })

  ipcMain.handle('pinned-note:open-manager', () => {
    openPinnedNotesManager()
    return true
  })
}
