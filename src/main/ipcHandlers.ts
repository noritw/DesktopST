import { ipcMain, shell, BrowserWindow, dialog, app, desktopCapturer, clipboard, nativeImage, screen, type WebContents } from 'electron'
import { checkForUpdates } from './updateChecker'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, Character, Conversation, Message, PersonaPreset, WorldPreset, ScenePreset, PinnedNote, Reminder, RandomResult } from './types'
import * as fileStore from './fileStore'
import { chatWithLLM, testLLMConnection, testLLMMessage, applyUtilitySettings, classifyEmotionWithLLM } from './llm/index'
import { normalizeEmotion, buildEmotionIdList, parseEmotion, resolveModel, messageLlmMeta } from './llm/promptUtils'
import { extractCharaJson, embedCharaJson, getExportPngBaseBuffer } from './pngUtils'
import { importStJson, exportToStJson } from './stCardMapper'
import {
  buildDstPackBuffer,
  extractCharacterDirFromZip,
  loadDstPackZip,
  readCharacterFromZip
} from './dstPack'
import { reloadReminders, setIdleSkipMinutes } from './reminderScheduler'
import {
  geocodeCity, detectLocationByIP, fetchWeather, getCachedWeatherData,
  getWeatherContextString, invalidateWeatherCache
} from './weatherService'
import {
  buildAuthUrl, handleAuthCallback, clearAuthFile, isAuthenticated, getSpotifyContextString
} from './spotifyService'
import { isDevToolsAllowed, toggleDevToolsForWindow } from './devTools'
import {
  createCharacterWindow, closeCharacterWindow, getCharacterWindow, destroyAllCharacterWindows,
  resizeCharacterWindow, getCharacterWindowSize, enterCharacterScaleMode, exitCharacterScaleMode, enterScaleModeWindow,
  toggleInputWindow, toggleLogWindow, openLogWindow, openSettingsWindow,
  broadcastToAll, broadcastDesktopCharactersToCharacterWindows, getAllCharacterWindows, setCharacterWindowClickThrough,
  restoreAuxWindowsFromRememberedState, bringCharacterToFront, raiseAuxAboveCharacters, raiseAuxWindowToFront,
  hideSpeechBubble, persistSpeechBubble, hideAllCharacterSpeechBubbles, updateSpeechBubbleSize, syncSpeechBubblePosition,
  showUserSpeechBubble, hideUserSpeechBubble, updateUserSpeechBubbleSize,
  reconcileSpeechBubbleAfterCharacterDrag, setCharacterHitRects, setCharacterInteractable, updateSpriteActualHeight,
  beginCharacterDrag, moveDraggedCharacter, endCharacterDrag, suppressAuxAutoHide, configureAuxWindowPersistence,
  setUnfocusedBubbleOpacity, setCharactersAlwaysOnTop, getCharactersAlwaysOnTop, setCharacterAlwaysOnTop,
  createCharacterLibraryWindow,
  hideAllWindowsForScreenshot, prepareScreenshotKeepingDesktopST, restoreAllWindowsAfterScreenshot,
  showPreviewWindow,
  createPinnedNoteWindow, updatePinnedNoteContent, updatePinnedNoteColor, closePinnedNote, getPinnedNoteWindow, getPinnedNoteWindowState,
  openPinnedNotesManager, closePinnedNotesManager, configurePinnedNotePersistence, getBubbleWindow,
  openRemindersManager, closeRemindersManager,
  openSpotifySettingsWindow, closeSpotifySettingsWindow,
  hideAllAuxWindowsExceptPinnedNotes, focusPinnedNoteWindow, showPinnedNoteColorMenu,
  createEmojiPickerWindow, closeEmojiPickerWindow, getEmojiPickerWindow,
  createRandomToolsWindow, closeRandomToolsWindow,
  getInputWindow,
  getLogWindow, getVisibleAuxWindowSnapshot, restoreAuxWindowsFromSnapshot, getVisiblePinnedNoteWindowIds,
  broadcastConversationUpdate,
  deferBroadcastConversationUpdate,
  scheduleConversationBroadcast,
  flushConversationBroadcast,
  stripConversationForLog,
  setCharacterThinking,
  raiseCharacterAbovePinnedNotes,
  sendCharacterContextUpdate,
  showSpeechBubble,
  type BubbleAnchorFallback,
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

function centerWindowInPrimary(winSize: { width: number; height: number }): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(wa.x + (wa.width - winSize.width) / 2),
    y: Math.round(wa.y + (wa.height - winSize.height) / 2)
  }
}

function sameRecoveredPosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 16 && Math.abs(a.y - b.y) <= 16
}

function spreadDesktopCharacters(indices: number[]): boolean {
  if (indices.length === 0) return false

  const wa = screen.getPrimaryDisplay().workArea
  const gap = 24
  const margin = 32
  const sizes = indices.map(i => {
    const state = settings.ui.desktopCharacters[i]
    const scale = Number.isFinite(state.size) && state.size > 0 ? state.size : 1
    return getCharacterWindowSize(scale)
  })
  const cellW = Math.max(...sizes.map(s => s.width)) + gap
  const cellH = Math.max(...sizes.map(s => s.height)) + gap
  const columns = Math.max(1, Math.floor((wa.width - margin * 2 + gap) / cellW))
  const totalRows = Math.ceil(indices.length / columns)
  const maxH = Math.max(...sizes.map(s => s.height))
  const rowStep = totalRows > 1
    ? Math.min(cellH, Math.max(48, (wa.height - margin * 2 - maxH) / (totalRows - 1)))
    : 0

  let changed = false
  indices.forEach((stateIndex, n) => {
    const size = sizes[n]
    const row = Math.floor(n / columns)
    const col = n % columns
    const rowCount = row === totalRows - 1
      ? indices.length - row * columns
      : columns
    const rowWidth = rowCount * cellW - gap
    const startX = wa.x + Math.round((wa.width - rowWidth) / 2)
    const x = startX + col * cellW + Math.round((cellW - gap - size.width) / 2)
    const maxY = wa.y + wa.height - margin - size.height
    const minY = wa.y + margin
    const y = Math.max(minY, Math.min(maxY - row * rowStep, maxY))
    const next = { x: Math.round(x), y: Math.round(y) }
    const current = settings.ui.desktopCharacters[stateIndex].position
    if (current.x !== next.x || current.y !== next.y) {
      settings.ui.desktopCharacters[stateIndex].position = next
      changed = true
    }
  })

  return changed
}

function repairDesktopCharacterLayout(): boolean {
  let changed = false
  const moved = new Set<number>()
  const offscreen = new Set<number>()

  settings.ui.desktopCharacters.forEach((state, i) => {
    const scale = Number.isFinite(state.size) && state.size > 0 ? state.size : 1
    const winSize = getCharacterWindowSize(scale)
    if (isPositionOffscreen(state.position, winSize)) offscreen.add(i)
  })

  if (offscreen.size === 1) {
    const i = [...offscreen][0]
    const scale = Number.isFinite(settings.ui.desktopCharacters[i].size) && settings.ui.desktopCharacters[i].size > 0
      ? settings.ui.desktopCharacters[i].size
      : 1
    settings.ui.desktopCharacters[i].position = centerWindowInPrimary(getCharacterWindowSize(scale))
    moved.add(i)
    changed = true
  } else if (offscreen.size > 1) {
    const indices = [...offscreen]
    changed = spreadDesktopCharacters(indices) || changed
    indices.forEach(i => moved.add(i))
  }

  const grouped = new Set<number>()
  for (let i = 0; i < settings.ui.desktopCharacters.length; i++) {
    if (grouped.has(i)) continue
    const group = [i]
    for (let j = i + 1; j < settings.ui.desktopCharacters.length; j++) {
      if (grouped.has(j)) continue
      if (sameRecoveredPosition(settings.ui.desktopCharacters[i].position, settings.ui.desktopCharacters[j].position)) {
        group.push(j)
      }
    }
    if (group.length < 2) continue
    group.forEach(idx => grouped.add(idx))
    if (group.every(idx => moved.has(idx))) continue
    changed = spreadDesktopCharacters(group) || changed
    group.forEach(idx => moved.add(idx))
  }

  return changed
}

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

function formatRandomResultForPrompt(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return `抽籤結果：${result.result}`
    case 'jiao': return `擲茭結果：${result.result}`
    case 'coin': return `硬幣結果：${result.result}`
    case 'dice': {
      const { faces, count, rolls, kept, keepHighest, keepLowest, modifier, total } = result
      const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ''
      const khkl = keepHighest != null ? `kh${keepHighest}` : keepLowest != null ? `kl${keepLowest}` : ''
      const notation = `${count}d${faces}${khkl}${modStr}`

      const hasKeep = kept.length < count
      if (hasKeep) {
        // e.g. 4d6kh3＋2 = 15（骰出：5,4,6,3，採計：5+4+6+2，修正已計入）
        const keptStr = kept.join('+')
        const modPart = modifier !== 0 ? `${modStr}=${total}，修正已計入` : `=${total}`
        return `骰子結果：${notation} = ${total}（骰出：${rolls.join(', ')}，採計：${keptStr}${modPart}）`
      }

      if (count === 1) {
        if (modifier === 0) {
          // 最簡單情況：1d20 = 9
          return `骰子結果：${notation} = ${total}`
        }
        // 單顆骰有修正值：最容易被 LLM 重複加的情況，明確說明
        // e.g. 骰子結果：1d20+3 = 12（骰面 9，修正 +3 已計入）
        return `骰子結果：${notation} = ${total}（骰面 ${rolls[0]}，修正 ${modStr} 已計入，最終結果 ${total}）`
      }

      // 多顆骰，有或無修正值
      // e.g. 2d6+3 = 12（4+5+3，修正已計入）
      const parts: string[] = kept.map(String)
      if (modifier !== 0) parts.push(modStr)
      return `骰子結果：${notation} = ${total}（${parts.join('')}，修正已計入）`
    }
  }
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

function findLastCharacterMessage(conv: Conversation | null, characterId: string): Message | null {
  if (!conv?.messages?.length) return null
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m.role === 'character' && m.characterId === characterId) return m
  }
  return null
}

function characterContextFromMessage(msg: Message | null): { id: string; emotion?: string } | undefined {
  if (!msg) return undefined
  return { id: msg.id, emotion: msg.emotion }
}

function syncCharacterContextsFromConversation(conv: Conversation | null): void {
  for (const d of settings.ui.desktopCharacters) {
    const last = findLastCharacterMessage(conv, d.characterId)
    sendCharacterContextUpdate(d.characterId, {
      lastMessage: characterContextFromMessage(last)
    })
  }
}

function deferRaiseCharacterAbovePinnedNotes(characterId: string): void {
  setImmediate(() => raiseCharacterAbovePinnedNotes(characterId))
}

function bubbleAnchorForCharacter(characterId: string): BubbleAnchorFallback | null {
  const ds = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
  if (ds) return { position: ds.position, size: ds.size }
  const char = getCharacter(characterId)
  if (char?.lastDesktopPosition) {
    return {
      position: char.lastDesktopPosition,
      size: char.lastDesktopSize && char.lastDesktopSize > 0 ? char.lastDesktopSize : 1
    }
  }
  return null
}

function windowTypeFromSender(sender: WebContents): string | null {
  try {
    const url = sender.getURL()
    const q = url.indexOf('?')
    if (q < 0) return null
    return new URLSearchParams(url.slice(q + 1)).get('w')
  } catch {
    return null
  }
}

function characterIdFromSender(sender: WebContents): string | null {
  try {
    const url = sender.getURL()
    const q = url.indexOf('?')
    if (q < 0) return null
    const params = new URLSearchParams(url.slice(q + 1))
    if (params.get('w') !== 'character') return null
    const id = params.get('id')?.trim()
    return id || null
  } catch {
    return null
  }
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

  // 如果是相對路徑，轉換為絕對路徑
  if (avatar && !path.isAbsolute(avatar)) {
    avatar = path.resolve(dir, avatar)
  }

  if (!avatar || !fs.existsSync(avatar)) {
    // 先找固定名稱，再用正則搜索（支援帶時間戳的 avatar-xxxxxxxx.png）
    const fixedCand = ['avatar.png', 'avatar.jpg', 'avatar.jpeg', 'avatar.webp', 'avatar.gif']
      .map(n => path.join(dir, n))
      .find(p => fs.existsSync(p))
    if (fixedCand) {
      avatar = fixedCand
    } else {
      const avatarFile = fs.readdirSync(dir).find(f =>
        /^avatar[-.]?\w*\.(png|jpg|jpeg|webp)$/i.test(f)
      )
      avatar = avatarFile ? path.join(dir, avatarFile) : ''
    }
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
    let v = emotions[k]
    if (!v) continue

    // 如果是相對路徑，轉換為絕對路徑
    if (!path.isAbsolute(v)) {
      v = path.resolve(dir, v)
    }

    if (fs.existsSync(v)) {
      emotions[k] = v
      continue
    }

    const base = path.basename(v || '')
    if (!base) {
      emotions[k] = ''
      continue
    }
    const inEmo = path.join(dir, 'emotions', base)
    const inRoot = path.join(dir, base)
    emotions[k] = fs.existsSync(inEmo) ? inEmo : fs.existsSync(inRoot) ? inRoot : ''
  }

  // 同樣修復 spriteIds 的路徑
  const spriteIds: Record<string, string> = { ...(char.spriteIds || {}) }
  for (const [k, v] of Object.entries(spriteIds)) {
    if (!k) continue
    let resolvedKey = k
    // 如果 key 是相對路徑，轉換為絕對路徑
    if (!path.isAbsolute(k)) {
      resolvedKey = path.resolve(dir, k)
    }
    spriteIds[resolvedKey] = v
    if (resolvedKey !== k) delete spriteIds[k]
  }

  return { ...char, avatar, emotions, spriteIds: Object.keys(spriteIds).length > 0 ? spriteIds : char.spriteIds }
}

function resolveAssetsFromSourcePath(char: Character, sourcePath?: string): Character {
  const src = (sourcePath ?? '').trim()
  if (!src) return char
  const baseDir = path.dirname(src)
  if (!baseDir || !fs.existsSync(baseDir)) return char

  const resolveOne = (rawPath: string, subDir?: string): string => {
    const input = rawPath.trim()
    if (!input) return ''
    if (path.isAbsolute(input) && fs.existsSync(input)) return input

    const fileName = path.basename(input)
    if (!fileName) return input
    const candidates = [path.join(baseDir, fileName)]
    if (subDir) candidates.push(path.join(baseDir, subDir, fileName))
    const hit = candidates.find(p => fs.existsSync(p))
    return hit ?? input
  }

  const emotions: Record<string, string> = {}
  for (const [k, v] of Object.entries(char.emotions ?? {})) {
    emotions[k] = resolveOne(v, 'emotions')
  }

  const spriteIds: Record<string, string> = {}
  for (const [k, v] of Object.entries(char.spriteIds ?? {})) {
    const nextKey = resolveOne(k, 'emotions')
    if (!nextKey) continue
    spriteIds[nextKey] = v
  }

  return {
    ...char,
    avatar: resolveOne(char.avatar ?? ''),
    emotions,
    spriteIds: Object.keys(spriteIds).length > 0 ? spriteIds : char.spriteIds
  }
}

function mergeImportedCharacterForOverwrite(existing: Character, imported: Character): Character {
  const importedAvatar = (imported.avatar ?? '').trim()
  const importedEmotionCount = Object.keys(imported.emotions ?? {}).length
  const importedSpriteCount = Object.keys(imported.spriteIds ?? {}).length

  return {
    ...existing,
    ...imported,
    id: existing.id,
    createdAt: existing.createdAt,
    avatar: importedAvatar ? imported.avatar : existing.avatar,
    emotions: importedEmotionCount > 0 ? imported.emotions : existing.emotions,
    spriteIds: importedSpriteCount > 0 ? imported.spriteIds : existing.spriteIds,
    updatedAt: Date.now()
  }
}

type ImportJsonPayload = string | { json: string; sourcePath?: string; replaceCharacterId?: string }

function normalizeImportJsonPayload(payload: ImportJsonPayload): { json: string; sourcePath?: string; replaceCharacterId?: string } {
  if (typeof payload === 'string') return { json: payload }
  return {
    json: String(payload?.json ?? ''),
    sourcePath: typeof payload?.sourcePath === 'string' ? payload.sourcePath : undefined,
    replaceCharacterId: typeof payload?.replaceCharacterId === 'string' ? payload.replaceCharacterId : undefined
  }
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

export async function triggerReminderSpeak(reminder: Reminder): Promise<void> {
  let charId = reminder.characterId
  let requestedCharacterName = ''
  let characterWasRestored = false
  let characterWasDeleted = false

  if (charId) {
    const requestedChar = getCharacter(charId)
    if (requestedChar) {
      requestedCharacterName = requestedChar.name
      const isOnDesktop = settings.ui.desktopCharacters.some(d => d.characterId === charId)
      if (!isOnDesktop) {
        settings.ui.desktopCharacters.push({
          characterId: charId,
          position: { x: 80, y: 400 },
          size: 1,
          flipped: false,
          muted: false,
          zIndex: 1
        })
        fileStore.saveSettings(settings)
        characterWasRestored = true
        broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
        createCharacterWindow(charId, { x: 80, y: 400 }, 1)
      }
    } else {
      characterWasDeleted = true
      const candidates = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)
      if (candidates.length === 0) return
      charId = candidates[Math.floor(Math.random() * candidates.length)]
    }
  }

  if (!charId) {
    const candidates = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)
    if (candidates.length === 0) return
    charId = candidates[Math.floor(Math.random() * candidates.length)]
  }

  const char = getCharacter(charId)
  const conv = getActiveConversation()
  if (!char || !conv) return

  const activePersona = getActivePersona()
  const activeWorld = getActiveWorld()

  const ctxParts: string[] = []

  if (characterWasDeleted && requestedCharacterName) {
    const reminderText = reminder.prompt?.trim() || '提醒你的事情'
    ctxParts.push(`[替補訊息]\n使用者之前設定讓 ${requestedCharacterName} 來提醒關於「${reminderText}」的事，但 ${requestedCharacterName} 已經不存在了。請你代替 ${requestedCharacterName} 來傳達這個提醒，並表示 ${requestedCharacterName} 不在了。例如說「你之前叫 ${requestedCharacterName} 提醒你『${reminderText}』，可是他不在這裡了喔，換我跟你說」。`)
  }
  if (characterWasRestored) {
    ctxParts.push(`[角色復出]\n這個角色剛才被重新叫回桌面。`)
  }
  if (conv.messages.length === 0 && char.firstMessage?.trim()) {
    ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
  }
  if (reminder.prompt?.trim()) {
    ctxParts.push(`[提醒指令]\n${reminder.prompt.trim()}`)
  }
  if (reminder.injectPinnedNotes) {
    const visible = (settings.ui.pinnedNotes ?? []).filter(n => n.visible)
    if (visible.length > 0) {
      const lines = visible.map(n => {
        const title = n.title?.trim() || '便利貼'
        const body = n.content?.trim()
        return body ? `- 《${title}》${body}` : `- 《${title}》（空白）`
      })
      ctxParts.push(`[桌面便利貼]\n${lines.join('\n')}`)
    }
  }

  if (reminder.injectWeather) {
    const weatherStr = await getWeatherContextString(settings)
    if (weatherStr) ctxParts.push(weatherStr)
  }

  const reminderMessages = reminder.injectConversationContext
    ? conv.messages.slice(-(settings.memory.keepRecentN))
    : []
  if (reminder.injectConversationContext && reminderMessages.length > 0) {
    ctxParts.push('[近期對話紀錄]\n以下僅供參考語境；請以提醒指令為主，用角色口吻簡短開口，不要長篇接續聊天。')
  }

  // Desktop character list (after other context, before system time)
  const desktopCharNames = settings.ui.desktopCharacters
    .map(d => getCharacter(d.characterId)?.name ?? '').filter(Boolean)
  if (desktopCharNames.length > 0) {
    const selfLine = `- ${char.name} (you)`
    const otherLines = desktopCharNames.filter(n => n !== char.name).map(n => `- ${n}`)
    ctxParts.push([
      '[Desktop Characters]',
      selfLine,
      ...otherLines
    ].join('\n'))
  }
  const extraSystemContext = ctxParts.join('\n\n') || undefined

  // 檢查是否有 API Key
  const hasApiKey = !!settings.llm.apiKeys[settings.llm.provider]?.trim()

  setCharacterThinking(charId, true)
  deferRaiseCharacterAbovePinnedNotes(charId)
  try {
    let cleanReply = ''
    let emotion = 'neutral'
    let debugPrompt = ''
    let reminderInputTk: number | undefined
    let reminderOutputTk: number | undefined
    let reminderUtilityInputTk: number | undefined
    let reminderUtilityOutputTk: number | undefined
    let reminderUtilityDebugPrompt: string | undefined
    const reminderChatSettings = applyUtilitySettings(settings)

    if (hasApiKey) {
      // 有 API Key：調用 LLM 生成角色化回應（提醒走輔助模型）
      const reminderHasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
      const doSplitEmotionReminder = !!(settings.llm.utilityEnabled && reminderHasCustomSprites)
      const { content, emotion: llmEmotion, debugPrompt: llmDebugPrompt, inputTokens: rInputTk, outputTokens: rOutputTk } = await chatWithLLM({
        settings: reminderChatSettings,
        character: char,
        messages: reminderMessages,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames: [],
        extraSystemContext,
        isReminder: true,
        splitEmotion: doSplitEmotionReminder
      })
      cleanReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, char),
        char.id
      )
      reminderInputTk = rInputTk
      reminderOutputTk = rOutputTk
      if (doSplitEmotionReminder && cleanReply) {
        const cr = await classifyEmotionWithLLM({ settings, character: char, reply: cleanReply })
        emotion = cr.emotion
        reminderUtilityInputTk = cr.inputTokens
        reminderUtilityOutputTk = cr.outputTokens
        reminderUtilityDebugPrompt = cr.debugPrompt
      } else {
        emotion = llmEmotion
      }
      debugPrompt = llmDebugPrompt
    } else {
      // 無 API Key：離線模式，直接使用提醒文字
      cleanReply = reminder.prompt?.trim() || `📢 ${reminder.label || '提醒'}`
    }

    if (!cleanReply) return

    const reminderLlm = hasApiKey ? messageLlmMeta(debugPrompt, reminderChatSettings) : null
    const msg: Message = {
      id: uuidv4(),
      role: 'character',
      characterId: charId,
      content: cleanReply,
      llmProvider: reminderLlm?.provider,
      llmModel: reminderLlm?.model,
      debugPrompt: hasApiKey ? debugPrompt : undefined,
      emotion,
      inputTokens: reminderInputTk,
      outputTokens: reminderOutputTk,
      utilityInputTokens: reminderUtilityInputTk,
      utilityOutputTokens: reminderUtilityOutputTk,
      utilityDebugPrompt: reminderUtilityDebugPrompt,
      timestamp: Date.now()
    }
    conv.messages.push(msg)
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    scheduleConversationBroadcast(conv)
    flushConversationBroadcast()

    // 播放提醒音效（發給說話的角色的窗口，一個角色只響一次）
    if (settings.ui.reminderNotificationSound?.enabled !== false) {
      const volume = settings.ui.reminderNotificationSound?.volume ?? 0.7
      const charWin = getCharacterWindow(charId)
      if (charWin && !charWin.isDestroyed()) {
        charWin.webContents.send('audio:play-notification', { volume })
      }
    }

    setImmediate(() => {
      showSpeechBubble(charId, char.name, cleanReply, msg.emotion, bubbleAnchorForCharacter(charId))
      sendCharacterContextUpdate(charId, { lastMessage: { id: msg.id, emotion: msg.emotion } })
    })
  } catch (e) {
    console.error('[reminder] triggerReminderSpeak failed:', e)
  } finally {
    setCharacterThinking(charId, false)
  }
}

export function applySceneById(id: string): { ok: true } | { error: string } {
  const scene = fileStore.loadScenePreset(id)
  if (!scene) return { error: '找不到情境。' }

  // Persist current conversation to current scene before switching
  if (settings.activeSceneId && settings.activeSceneId !== id) {
    const currentScene = fileStore.loadScenePreset(settings.activeSceneId)
    if (currentScene) {
      currentScene.lastActiveConversationId = settings.ui.lastActiveConversationId
      currentScene.updatedAt = Date.now()
      fileStore.saveScenePreset(currentScene)
    }
  }

  // Apply persona / world / theme
  settings.activePersonaId = scene.activePersonaId
  settings.activeWorldId = scene.activeWorldId
  settings.activeSceneId = scene.id
  if (scene.colorTheme !== undefined) settings.ui.colorTheme = scene.colorTheme
  if (scene.lastActiveConversationId !== undefined) {
    settings.ui.lastActiveConversationId = scene.lastActiveConversationId
  }

  // Apply window bounds
  if (scene.inputWindowBounds) {
    settings.ui.inputWindowBounds = scene.inputWindowBounds
    const iw = getInputWindow()
    if (iw && !iw.isDestroyed()) iw.setBounds(scene.inputWindowBounds)
  }
  if (scene.logWindowBounds) {
    settings.ui.logWindowBounds = scene.logWindowBounds
    const lw = getLogWindow()
    if (lw && !lw.isDestroyed()) lw.setBounds(scene.logWindowBounds)
  }

  // Apply desktop characters
  const prevIds = new Set(settings.ui.desktopCharacters.map(d => d.characterId))
  const nextIds = new Set(scene.desktopCharacters.map(d => d.characterId))

  for (const charId of prevIds) {
    if (!nextIds.has(charId)) {
      settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== charId)
      closeCharacterWindow(charId)
    }
  }

  for (const newState of scene.desktopCharacters) {
    const existing = settings.ui.desktopCharacters.find(d => d.characterId === newState.characterId)
    if (existing) {
      Object.assign(existing, newState)
      const win = getCharacterWindow(newState.characterId)
      if (win && !win.isDestroyed()) {
        win.setPosition(Math.round(newState.position.x), Math.round(newState.position.y))
        resizeCharacterWindow(newState.characterId, newState.size)
      }
    } else {
      const char = characters.find(c => c.id === newState.characterId)
      if (char) {
        settings.ui.desktopCharacters.push({ ...newState })
        createCharacterWindow(newState.characterId, newState.position, newState.size)
      }
    }
  }

  // Switch active conversation
  if (scene.lastActiveConversationId) {
    const conv = getOrLoadConversation(scene.lastActiveConversationId)
    if (conv) {
      activeConversationId = conv.id
      broadcastConversationUpdate(conv)
      syncCharacterContextsFromConversation(conv)
    }
  }

  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
  broadcastToAll('scenes:updated', null)
  return { ok: true }
}

export async function handleSpotifyProtocolUrl(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'spotify-callback') return
    const code = parsed.searchParams.get('code')
    const error = parsed.searchParams.get('error')
    if (error || !code) {
      broadcastToAll('spotify:auth-error', error ?? '授權失敗')
      return
    }
    const result = await handleAuthCallback(code)
    if (result.ok) {
      if (!settings.spotify) settings.spotify = { enabled: true, clientId: '' }
      settings.spotify.displayName = result.displayName
      settings.spotify.enabled = true
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    } else {
      broadcastToAll('spotify:auth-error', result.error ?? '授權失敗')
    }
  } catch (e) {
    console.error('[Spotify] protocol url error:', e)
  }
}

export function registerIpcHandlers() {

  // Store: get initial snapshot for any renderer
  ipcMain.handle('store:get-all', (event) => {
    const winType = windowTypeFromSender(event.sender)
    if (winType === 'bubble' || winType === 'user-bubble') {
      return {
        settings,
        characters: [],
        desktopCharacters: [],
        activeConversationId,
        conversation: null,
        characterContext: null
      }
    }
    const charId = characterIdFromSender(event.sender)
    const conv = getActiveConversation()
    if (charId) {
      const last = findLastCharacterMessage(conv, charId)
      return {
        settings,
        characters,
        desktopCharacters: settings.ui.desktopCharacters,
        activeConversationId,
        conversation: null,
        characterContext: {
          characterId: charId,
          lastMessage: characterContextFromMessage(last)
        }
      }
    }
    const conversationForRenderer = conv
      ? (winType === 'log' ? stripConversationForLog(conv) : conv)
      : null
    return {
      settings,
      characters,
      desktopCharacters: settings.ui.desktopCharacters,
      activeConversationId,
      conversation: conversationForRenderer
    }
  })

  ipcMain.handle('conversation:get-message-debug', (_, messageId: string) => {
    const conv = getActiveConversation()
    if (!conv || !messageId) return null
    const msg = conv.messages.find(m => m.id === messageId)
    if (!msg) return null
    return {
      debugPrompt: msg.debugPrompt ?? null,
      utilityDebugPrompt: msg.utilityDebugPrompt ?? null
    }
  })

  // Settings
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:save', (_, s: AppSettings) => {
    s.ui.unfocusedBubbleOpacity = normalizeUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setCharactersAlwaysOnTop(s.ui.alwaysOnTop ?? true)
    setIdleSkipMinutes(s.ui.reminderIdleSkipMinutes ?? 0)
    // These fields are managed exclusively by main-process handlers and must never be
    // overwritten by the renderer's potentially-stale settings draft.
    const ui = {
      ...s.ui,
      desktopCharacters: settings.ui.desktopCharacters,
      pinnedNotes: settings.ui.pinnedNotes,
      inputWindowBounds: settings.ui.inputWindowBounds,
      inputWindowPosition: settings.ui.inputWindowPosition,
      logWindowBounds: settings.ui.logWindowBounds,
      emojiPickerOffset: settings.ui.emojiPickerOffset,
      lastActiveConversationId: settings.ui.lastActiveConversationId,
    }
    // Protect encrypted-but-unreadable API keys: if renderer sends '' because decryption
    // failed at startup (we showed '' instead of the enc:v1: blob), preserve the encrypted
    // blob in the file so the user can attempt recovery or re-enter on their own.
    // Only applies while encryptedApiKeyFallbacks still holds the value; once the user
    // explicitly types a new key, it's cleared from the fallback map.
    const protectedApiKeys = { ...s.llm?.apiKeys }
    for (const [k, encValue] of fileStore.encryptedApiKeyFallbacks.entries()) {
      if (!protectedApiKeys[k]) {
        // Renderer sees '' (we converted enc:v1: to '' on load); keep encrypted blob in file
        protectedApiKeys[k] = encValue
      } else {
        // User typed a real key — clear the fallback so it's not applied again
        fileStore.encryptedApiKeyFallbacks.delete(k)
      }
    }
    const prevLocationName = settings.weather?.locationName
    settings = { ...s, llm: { ...s.llm, apiKeys: protectedApiKeys }, ui }
    if (settings.weather?.locationName !== prevLocationName) invalidateWeatherCache()
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
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

  ipcMain.handle('character:set-always-on-top', (_, characterId: string, enabled: boolean) => {
    setCharacterAlwaysOnTop(characterId, enabled)
    return true
  })

  // Weather
  ipcMain.handle('weather:detect-ip', async () => {
    return detectLocationByIP()
  })

  ipcMain.handle('weather:geocode', async (_, name: string) => {
    return geocodeCity(name)
  })

  ipcMain.handle('weather:fetch-now', async () => {
    const w = settings.weather
    if (!w?.locationName || !w.latitude || !w.longitude) return null
    invalidateWeatherCache()
    return fetchWeather(w.latitude, w.longitude, w.locationName)
  })

  ipcMain.handle('weather:get-cache', () => getCachedWeatherData())

  // Spotify
  ipcMain.handle('spotify:open-settings', () => {
    openSpotifySettingsWindow()
  })

  ipcMain.handle('spotify:close-settings', () => {
    closeSpotifySettingsWindow()
  })

  ipcMain.handle('spotify:start-auth', async (_, clientId: string) => {
    const trimmed = clientId.trim()
    if (!trimmed) return { ok: false, error: '請輸入 Client ID' }
    settings.spotify = { ...(settings.spotify ?? { enabled: false }), clientId: trimmed }
    fileStore.saveSettings(settings)
    const url = buildAuthUrl(trimmed)
    shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('spotify:disconnect', () => {
    clearAuthFile()
    if (settings.spotify) {
      settings.spotify = { ...settings.spotify, enabled: false, displayName: undefined }
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    }
    return { ok: true }
  })

  ipcMain.handle('spotify:get-status', () => ({
    connected: isAuthenticated(),
    displayName: settings.spotify?.displayName,
    enabled: settings.spotify?.enabled ?? false
  }))

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
            const personaName = (g.personaName && g.personaName.trim()) || '匯入的使用者'
            const existingPersona = fileStore.loadPersonaPresets().find(p => p.name === personaName)
            const personaPreset: PersonaPreset = existingPersona
              ? {
                  ...existingPersona,
                  displayName: g.persona.displayName ?? '使用者',
                  nickname: g.persona.nickname ?? '主人',
                  description: g.persona.description ?? '',
                  updatedAt: now
                }
              : {
                  id: uuidv4(),
                  name: personaName,
                  displayName: g.persona.displayName ?? '使用者',
                  nickname: g.persona.nickname ?? '主人',
                  description: g.persona.description ?? '',
                  builtIn: false,
                  createdAt: now,
                  updatedAt: now
                }
            fileStore.savePersonaPreset(personaPreset)
            settings.activePersonaId = personaPreset.id
          }
          if (g.worldSetting || g.interactionExample) {
            const worldName = (g.worldName && g.worldName.trim()) || '匯入的世界觀'
            const existingWorld = fileStore.loadWorldPresets().find(w => w.name === worldName)
            const worldPreset: WorldPreset = existingWorld
              ? {
                  ...existingWorld,
                  worldSetting: g.worldSetting ?? '',
                  interactionExample: g.interactionExample ?? '',
                  updatedAt: now
                }
              : {
                  id: uuidv4(),
                  name: worldName,
                  worldSetting: g.worldSetting ?? '',
                  interactionExample: g.interactionExample ?? '',
                  builtIn: false,
                  createdAt: now,
                  updatedAt: now
                }
            fileStore.saveWorldPreset(worldPreset)
            settings.activeWorldId = worldPreset.id
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
    exitCharacterScaleMode(characterId)
    if (d) {
      d.size = nextPos?.size ?? nextSize
      if (nextPos) d.position = nextPos.position
      fileStore.saveSettings(settings)
      broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    }
    return true
  })

  ipcMain.handle('desktop:enter-scale-mode', (_, characterId: string) => {
    enterScaleModeWindow(characterId)
    return true
  })

  // Emergency repair: destroy ALL character windows (including orphans from duplicate-add bugs),
  // then recreate cleanly from settings.ui.desktopCharacters.
  ipcMain.handle('desktop:reload-windows', () => {
    destroyAllCharacterWindows()
    if (repairDesktopCharacterLayout()) fileStore.saveSettings(settings)
    for (const d of settings.ui.desktopCharacters) {
      createCharacterWindow(d.characterId, d.position, d.size)
    }
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:preview-size', (_, characterId: string, size: number) => {
    const nextSize = Math.min(4, Math.max(0.25, Number(size) || 1))
    enterCharacterScaleMode(characterId)
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

  const startDesktopDrag = (characterId: string, startX: number, startY: number): boolean => {
    if (typeof characterId === 'string' && Number.isFinite(startX) && Number.isFinite(startY)) {
      const ok = beginCharacterDrag(characterId, startX, startY, pos => {
        const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
        if (d) d.position = pos
      })
      return ok
    }
    return false
  }

  ipcMain.handle('desktop:drag-start', (_, characterId: string, startX: number, startY: number) =>
    startDesktopDrag(characterId, startX, startY)
  )
  ipcMain.on('desktop:drag-start', (_, characterId: string, startX: number, startY: number) => {
    startDesktopDrag(characterId, startX, startY)
  })

  ipcMain.on('desktop:drag-move', (_, characterId: string, cursorX: number, cursorY: number) => {
    // Validate coordinates are finite numbers
    if (typeof characterId === 'string' && Number.isFinite(cursorX) && Number.isFinite(cursorY)) {
      moveDraggedCharacter(characterId, cursorX, cursorY)
    }
  })

  ipcMain.handle('desktop:drag-end', (_, characterId: string) => {
    const pos = endCharacterDrag(characterId)
    if (pos) {
      reconcileSpeechBubbleAfterCharacterDrag(characterId)
    }
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (d && pos) {
      d.position = pos
      fileStore.saveSettings(settings)
      broadcastDesktopCharactersToCharacterWindows(settings.ui.desktopCharacters)
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

  ipcMain.on('desktop:set-interactable', (_, characterId: string, isInteractable: boolean) => {
    setCharacterInteractable(characterId, isInteractable)
  })

  ipcMain.on('desktop:update-sprite-height', (_, characterId: string, h: number) => {
    updateSpriteActualHeight(characterId, h)
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
    showSpeechBubble(
      characterId,
      speakerName || (getCharacter(characterId)?.name ?? '角色'),
      String(text ?? ''),
      emotion,
      bubbleAnchorForCharacter(characterId)
    )
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

  ipcMain.handle('window:open-pinned-notes-manager', () => {
    openPinnedNotesManager()
    return true
  })

  ipcMain.handle('window:close-pinned-notes-manager', () => {
    closePinnedNotesManager()
    return true
  })

  ipcMain.handle('window:open-reminders-manager', () => {
    openRemindersManager()
    return true
  })

  ipcMain.handle('window:close-reminders-manager', () => {
    closeRemindersManager()
    return true
  })

  ipcMain.handle('data:get-dir', () => {
    return {
      dataDir: fileStore.getDataDir(),
      defaultDataDir: fileStore.getDefaultDataDir()
    }
  })

  ipcMain.handle('data:get-relocate-summary', () => {
    return fileStore.getDataDirSummary()
  })

  ipcMain.handle('data:change-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, {
        title: '選擇資料儲存資料夾',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: fileStore.getDataDir(),
      })
      : await dialog.showOpenDialog({
        title: '選擇資料儲存資料夾',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: fileStore.getDataDir(),
      })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, canceled: true as const, dataDir: fileStore.getDataDir() }
    }

    const relocated = fileStore.relocateDataDir(result.filePaths[0])
    if (!relocated.ok) {
      return { ok: false as const, canceled: false as const, error: relocated.error, dataDir: fileStore.getDataDir() }
    }

    settings = fileStore.loadSettings()
    characters = fileStore.loadCharacters()
    broadcastToAll('settings:updated', settings)
    broadcastToAll('characters:updated', characters)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return { ok: true as const, canceled: false as const, dataDir: relocated.dataDir }
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
    syncCharacterContextsFromConversation(conv)
    return stripConversationForLog(conv)
  })

  ipcMain.handle('conversation:load', (_, id: string) => {
    const conv = getOrLoadConversation(id)
    if (!conv) return { error: 'Not found' }
    activeConversationId = id
    syncLastActiveConversationToSettings()
    broadcastConversationUpdate(conv)
    syncCharacterContextsFromConversation(conv)
    return stripConversationForLog(conv)
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
    syncCharacterContextsFromConversation(conv)
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
        syncCharacterContextsFromConversation(next)
        return true
      }
    }

    const fresh = createNewConversation()
    broadcastConversationUpdate(fresh)
    syncCharacterContextsFromConversation(fresh)
    return true
  })

  ipcMain.handle('conversation:delete-message', (_, messageId: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.messages = conv.messages.filter(m => m.id !== messageId)
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    syncCharacterContextsFromConversation(conv)
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
    if (msg.role === 'character' && msg.characterId) {
      const last = findLastCharacterMessage(conv, msg.characterId)
      if (last?.id === msg.id) {
        sendCharacterContextUpdate(msg.characterId, {
          lastMessage: characterContextFromMessage(last)
        })
      }
    }
    return true
  })

  // Messaging
  ipcMain.handle('message:send', async (_, payload: { content: string; images?: string[]; randomResult?: RandomResult }) => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    let userContentForPrompt = payload.content
    if (payload.randomResult) {
      const label = formatRandomResultForPrompt(payload.randomResult)
      userContentForPrompt = `${payload.content}${payload.content ? '\n' : ''}（${label}）`
    }

    // Add user message
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: payload.content,
      images: payload.images,
      randomResult: payload.randomResult,
      timestamp: Date.now()
    }
    conv.messages.push(userMsg)
    deferBroadcastConversationUpdate(conv)
    const shownUserText = String(payload.content ?? '').trim()
    const shownUserBubbleText = payload.randomResult
      ? `${shownUserText}${shownUserText ? '\n' : ''}（${formatRandomResultForPrompt(payload.randomResult)}）`
      : shownUserText
    if (shownUserBubbleText) {
      setImmediate(() => showUserSpeechBubble(getPersonaDisplayName(), shownUserBubbleText))
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

    // 檢查是否有 API Key
    const hasApiKey = !!settings.llm.apiKeys[settings.llm.provider]?.trim()
    if (!hasApiKey) {
      const noKeyText = '（系統提示：尚未設定 API Key，我沒辦法回應你喔。請點右上角的設定圖示，前往「LLM」分頁填入 API Key，就可以開始聊天囉！）'
      const noApiKeyMsg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId: primaryId,
        content: noKeyText,
        timestamp: Date.now()
      }
      conv.messages.push(noApiKeyMsg)
      conv.updatedAt = Date.now()
      scheduleConversationBroadcast(conv)
      flushConversationBroadcast()
      showSpeechBubble(primaryId, primaryChar.name, noKeyText, noApiKeyMsg.emotion, bubbleAnchorForCharacter(primaryId))
      sendCharacterContextUpdate(primaryId, { lastMessage: { id: noApiKeyMsg.id, emotion: noApiKeyMsg.emotion } })
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    setCharacterThinking(primaryId, true)
    deferRaiseCharacterAbovePinnedNotes(primaryId)

    const recentMessagesBase = [...conv.messages.slice(0, -1), userMsgForPrompt].slice(-(settings.memory.keepRecentN))
    let lastReplyText = ''

    // Pre-fetch weather + spotify context once for this message (shared across all responders)
    const weatherContext = settings.weather?.enabled ? await getWeatherContextString(settings) : null
    const spotifyContext = settings.spotify?.enabled ? await getSpotifyContextString(settings) : null
    const extraContextParts = [weatherContext, spotifyContext].filter(Boolean) as string[]
    const combinedExtraContext = extraContextParts.length > 0 ? extraContextParts.join('\n\n') : null

    // Emotion split: use utility model to classify if utilityEnabled + character has custom sprites
    const primaryHasCustomSprites = Object.values(primaryChar.emotions ?? {}).some(p => p?.trim())
    const doSplitEmotion = !!(settings.llm.utilityEnabled && primaryHasCustomSprites)

    // 1) Primary responder always replies
    try {
      const { content, emotion: rawEmotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM({
        settings,
        character: primaryChar,
        messages: recentMessagesBase,
        images: payload.images,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames,
        extraSystemContext: combinedExtraContext ?? undefined,
        splitEmotion: doSplitEmotion
      })
      const primaryReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, primaryChar),
        primaryChar.id
      )
      if (!primaryReply) {
        throw new Error('模型輸出包含其他角色台詞，已拒絕這次回覆。')
      }
      // Run separate emotion classification if needed
      let emotion = rawEmotion
      let utilityInputTokens: number | undefined
      let utilityOutputTokens: number | undefined
      let utilityDebugPrompt: string | undefined
      if (doSplitEmotion) {
        const classifyResult = await classifyEmotionWithLLM({ settings, character: primaryChar, reply: primaryReply })
        emotion = classifyResult.emotion
        utilityInputTokens = classifyResult.inputTokens
        utilityOutputTokens = classifyResult.outputTokens
        utilityDebugPrompt = classifyResult.debugPrompt
      }
      userMsg.debugPrompt = debugPrompt
      lastReplyText = primaryReply
      const primaryLlm = messageLlmMeta(debugPrompt, settings)
      const charMsg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId: primaryId,
        content: primaryReply,
        llmProvider: primaryLlm.provider,
        llmModel: primaryLlm.model,
        debugPrompt,
        emotion,
        inputTokens,
        outputTokens,
        utilityInputTokens,
        utilityOutputTokens,
        utilityDebugPrompt,
        timestamp: Date.now()
      }
      conv.messages.push(charMsg)
      conv.updatedAt = Date.now()
      setCharacterThinking(primaryId, false)
      scheduleConversationBroadcast(conv)

      // 播放訊息通知音
      if (settings.ui.messageNotificationSound?.enabled !== false) {
        const volume = settings.ui.messageNotificationSound?.volume ?? 0.7
        const charWin = getCharacterWindow(primaryId)
        if (charWin && !charWin.isDestroyed()) {
          charWin.webContents.send('audio:play-message-notification', { volume })
        }
      }

      setImmediate(() => {
        showSpeechBubble(primaryId, primaryChar.name, primaryReply, charMsg.emotion, bubbleAnchorForCharacter(primaryId))
        sendCharacterContextUpdate(primaryId, { lastMessage: { id: charMsg.id, emotion: charMsg.emotion } })
      })
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
      scheduleConversationBroadcast(conv)
      flushConversationBroadcast()
      setCharacterThinking(primaryId, false)
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    // 2) Others: only reply if they have a distinct thought
    // Persist the primary character's bubble so it doesn't auto-close while waiting for secondaries.
    // Delay ensures the renderer has already processed bubble:show and started the close timer.
    setTimeout(() => persistSpeechBubble(primaryId), 350)

    // maxGroupRounds = total character replies per user message (primary + others).
    const maxCharacterReplies = Math.max(1, Math.floor(Number(settings.llm.maxGroupRounds) || 1))
    const maxAdditionalReplies = Math.max(0, maxCharacterReplies - 1)
    const others = respondingIds
      .filter(id => id !== primaryId)
      .slice(0, maxAdditionalReplies)
    for (const charId of others) {
      const char = getCharacter(charId)
      if (!char) continue

      try {
        setCharacterThinking(charId, true)
        deferRaiseCharacterAbovePinnedNotes(charId)
        let recentMessages = conv.messages.slice(-(settings.memory.keepRecentN)).map(m =>
          // 若使用者訊息附有隨機工具結果，補回 prompt 用的注入內容（primary 已透過 userMsgForPrompt 注入，
          // secondary/tertiary 讀 conv.messages 時 content 是原始文字，需在此補上）
          m.id === userMsg.id ? userMsgForPrompt : m
        )
        // 沒有對話時，插入虛擬開場防止模型把 system prompt 當成上文
        if (recentMessages.length === 0) {
          recentMessages = [{
            id: uuidv4(),
            role: 'user' as const,
            content: '……',
            timestamp: Date.now()
          }]
        }
        const secHasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
        const doSplitEmotionSec = !!(settings.llm.utilityEnabled && secHasCustomSprites)
        const { content: reply, emotion: rawEmotionSec, debugPrompt, inputTokens: secInputTk, outputTokens: secOutputTk } = await chatWithLLM({
          settings,
          character: char,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById(),
          persona: activePersona,
          world: activeWorld,
          desktopCharacterNames,
          extraSystemContext: combinedExtraContext ?? undefined,
          splitEmotion: doSplitEmotionSec
        })
        const cleanReply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(reply.trim(), char),
          char.id
        )

        if (!cleanReply) {
          setCharacterThinking(charId, false)
          continue
        }
        // Skip near-duplicates
        const replyNorm = normalizeForCompare(cleanReply)
        const lastNorm = normalizeForCompare(lastReplyText)
        if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
          setCharacterThinking(charId, false)
          continue
        }

        let emotionSec: string
        let secUtilityInputTk: number | undefined
        let secUtilityOutputTk: number | undefined
        let secUtilityDebugPrompt: string | undefined
        if (doSplitEmotionSec) {
          const cr = await classifyEmotionWithLLM({ settings, character: char, reply: cleanReply })
          emotionSec = cr.emotion
          secUtilityInputTk = cr.inputTokens
          secUtilityOutputTk = cr.outputTokens
          secUtilityDebugPrompt = cr.debugPrompt
        } else {
          emotionSec = normalizeEmotion(rawEmotionSec) || 'neutral'
        }

        const secondaryLlm = messageLlmMeta(debugPrompt, settings)
        const charMsg: Message = {
          id: uuidv4(),
          role: 'character',
          characterId: charId,
          content: cleanReply,
          llmProvider: secondaryLlm.provider,
          llmModel: secondaryLlm.model,
          debugPrompt,
          emotion: emotionSec,
          inputTokens: secInputTk,
          outputTokens: secOutputTk,
          utilityInputTokens: secUtilityInputTk,
          utilityOutputTokens: secUtilityOutputTk,
          utilityDebugPrompt: secUtilityDebugPrompt,
          timestamp: Date.now()
        }
        lastReplyText = cleanReply
        conv.messages.push(charMsg)
        conv.updatedAt = Date.now()
        setCharacterThinking(charId, false)
        scheduleConversationBroadcast(conv)

        // 播放訊息通知音
        if (settings.ui.messageNotificationSound?.enabled !== false) {
          const volume = settings.ui.messageNotificationSound?.volume ?? 0.7
          const charWin = getCharacterWindow(charId)
          if (charWin && !charWin.isDestroyed()) {
            charWin.webContents.send('audio:play-message-notification', { volume })
          }
        }

        setImmediate(() => {
          showSpeechBubble(charId, char.name, cleanReply, charMsg.emotion, bubbleAnchorForCharacter(charId))
          sendCharacterContextUpdate(charId, { lastMessage: { id: charMsg.id, emotion: charMsg.emotion } })
        })
      } catch (e: unknown) {
        // If a secondary decision fails, don't break the whole send flow.
        setCharacterThinking(charId, false)
      }
    }

    flushConversationBroadcast()
    fileStore.saveConversation(conv)
    return { ok: true }
  })

  // Force speak: one character speaks now
  ipcMain.handle('character:force-speak', async (_, characterId: string) => {
    const conv = getActiveConversation()
    const char = getCharacter(characterId)
    if (!conv || !char) return { error: 'Not found' }

    // 沒有 API Key 時直接說提示訊息，不進 LLM
    const hasApiKey = !!settings.llm.apiKeys[settings.llm.provider]?.trim()
    if (!hasApiKey) {
      const noKeyText = '（系統提示：尚未設定 API Key，我沒辦法回應你喔。請點右上角的設定圖示，前往「LLM」分頁填入 API Key，就可以開始聊天囉！）'
      const msg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId,
        content: noKeyText,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      broadcastConversationUpdate(conv)
      showSpeechBubble(characterId, char.name, noKeyText, undefined, bubbleAnchorForCharacter(characterId))
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    const ctxParts: string[] = []
    if (conv.messages.length === 0 && char.firstMessage?.trim()) {
      ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
    }
    if (settings.weather?.enabled) {
      const weatherStr = await getWeatherContextString(settings)
      if (weatherStr) ctxParts.push(weatherStr)
    }
    if (settings.spotify?.enabled) {
      const spotifyStr = await getSpotifyContextString(settings)
      if (spotifyStr) ctxParts.push(spotifyStr)
    }
    const extraSystemContext = ctxParts.join('\n\n') || undefined

    setCharacterThinking(characterId, true)
    deferRaiseCharacterAbovePinnedNotes(characterId)
    try {
      let recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
      const desktopCharNamesForce = settings.ui.desktopCharacters.map(d => getCharacter(d.characterId)?.name ?? '').filter(Boolean)
      const forceHasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
      const doSplitEmotionForce = !!(settings.llm.utilityEnabled && forceHasCustomSprites)
      const { content, emotion: rawEmotionForce, debugPrompt, inputTokens: forceInputTk, outputTokens: forceOutputTk } = await chatWithLLM({
        settings,
        character: char,
        messages: recentMessages,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames: desktopCharNamesForce,
        extraSystemContext,
        splitEmotion: doSplitEmotionForce
      })
      const forcedReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, char),
        char.id
      )
      if (!forcedReply) {
        return { error: '模型輸出包含其他角色台詞，已拒絕這次強制發話。' }
      }
      let forceEmotion = rawEmotionForce
      let forceUtilityInputTk: number | undefined
      let forceUtilityOutputTk: number | undefined
      let forceUtilityDebugPrompt: string | undefined
      if (doSplitEmotionForce) {
        const cr = await classifyEmotionWithLLM({ settings, character: char, reply: forcedReply })
        forceEmotion = cr.emotion
        forceUtilityInputTk = cr.inputTokens
        forceUtilityOutputTk = cr.outputTokens
        forceUtilityDebugPrompt = cr.debugPrompt
      }
      const forceLlm = messageLlmMeta(debugPrompt, settings)
      const msg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId,
        content: forcedReply,
        llmProvider: forceLlm.provider,
        llmModel: forceLlm.model,
        debugPrompt,
        emotion: forceEmotion,
        inputTokens: forceInputTk,
        outputTokens: forceOutputTk,
        utilityInputTokens: forceUtilityInputTk,
        utilityOutputTokens: forceUtilityOutputTk,
        utilityDebugPrompt: forceUtilityDebugPrompt,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      fileStore.saveConversation(conv)
      scheduleConversationBroadcast(conv)
      flushConversationBroadcast()
      setImmediate(() => {
        showSpeechBubble(characterId, char.name, forcedReply, msg.emotion, bubbleAnchorForCharacter(characterId))
        sendCharacterContextUpdate(characterId, { lastMessage: { id: msg.id, emotion: msg.emotion } })
      })
      return { ok: true }
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) }
    } finally {
      setCharacterThinking(characterId, false)
    }
  })

  // Continue group conversation: cycle through non-muted desktop characters for maxGroupRounds total replies
  ipcMain.handle('character:continue-group', async () => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

    const hasApiKey = !!settings.llm.apiKeys[settings.llm.provider]?.trim()
    if (!hasApiKey) return { error: 'No API key' }

    const nonMuted = settings.ui.desktopCharacters
      .filter(d => !d.muted)
      .map(d => getCharacter(d.characterId))
      .filter((c): c is Character => c != null)
    if (nonMuted.length === 0) return { ok: true }

    const desktopAll = settings.ui.desktopCharacters.map(d => d.characterId)
    const desktopCharacterNames = desktopAll.map(id => getCharacter(id)?.name ?? '').filter(Boolean)
    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()
    const maxRounds = nonMuted.length === 1
      ? 1
      : Math.max(1, Math.floor(Number(settings.llm.maxGroupRounds) || 1))

    let lastReplyText = ''
    for (let i = 0; i < maxRounds; i++) {
      const char = nonMuted[i % nonMuted.length]
      setCharacterThinking(char.id, true)
      deferRaiseCharacterAbovePinnedNotes(char.id)
      try {
        let recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
        if (recentMessages.length === 0) {
          recentMessages = [{ id: uuidv4(), role: 'user' as const, content: '……', timestamp: Date.now() }]
        }
        const hasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
        const doSplitEmotion = !!(settings.llm.utilityEnabled && hasCustomSprites)
        const { content, emotion: rawEmotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM({
          settings,
          character: char,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById(),
          persona: activePersona,
          world: activeWorld,
          desktopCharacterNames,
          splitEmotion: doSplitEmotion
        })
        const cleanReply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(content, char),
          char.id
        )
        if (!cleanReply) { setCharacterThinking(char.id, false); continue }
        if (nonMuted.length > 1) {
          const replyNorm = normalizeForCompare(cleanReply)
          const lastNorm = normalizeForCompare(lastReplyText)
          if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
            setCharacterThinking(char.id, false); continue
          }
        }
        let emotion = rawEmotion
        let utilityInputTokens: number | undefined
        let utilityOutputTokens: number | undefined
        let utilityDebugPrompt: string | undefined
        if (doSplitEmotion) {
          const cr = await classifyEmotionWithLLM({ settings, character: char, reply: cleanReply })
          emotion = cr.emotion
          utilityInputTokens = cr.inputTokens
          utilityOutputTokens = cr.outputTokens
          utilityDebugPrompt = cr.debugPrompt
        }
        lastReplyText = cleanReply
        const llmMeta = messageLlmMeta(debugPrompt, settings)
        const msg: Message = {
          id: uuidv4(),
          role: 'character',
          characterId: char.id,
          content: cleanReply,
          llmProvider: llmMeta.provider,
          llmModel: llmMeta.model,
          debugPrompt,
          emotion,
          inputTokens,
          outputTokens,
          utilityInputTokens,
          utilityOutputTokens,
          utilityDebugPrompt,
          timestamp: Date.now()
        }
        conv.messages.push(msg)
        conv.updatedAt = Date.now()
        setCharacterThinking(char.id, false)
        scheduleConversationBroadcast(conv)
        if (settings.ui.messageNotificationSound?.enabled !== false) {
          const volume = settings.ui.messageNotificationSound?.volume ?? 0.7
          const charWin = getCharacterWindow(char.id)
          if (charWin && !charWin.isDestroyed()) {
            charWin.webContents.send('audio:play-message-notification', { volume })
          }
        }
        await new Promise<void>(resolve => setImmediate(() => {
          showSpeechBubble(char.id, char.name, cleanReply, msg.emotion, bubbleAnchorForCharacter(char.id))
          sendCharacterContextUpdate(char.id, { lastMessage: { id: msg.id, emotion: msg.emotion } })
          resolve()
        }))
      } catch (e: unknown) {
        setCharacterThinking(char.id, false)
        const errText = e instanceof Error ? e.message : String(e)
        const errMsg: Message = {
          id: uuidv4(),
          role: 'system',
          content: `[錯誤] ${errText}`,
          llmProvider: settings.llm.provider,
          llmModel: resolveModel(settings),
          timestamp: Date.now()
        }
        conv.messages.push(errMsg)
        scheduleConversationBroadcast(conv)
        flushConversationBroadcast()
        fileStore.saveConversation(conv)
        return { ok: true }
      }
    }
    flushConversationBroadcast()
    fileStore.saveConversation(conv)
    return { ok: true }
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

  // Random Tools window
  ipcMain.handle('random-tools:open', (_, anchorX: number, anchorY: number) => {
    createRandomToolsWindow(anchorX, anchorY)
    return true
  })

  ipcMain.handle('random-tools:close', () => {
    closeRandomToolsWindow()
    return true
  })

  ipcMain.handle('random-tools:select', (_, selection: { tool: string; faces?: number; count?: number; modifier?: number; keepHighest?: number; keepLowest?: number }) => {
    closeRandomToolsWindow()
    broadcastToAll('random-tools:selected', selection)
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

  // Screenshot: hide all DesktopST windows, capture screen, restore, return data URL
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

  // Screenshot: keep all DesktopST windows visible, return data URL
  ipcMain.handle('desktop:capture-screenshot-with-characters', async () => {
    const hideInputWindow = !(settings.ui.screenshotIncludeInputWindow ?? false)
    const info = prepareScreenshotKeepingDesktopST(hideInputWindow)
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

  // Import ST/DesktopST character card (JSON); supports overwrite mode.
  ipcMain.handle('character:import-json', (_, payload: ImportJsonPayload) => {
    try {
      const { json, sourcePath, replaceCharacterId } = normalizeImportJsonPayload(payload)
      const raw = JSON.parse(json)
      const existing = replaceCharacterId
        ? characters.find(c => c.id === replaceCharacterId)
        : undefined
      const id = existing?.id ?? uuidv4()
      let char = importStJson(raw, id)
      char = resolveAssetsFromSourcePath(char, sourcePath)
      if (existing) {
        char = mergeImportedCharacterForOverwrite(existing, char)
      }

      const idx = characters.findIndex(c => c.id === char.id)
      if (idx >= 0) characters[idx] = char
      else characters.push(char)
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
    const all = fileStore.loadPersonaPresets()
    if (all.length <= 1) {
      return { error: '至少需要保留一組使用者預設。' }
    }
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
    const all = fileStore.loadWorldPresets()
    if (all.length <= 1) {
      return { error: '至少需要保留一組世界觀。' }
    }
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

  // ── Scene Presets ─────────────────────────────────────────

  ipcMain.handle('scene:list', () => fileStore.loadScenePresets())

  ipcMain.handle('scene:save', (_, preset: ScenePreset) => {
    const now = Date.now()
    preset.updatedAt = now
    if (!preset.createdAt) preset.createdAt = now
    fileStore.saveScenePreset(preset)
    broadcastToAll('scenes:updated', null)
    return preset
  })

  ipcMain.handle('scene:delete', (_, id: string) => {
    fileStore.deleteScenePreset(id)
    if (settings.activeSceneId === id) {
      settings.activeSceneId = undefined
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    }
    broadcastToAll('scenes:updated', null)
    return true
  })

  // Capture current app state as a scene snapshot (create new or update existing)
  ipcMain.handle('scene:capture', (_, id: string | null, name: string) => {
    const now = Date.now()
    const scene: ScenePreset = {
      id: id ?? uuidv4(),
      name,
      activePersonaId: settings.activePersonaId,
      activeWorldId: settings.activeWorldId,
      desktopCharacters: JSON.parse(JSON.stringify(settings.ui.desktopCharacters)) as typeof settings.ui.desktopCharacters,
      lastActiveConversationId: settings.ui.lastActiveConversationId,
      colorTheme: settings.ui.colorTheme,
      inputWindowBounds: settings.ui.inputWindowBounds,
      logWindowBounds: settings.ui.logWindowBounds,
      createdAt: id ? (fileStore.loadScenePreset(id)?.createdAt ?? now) : now,
      updatedAt: now
    }
    fileStore.saveScenePreset(scene)
    broadcastToAll('scenes:updated', null)
    return scene
  })

  ipcMain.handle('scene:load', (_, id: string) => applySceneById(id))

  // ── Reminders ────────────────────────────────────────────

  ipcMain.handle('reminder:list', () => fileStore.loadReminders())

  ipcMain.handle('reminder:save', (_, reminder: Reminder) => {
    const list = fileStore.loadReminders()
    const idx = list.findIndex(r => r.id === reminder.id)
    if (idx >= 0) list[idx] = reminder
    else list.push(reminder)
    fileStore.saveReminders(list)
    reloadReminders()
    broadcastToAll('reminders:updated', null)
    return reminder
  })

  ipcMain.handle('reminder:delete', (_, id: string) => {
    const list = fileStore.loadReminders().filter(r => r.id !== id)
    fileStore.saveReminders(list)
    reloadReminders()
    broadcastToAll('reminders:updated', null)
  })

  ipcMain.handle('reminder:toggle', (_, id: string, enabled: boolean) => {
    const list = fileStore.loadReminders()
    const r = list.find(x => x.id === id)
    if (!r) return
    r.enabled = enabled
    if (enabled) {
      const now = new Date()
      const s = r.schedule
      if (s.type === 'daily' || s.type === 'weekly') {
        s.hour = now.getHours()
        s.minute = now.getMinutes()
      }
    }
    fileStore.saveReminders(list)
    reloadReminders()
    broadcastToAll('reminders:updated', null)
  })

  ipcMain.handle('shell:open-external', (_, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('devtools:is-available', () => isDevToolsAllowed())

  ipcMain.handle('devtools:toggle', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) toggleDevToolsForWindow(win)
  })

  function desktopStStartupShortcutPath(): string {
    const appData = process.env.APPDATA
    if (!appData) return ''
    return path.join(
      appData,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'DesktopST.lnk'
    )
  }

  function desiredDesktopStStartupShortcut(): Electron.ShortcutDetails {
    const target = process.execPath
    const options: Electron.ShortcutDetails = {
      target,
      cwd: path.dirname(target),
      description: 'DesktopST',
      icon: target,
      iconIndex: 0
    }
    if (!app.isPackaged) {
      options.args = `"${app.getAppPath()}"`
    }
    return options
  }

  function normalizeShortcutPath(p?: string): string {
    if (!p) return ''
    return path.normalize(p).replace(/[\\/]+$/, '').toLowerCase()
  }

  function normalizeShortcutArgs(args?: string): string {
    return (args ?? '').trim()
  }

  function shortcutNeedsUpdate(shortcutPath: string): boolean {
    if (!shortcutPath || !fs.existsSync(shortcutPath)) return false
    try {
      const actual = shell.readShortcutLink(shortcutPath)
      const desired = desiredDesktopStStartupShortcut()
      return normalizeShortcutPath(actual.target) !== normalizeShortcutPath(desired.target) ||
        normalizeShortcutPath(actual.cwd) !== normalizeShortcutPath(desired.cwd) ||
        normalizeShortcutArgs(actual.args) !== normalizeShortcutArgs(desired.args) ||
        normalizeShortcutPath(actual.icon) !== normalizeShortcutPath(desired.icon) ||
        (actual.iconIndex ?? 0) !== (desired.iconIndex ?? 0)
    } catch {
      return true
    }
  }

  ipcMain.handle('shell:windows-startup-shortcut-status', () => {
    if (process.platform !== 'win32') {
      return { supported: false as const, exists: false, needsUpdate: false }
    }
    const shortcutPath = desktopStStartupShortcutPath()
    const exists = shortcutPath ? fs.existsSync(shortcutPath) : false
    return {
      supported: true as const,
      exists,
      needsUpdate: exists ? shortcutNeedsUpdate(shortcutPath) : false,
      path: shortcutPath
    }
  })

  ipcMain.handle('shell:add-windows-startup-shortcut', () => {
    if (process.platform !== 'win32') {
      return { ok: false as const, error: '此功能僅適用於 Windows。' }
    }
    const shortcutPath = desktopStStartupShortcutPath()
    if (!shortcutPath) {
      return { ok: false as const, error: '無法取得啟動資料夾路徑。' }
    }
    const options = desiredDesktopStStartupShortcut()
    try {
      const op = fs.existsSync(shortcutPath) ? 'update' : 'create'
      const ok = shell.writeShortcutLink(shortcutPath, op, options)
      if (!ok) {
        return { ok: false as const, error: '建立捷徑失敗。' }
      }
      return { ok: true as const, path: shortcutPath, updated: op === 'update' }
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('shell:remove-windows-startup-shortcut', () => {
    if (process.platform !== 'win32') {
      return { ok: false as const, error: '目前只支援 Windows。' }
    }
    const shortcutPath = desktopStStartupShortcutPath()
    if (!shortcutPath) {
      return { ok: false as const, error: '無法取得啟動資料夾路徑。' }
    }
    try {
      if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath)
      return { ok: true as const, path: shortcutPath }
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('shell:open-windows-startup-folder', () => {
    if (process.platform !== 'win32') {
      return { ok: false as const, error: '目前只支援 Windows。' }
    }
    const shortcutPath = desktopStStartupShortcutPath()
    const startupDir = shortcutPath ? path.dirname(shortcutPath) : ''
    if (!startupDir) {
      return { ok: false as const, error: '無法取得啟動資料夾路徑。' }
    }
    try {
      fs.mkdirSync(startupDir, { recursive: true })
      void shell.openPath(startupDir)
      return { ok: true as const, path: startupDir }
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('app:open-api-guide', () => {
    // process.resourcesPath = win-unpacked/resources，向上一層是 win-unpacked
    const guideFile = path.join(process.resourcesPath, '../docs/api-key-guide.html')
    return shell.openPath(guideFile)
  })

  ipcMain.handle('app:open-getting-started', () => {
    const guideFile = app.isPackaged
      ? path.join(process.resourcesPath, '../docs/getting-started.html')
      : path.join(app.getAppPath(), 'docs/getting-started.html')
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

  ipcMain.handle('reminder:open-manager', () => {
    openRemindersManager()
    return true
  })

  ipcMain.handle('reminder:open-manager-new', () => {
    const win = openRemindersManager()
    win.webContents.send('reminder:trigger-new')
    return true
  })

  ipcMain.handle('audio:select-notification-sound', async () => {
    const result = await dialog.showOpenDialog({
      title: '選擇通知音效',
      filters: [
        { name: '音頻檔案', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
        { name: '所有檔案', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = result.filePaths[0]
    const soundsDir = path.join(fileStore.getDataDir(), 'sounds')
    fs.mkdirSync(soundsDir, { recursive: true })
    const filename = path.basename(selectedPath)
    const destPath = path.join(soundsDir, filename)
    try {
      fs.copyFileSync(selectedPath, destPath)
      settings.ui.reminderNotificationSound = {
        ...settings.ui.reminderNotificationSound,
        enabled: settings.ui.reminderNotificationSound?.enabled ?? true,
        volume: settings.ui.reminderNotificationSound?.volume ?? 0.7,
        customSoundPath: destPath
      }
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
      return { path: destPath, filename }
    } catch (e) {
      console.error('[audio] select-notification-sound failed:', e)
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('audio:select-message-notification-sound', async () => {
    const result = await dialog.showOpenDialog({
      title: '選擇訊息通知音效',
      filters: [
        { name: '音頻檔案', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
        { name: '所有檔案', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = result.filePaths[0]
    const soundsDir = path.join(fileStore.getDataDir(), 'sounds')
    fs.mkdirSync(soundsDir, { recursive: true })
    const filename = path.basename(selectedPath)
    const destPath = path.join(soundsDir, filename)
    try {
      fs.copyFileSync(selectedPath, destPath)
      settings.ui.messageNotificationSound = {
        ...settings.ui.messageNotificationSound,
        enabled: settings.ui.messageNotificationSound?.enabled ?? true,
        volume: settings.ui.messageNotificationSound?.volume ?? 0.7,
        customSoundPath: destPath
      }
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
      return { path: destPath, filename }
    } catch (e) {
      console.error('[audio] select-message-notification-sound failed:', e)
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('app:get-version', () => app.getVersion())

  ipcMain.handle('updates:check-now', async () => {
    const result = await checkForUpdates({
      silent: false,
      dismissedVersion: settings.updates?.dismissedVersion
    })
    let changed = false
    if (result.dismissed && result.latestVersion) {
      settings.updates = { ...settings.updates, dismissedVersion: result.latestVersion }
      changed = true
    }
    if (changed) {
      fileStore.saveSettings(settings)
      broadcastToAll('settings:updated', settings)
    }
    return result
  })
}
