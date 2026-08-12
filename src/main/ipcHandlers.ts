import { ipcMain, shell, BrowserWindow, dialog, app, desktopCapturer, clipboard, nativeImage, screen, type WebContents } from 'electron'
import { checkForUpdates } from './updateChecker'
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings, Character, ColorTheme, Conversation, Message, PersonaPreset, WorldPreset, ScenePreset, PinnedNote, Reminder, RandomResult, NewsDebugInfo, NewsLinkInfo, WeatherLocationSource } from './types'
import { MESSAGE_REACTION_EMOJIS } from './types'
import * as fileStore from './fileStore'
import { chatWithLLM, testLLMConnection, testLLMMessage, applyUtilitySettings, classifyEmotionWithLLM, classifyNewsSubjectivityWithLLM, generateLoreEntryForCharacter } from './llm/index'
import { DEFAULT_MODEL_BY_PROVIDER } from '../core/llm/modelCatalog'
import { summarizeConversation, countUncoveredMessages, listSummarizableMessages } from './llm/summarizer'
import { normalizeEmotion, buildEmotionIdList, parseEmotion, resolveModel, messageLlmMeta } from './llm/promptUtils'
import { formatSystemTimeStamp } from '../core/prompt/systemTime'
import { isActiveSceneDirty } from '../core/scene/dirty'
import { applySceneSettings } from '../core/scene/apply'
import { normalizeForCompare, escapeRegExp } from '../core/util/text'
import { safeJsonParse } from '../core/util/json'
import { characterAliases } from '../core/character'
import { formatRandomResultForPrompt } from '../core/prompt/randomResult'
import { normalizeCharacterDialogue } from '../core/prompt/dialogue'
import { isAddressed, shuffleIds, pickPrimaryResponderId, sortRespondersByKeywordMatch } from '../core/group/responders'
import { stripOtherCharacterSpeakerLines } from '../core/group/dialogueCleanup'
import {
  LORE_MODULE_ID,
  type Lorebook,
  buildScanText,
  resolveScanDepth,
  resolveLorebookIds,
  orderLorebooks,
  selectLoreEntries,
  formatLoreBlock,
  importStLorebook,
  exportStLorebook,
  extractCharacterBook,
  LoreError,
  DEFAULT_SCAN_DEPTH,
  DEFAULT_TOKEN_BUDGET,
  type LoreEntry
} from '../core/lore'
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
  getWeatherContextString, invalidateWeatherCache, getRealtimeQueryContextString
} from './weatherService'
import { testCwaApiKey } from './cwaService'
import { getDisasterNewsSupplement } from './disasterNewsSupplement'
import {
  buildAuthUrl, handleAuthCallback, clearAuthFile, isAuthenticated, getSpotifyContextString
} from './spotifyService'
import {
  getCalendarContextString, beginGoogleAuth, cancelGoogleAuth, revokeGoogleAuth,
  isCalendarAuthenticated, invalidateCalendarCache, DEFAULT_CALENDAR_SETTINGS, readClientSecret,
  peekCalendar
} from './calendar'
import { encrypt } from './secureStore'
import { isDevToolsAllowed, toggleDevToolsForWindow } from './devTools'
import {
  getNewsInjectionForSpeak, getActiveNewsTopic, setActiveNewsTopic,
  setPendingNewsCredit, consumePendingNewsCredit, applyNewsFeedbackDelta,
  consumePendingUserNewsLink,
  buildSurveyDirective, buildNotesDirective, loadNewsModuleSettings, saveNewsModuleSettings,
  collectInterestTerms, fetchAllSources, NEWS_MODULE_ID, cacheManualPromptContext,
  type NewsTopic, type NewsSelectionContext, type NewsModuleSettings
} from './modules/news'
import { getConversationSearchContext } from './modules/news/conversationSearch'
import { collectModuleContext, listRegisteredModules } from './modules/moduleHost'
import { pushRemoteControlState, pushThinking as mobilePushThinking, pushThinkingDone as mobilePushThinkingDone, isServerRunning as isMobileServerRunning } from './mobileServer'

/**
 * 桌面思考動畫 ＋ 手機推播，一次做完。
 *
 * ⚠️ **一律用這支，不要直接呼叫 `setCharacterThinking`。**
 *
 * 2026-08-04 之前只有提醒與「說點什麼」兩條路徑有推手機端的 thinking-done，
 * 一般聊天（含群組接龍）從頭到尾只推了「開始思考」—— 手機的思考動畫因此
 * 只能靠 `RemoteEventSource` 的 90 秒逾時保險收掉，角色早就講完了還在轉。
 *
 * 把兩件事綁進同一支函式，就不會再有「一邊改、另一邊忘了改」的情況。
 */
function setThinking(characterId: string, thinking: boolean): void {
  setCharacterThinking(characterId, thinking)
  if (!isMobileServerRunning()) return
  if (thinking) mobilePushThinking(characterId)
  else mobilePushThinkingDone(characterId)
}
import {
  createCharacterWindow, closeCharacterWindow, getCharacterWindow, destroyAllCharacterWindows,
  resizeCharacterWindow, getCharacterWindowSize, enterCharacterScaleMode, exitCharacterScaleMode, enterScaleModeWindow,
  toggleInputWindow, toggleLogWindow, openLogWindow, openSettingsWindow,
  broadcastToAll, broadcastDesktopCharactersToCharacterWindows, getAllCharacterWindows, setCharacterWindowClickThrough,
  restoreAuxWindowsFromRememberedState, bringCharacterToFront, raiseAuxAboveCharacters, raiseAuxWindowToFront,
  hideSpeechBubble, persistSpeechBubble, hideAllCharacterSpeechBubbles, updateSpeechBubbleSize, syncSpeechBubblePosition, revealSpeechBubble, getPendingBubbleShowPayload, ackBubbleShow,
  showUserSpeechBubble, hideUserSpeechBubble, updateUserSpeechBubbleSize,
  reconcileSpeechBubbleAfterCharacterDrag, setCharacterHitRects, setCharacterInteractable, updateSpriteActualHeight,
  beginCharacterDrag, moveDraggedCharacter, endCharacterDrag, suppressAuxAutoHide, configureAuxWindowPersistence,
  setUnfocusedBubbleOpacity, setCharactersAlwaysOnTop, getCharactersAlwaysOnTop, setCharacterAlwaysOnTop, setLowPerformanceMode, setEventDrivenHitTest, notifyPointerActivity,
  createCharacterLibraryWindow,
  hideAllWindowsForScreenshot, prepareScreenshotKeepingDesktopST, restoreAllWindowsAfterScreenshot,
  showPreviewWindow,
  createPinnedNoteWindow, updatePinnedNoteContent, updatePinnedNoteColor, closePinnedNote, getPinnedNoteWindow, getPinnedNoteWindowState,
  openPinnedNotesManager, closePinnedNotesManager, configurePinnedNotePersistence, getBubbleWindow,
  openRemindersManager, closeRemindersManager,
  openRemoteControlLog, closeRemoteControlLog,
  openSpotifySettingsWindow, closeSpotifySettingsWindow,
  openCalendarSettingsWindow, closeCalendarSettingsWindow,
  openQRCodeWindow,
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
  showTopicBubbleWindow,
  closeTopicBubbleWindow,
  type BubbleAnchorFallback,
  type BubbleNewsMeta,
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
// 目前進行中的 message:send 流程的中止控制器；按下「停止」時 abort 並中斷該流程
let activeSendAbort: AbortController | null = null
/** 供停止時把內容還給輸入框（桌面 IPC／手機 `/api/stop` 共用） */
let activeSendDraft: { content: string; images?: string[] } | null = null

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

// ── Mobile bridge exports ─────────────────────────────────

export function getCharacters(): Character[] { return characters }

export function getActiveConversationForMobile(): { id: string; title: string; participantIds: string[]; messages: Message[] } | null {
  const conv = getActiveConversation()
  if (!conv) return null
  return {
    id: conv.id,
    title: conv.title,
    participantIds: conv.participantIds,
    messages: conv.messages.slice(-50)
  }
}

/** Mobile server が message を受け取ったときに呼ぶコールバック */
let mobileMessageListener: ((msg: Message) => void) | null = null
export function setMobileMessageListener(fn: ((msg: Message) => void) | null): void {
  mobileMessageListener = fn
}

export function notifyMobileMessage(msg: Message): void {
  mobileMessageListener?.(msg)
}

export async function addDesktopCharacterDirect(characterId: string): Promise<boolean> {
  if (settings.ui.desktopCharacters.some(d => d.characterId === characterId)) return false
  const char = getCharacter(characterId)
  const size = (char?.lastDesktopSize && Number.isFinite(char.lastDesktopSize) && char.lastDesktopSize > 0)
    ? char.lastDesktopSize : 1
  const flipped = char?.lastDesktopFlipped ?? false
  const pos = char?.lastDesktopPosition ?? (() => {
    const wa = screen.getPrimaryDisplay().workArea
    return { x: Math.round(wa.x + wa.width / 2), y: Math.round(wa.y + wa.height * 0.6) }
  })()
  const state: import('./types').DesktopCharacterState = {
    characterId,
    position: pos,
    size,
    flipped,
    muted: false,
    zIndex: Date.now()
  }
  settings.ui.desktopCharacters.push(state)
  fileStore.saveSettings(settings)
  createCharacterWindow(characterId, state.position, state.size)
  broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
  return true
}

export function removeDesktopCharacterDirect(characterId: string): boolean {
  if (settings.ui.desktopCharacters.length <= 1) return false
  const removing = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
  if (!removing) return false
  const char = getCharacter(characterId)
  if (char) {
    char.lastDesktopSize = removing.size
    char.lastDesktopFlipped = removing.flipped
    char.lastDesktopPosition = removing.position
    fileStore.saveCharacter(char)
  }
  settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== characterId)
  fileStore.saveSettings(settings)
  closeCharacterWindow(characterId)
  broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
  return true
}

export async function captureScreenshotDirect(withChars: boolean, displayIndex?: number): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const hideInput = !(settings.ui.screenshotIncludeInputWindow ?? false)
  const info = withChars
    ? prepareScreenshotKeepingDesktopST(hideInput, displayIndex)
    : hideAllWindowsForScreenshot(displayIndex)
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
    return { ok: true, dataUrl }
  } catch (err) {
    return { ok: false, error: String(err) }
  } finally {
    restoreAllWindowsAfterScreenshot()
  }
}

// ── Mobile: conversation / scene / preset management ─────

export function getConversationListDirect(): { id: string; title: string; updatedAt: number; active: boolean }[] {
  const ids = fileStore.listConversationIds()
  return ids
    .map(id => {
      const conv = getOrLoadConversation(id)
      return conv
        ? { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, active: id === activeConversationId }
        : { id, title: '對話', updatedAt: 0, active: false }
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

/**
 * S1 對話匯入的清單（roadmap §4.7）。
 *
 * 與 `getConversationListDirect` 分開是因為勾選畫面要多知道兩件事：
 * 有幾則訊息、參與的角色是誰 —— 沒有這兩個，使用者只看得到一排標題與時間，
 * 沒辦法判斷哪些值得帶過去。
 */
export function getConversationsForSyncDirect(): {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  characterNames: string[]
}[] {
  return fileStore.listConversationIds()
    .map(id => getOrLoadConversation(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map(conv => {
      const ids = new Set(conv.messages.map(m => m.characterId).filter(Boolean) as string[])
      return {
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
        characterNames: [...ids].map(cid => getCharacter(cid)?.name).filter(Boolean) as string[]
      }
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

/**
 * 取一整則對話給手機匯入。**不切換電腦上正在看的那則**
 * （`loadConversationDirect` 會切，那是遙控用的）。
 *
 * 除錯用的 prompt 一律剝掉：一則 prompt 動輒數十 KB，而手機那邊只是要保存
 * 聊天記錄，帶過去純粹是把傳輸與儲存撐大。圖片保留 —— 那是內容。
 */
export function getConversationForSyncDirect(id: string): Conversation | null {
  const conv = getOrLoadConversation(id)
  if (!conv) return null
  return {
    ...conv,
    messages: conv.messages.map(m => {
      const { debugPrompt, utilityDebugPrompt, convSearchDebugPrompt, newsDebug, ...rest } = m
      void debugPrompt; void utilityDebugPrompt; void convSearchDebugPrompt; void newsDebug
      return { ...rest, hasDebugPrompt: false, hasNewsDebug: false }
    })
  }
}

export function loadConversationDirect(id: string): boolean {
  const conv = getOrLoadConversation(id)
  if (!conv) return false
  activeConversationId = id
  syncLastActiveConversationToSettings()
  broadcastConversationUpdate(conv)
  syncCharacterContextsFromConversation(conv)
  return true
}

export function createConversationDirect(title?: string): { id: string; title: string; updatedAt: number; active: boolean } {
  const conv = createNewConversation()
  const nextTitle = String(title ?? '').trim()
  if (nextTitle) {
    conv.title = nextTitle
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
  }
  broadcastConversationUpdate(conv)
  syncCharacterContextsFromConversation(conv)
  return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, active: true }
}

export function renameConversationDirect(id: string, title: string): { ok: true; conversation: { id: string; title: string; updatedAt: number; active: boolean } } | { error: string } {
  const conv = getOrLoadConversation(id)
  if (!conv) return { error: 'Conversation not found' }
  const nextTitle = String(title || '').trim() || '新對話'
  conv.title = nextTitle
  conv.updatedAt = Date.now()
  conversations.set(conv.id, conv)
  fileStore.saveConversation(conv)
  if (conv.id === activeConversationId) {
    broadcastConversationUpdate(conv)
    syncCharacterContextsFromConversation(conv)
  }
  return {
    ok: true,
    conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, active: conv.id === activeConversationId }
  }
}

export function deleteConversationDirect(id: string): { ok: true; activeConversationId: string } | { error: string } {
  const deletingId = String(id || '')
  if (!deletingId) return { error: 'id required' }
  const exists = !!getOrLoadConversation(deletingId)
  if (!exists) return { error: 'Conversation not found' }

  fileStore.deleteConversation(deletingId)
  conversations.delete(deletingId)

  if (activeConversationId !== deletingId) {
    const active = getActiveConversation()
    if (active) broadcastConversationUpdate(active)
    return { ok: true, activeConversationId: activeConversationId ?? '' }
  }

  activeConversationId = null
  const nextId = pickNextConversationId(deletingId)
  if (nextId) {
    activeConversationId = nextId
    const next = getOrLoadConversation(nextId)
    if (next) {
      syncLastActiveConversationToSettings()
      broadcastConversationUpdate(next)
      syncCharacterContextsFromConversation(next)
      return { ok: true, activeConversationId: next.id }
    }
  }

  const fresh = createNewConversation()
  broadcastConversationUpdate(fresh)
  syncCharacterContextsFromConversation(fresh)
  return { ok: true, activeConversationId: fresh.id }
}

export function getScenesDirect(): import('./types').ScenePreset[] {
  return fileStore.loadScenePresets().sort((a, b) => a.createdAt - b.createdAt)
}

export function getPersonaPresetsDirect(): import('./types').PersonaPreset[] {
  return fileStore.loadPersonaPresets()
}

export function getWorldPresetsDirect(): import('./types').WorldPreset[] {
  return fileStore.loadWorldPresets()
}

export function activatePersonaDirect(id: string): boolean {
  const preset = fileStore.loadPersonaPreset(id)
  if (!preset) return false
  settings.activePersonaId = id
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return true
}

/**
 * 從手機端變更色彩主題。
 *
 * 主題是**電腦端設定的一部分**（`settings.ui.colorTheme`），不是手機的本機偏好——
 * `mobile.html` 一直是唯讀地跟著電腦跑。手機要能改，就得寫回這裡，
 * 否則會變成「改了看起來有效、重新整理就跳回去」（owner 2026-08-04 回報）。
 */
export function setColorThemeDirect(theme: ColorTheme): boolean {
  if (settings.ui.colorTheme === theme) return true
  settings.ui.colorTheme = theme
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return true
}

export function setShowLlmBadgeDirect(show: boolean): boolean {
  if ((settings.ui.showLlmBadge !== false) === show) return true
  settings.ui.showLlmBadge = show
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return true
}

export function setShowPersonaNameDirect(show: boolean): boolean {
  if ((settings.ui.showPersonaName !== false) === show) return true
  settings.ui.showPersonaName = show
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return true
}

/**
 * 手機用：取某則訊息保留的完整 prompt（與 `conversation:get-message-debug` 同一份資料）。
 *
 * 找不到就回 `null` —— 超過保留則數的舊訊息會被 `prune` 剝掉 prompt，那是正常結果。
 */
export function getMessageDebugDirect(messageId: string): {
  debugPrompt: string | null
  utilityDebugPrompt: string | null
  convSearchDebugPrompt: string | null
  newsDebug: unknown
} | null {
  const conv = getActiveConversation()
  const msg = conv?.messages.find(m => m.id === messageId)
  if (!msg) return null
  return {
    debugPrompt: msg.debugPrompt ?? null,
    utilityDebugPrompt: msg.utilityDebugPrompt ?? null,
    convSearchDebugPrompt: msg.convSearchDebugPrompt ?? null,
    newsDebug: msg.newsDebug ?? null
  }
}

export function activateWorldDirect(id: string): boolean {
  const preset = fileStore.loadWorldPreset(id)
  if (!preset) return false
  settings.activeWorldId = id
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return true
}

// ── 手機／桌面共用的預設組 CRUD（B3 階段 5）───────────────
// 寫入必須集中在這裡：mobileServer 只是 RPC 轉接，桌面 IPC 也只是薄轉呼叫。
// 這樣兩端的「至少保留一組」與啟用中刪除後的 fallback 不會各自漂移。
export function savePersonaPresetDirect(incoming: PersonaPreset): PersonaPreset {
  const now = Date.now()
  const existing = incoming.id ? fileStore.loadPersonaPreset(incoming.id) : null
  const preset: PersonaPreset = {
    ...incoming,
    id: existing?.id ?? uuidv4(),
    name: incoming.name.trim() || '未命名使用者設定',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  fileStore.savePersonaPreset(preset)
  broadcastToAll('presets:updated', null)
  return preset
}

export function removePersonaPresetDirect(id: string): { ok: true } | { error: 'last-preset' | 'not-found' } {
  const all = fileStore.loadPersonaPresets()
  if (!all.some(p => p.id === id)) return { error: 'not-found' }
  if (all.length <= 1) return { error: 'last-preset' }
  fileStore.deletePersonaPreset(id)
  if (settings.activePersonaId === id) {
    settings.activePersonaId = fileStore.loadPersonaPresets()[0]?.id ?? ''
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
  }
  broadcastToAll('presets:updated', null)
  return { ok: true }
}

export function saveWorldPresetDirect(incoming: WorldPreset): WorldPreset {
  const now = Date.now()
  const existing = incoming.id ? fileStore.loadWorldPreset(incoming.id) : null
  const preset: WorldPreset = {
    ...incoming,
    id: existing?.id ?? uuidv4(),
    name: incoming.name.trim() || '未命名世界觀',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  fileStore.saveWorldPreset(preset)
  broadcastToAll('presets:updated', null)
  return preset
}

export function removeWorldPresetDirect(id: string): { ok: true } | { error: 'last-preset' | 'not-found' } {
  const all = fileStore.loadWorldPresets()
  if (!all.some(p => p.id === id)) return { error: 'not-found' }
  if (all.length <= 1) return { error: 'last-preset' }
  fileStore.deleteWorldPreset(id)
  if (settings.activeWorldId === id) {
    settings.activeWorldId = fileStore.loadWorldPresets()[0]?.id ?? ''
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
  }
  broadcastToAll('presets:updated', null)
  return { ok: true }
}

export function saveScenePresetDirect(incoming: ScenePreset): ScenePreset {
  const now = Date.now()
  const existing = incoming.id ? fileStore.loadScenePreset(incoming.id) : null
  // 新增情境時以現在的桌面狀態為快照；手機不必、也不應自行拼桌面視窗座標。
  const base: ScenePreset = existing ?? {
    id: uuidv4(), name: '未命名情境', activePersonaId: settings.activePersonaId,
    activeWorldId: settings.activeWorldId,
    desktopCharacters: JSON.parse(JSON.stringify(settings.ui.desktopCharacters)),
    lastActiveConversationId: settings.ui.lastActiveConversationId,
    colorTheme: settings.ui.colorTheme,
    inputWindowBounds: settings.ui.inputWindowBounds,
    logWindowBounds: settings.ui.logWindowBounds,
    createdAt: now, updatedAt: now
  }
  const preset: ScenePreset = {
    ...base,
    name: incoming.name.trim() || base.name,
    activePersonaId: incoming.activePersonaId || base.activePersonaId,
    activeWorldId: incoming.activeWorldId || base.activeWorldId,
    lorebookIds: incoming.lorebookIds,
    moduleOverrides: incoming.moduleOverrides,
    // 編輯器若有帶 colorTheme（或桌面覆寫路徑寫入）要能存回；未帶則沿用既有／新建時的快照
    colorTheme: incoming.colorTheme ?? base.colorTheme,
    updatedAt: now
  }
  fileStore.saveScenePreset(preset)
  broadcastToAll('scenes:updated', null)
  return preset
}

/**
 * 把目前桌面／設定狀態擷取為情境快照（新建或覆寫既有）。
 * 桌面 IPC `scene:capture` 與手機「覆寫為目前狀態」共用。
 */
export function captureSceneDirect(id: string | null, name: string): ScenePreset {
  const now = Date.now()
  const existing = id ? fileStore.loadScenePreset(id) : null
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
    // 覆寫狀態時保留既有的新聞關鍵字組綁定、用語解說綁定與模組開關覆蓋（它們不是桌面快照的一部分）
    newsKeywordGroupId: existing?.newsKeywordGroupId,
    lorebookIds: existing?.lorebookIds,
    moduleOverrides: existing?.moduleOverrides,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  fileStore.saveScenePreset(scene)
  broadcastToAll('scenes:updated', null)
  return scene
}

/** 使用中情境是否與目前狀態不一致（給 /api/state 與桌面 UI 共用判定邏輯）。 */
export function getActiveSceneDirtyDirect(): boolean {
  const id = settings.activeSceneId
  if (!id) return false
  const scene = fileStore.loadScenePreset(id)
  if (!scene) return false
  return isActiveSceneDirty(scene, {
    activePersonaId: settings.activePersonaId,
    activeWorldId: settings.activeWorldId,
    colorTheme: settings.ui.colorTheme,
    lastActiveConversationId: settings.ui.lastActiveConversationId,
    desktopCharacterIds: settings.ui.desktopCharacters.map(d => d.characterId)
  })
}

export function removeScenePresetDirect(id: string): { ok: true } | { error: 'not-found' } {
  if (!fileStore.loadScenePreset(id)) return { error: 'not-found' }
  fileStore.deleteScenePreset(id)
  if (settings.activeSceneId === id) {
    settings.activeSceneId = undefined
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
  }
  broadcastToAll('scenes:updated', null)
  return { ok: true }
}

// ── 用語解說（Lorebook）CRUD（B3 階段 9）───────────────────
// 桌面 IPC（`lorebook:*`）與手機 mobileServer 都薄轉呼叫這幾支，邏輯只有一份。
export function getLorebookDirect(id: string): Lorebook | null {
  return fileStore.loadLorebook(id)
}

export function createLorebookDirect(name?: string): Lorebook {
  const now = Date.now()
  const book: Lorebook = {
    id: uuidv4(),
    name: (name ?? '').trim() || '用語解說',
    entries: [],
    scan_depth: DEFAULT_SCAN_DEPTH,
    token_budget: DEFAULT_TOKEN_BUDGET,
    createdAt: now,
    updatedAt: now
  }
  fileStore.saveLorebook(book)
  broadcastToAll('lorebooks:updated', null)
  return book
}

export function saveLorebookDirect(incoming: Lorebook): { ok: true; book: Lorebook } | { error: 'invalid-input' } {
  if (!incoming?.id) return { error: 'invalid-input' }
  const book: Lorebook = { ...incoming, updatedAt: Date.now() }
  fileStore.saveLorebook(book)
  broadcastToAll('lorebooks:updated', null)
  return { ok: true, book }
}

export function removeLorebookDirect(id: string): { ok: true } {
  fileStore.deleteLorebook(id)
  // 掛在角色卡／世界觀／情境上的參照一併清掉，避免留下指向不存在的 id
  for (const c of characters) {
    if (c.lorebookIds?.includes(id)) {
      c.lorebookIds = c.lorebookIds.filter(x => x !== id)
      fileStore.saveCharacter(c)
    }
  }
  for (const w of fileStore.loadWorldPresets()) {
    if (w.lorebookIds?.includes(id)) {
      fileStore.saveWorldPreset({ ...w, lorebookIds: w.lorebookIds.filter(x => x !== id), updatedAt: Date.now() })
    }
  }
  for (const s of fileStore.loadScenePresets()) {
    if (s.lorebookIds?.includes(id)) {
      fileStore.saveScenePreset({ ...s, lorebookIds: s.lorebookIds.filter(x => x !== id), updatedAt: Date.now() })
    }
  }
  broadcastToAll('lorebooks:updated', null)
  broadcastToAll('characters:updated', characters)
  broadcastToAll('scenes:updated', null)
  return { ok: true }
}

/**
 * 從角色卡生成一條用語解說並加進指定的書（規格 §8）。
 * 桌面 IPC（`lorebook:generate-entry`）與手機 `mobileServer` 都薄轉呼叫這支，邏輯只有一份。
 */
export async function generateLoreEntryDirect(
  characterId: string,
  lorebookId: string
): Promise<{ ok: true; entry: LoreEntry } | { error: string }> {
  const char = getCharacter(characterId)
  if (!char) return { error: '找不到角色' }
  const book = fileStore.loadLorebook(lorebookId)
  if (!book) return { error: '找不到這本用語解說' }
  const generated = await generateLoreEntryForCharacterSafe(char)
  if (!generated) return { error: '生成失敗，請確認 API Key 與模型設定' }
  const entry: LoreEntry = {
    id: uuidv4(),
    insertion_order: book.entries.length,
    ...generated
  }
  book.entries.push(entry)
  book.updatedAt = Date.now()
  fileStore.saveLorebook(book)
  broadcastToAll('lorebooks:updated', null)
  return { ok: true, entry }
}

// ── 手機端設定（B3 階段 4）──────────────────────────────
//
// 桌面設定視窗的 LLM 分頁涵蓋供應商目錄、價格提示等桌面專屬的呈現邏輯；
// 手機第一層只需要「填 API Key ＋ 供應商／模型」，這裡只做資料面的讀寫，
// 供應商清單／模型建議清單等 UI 文案留在 `src/mobile/ui/`（roadmap §3.3）。

const MOBILE_LLM_PROVIDERS: AppSettings['llm']['provider'][] = ['openai', 'claude', 'gemini', 'grok']

function isMobileLlmProvider(v: unknown): v is AppSettings['llm']['provider'] {
  return typeof v === 'string' && (MOBILE_LLM_PROVIDERS as string[]).includes(v)
}

/**
 * ⚠️ **刻意不回傳金鑰本身**（roadmap §4.7）：就算區網直連可以編輯，也不必把明文
 * 送到手機顯示——換一把新的不需要先看到舊的。`hasApiKey` 只回答「有沒有設定」，
 * 涵蓋解密失敗時留在 `encryptedApiKeyFallbacks` 的情況（此時 `apiKeys[p]` 是空字串）。
 */
/**
 * S1 初始化匯入用：明文 API Key。
 *
 * ⚠️ **呼叫端必須先確認是區網直連**（`mobileServer` 的 `isLanDirectRequest`）。
 * 這是唯一會把金鑰送出電腦的路徑，且僅限 S1、僅限私有位址；
 * S2 雙向同步永不同步金鑰，DST Pack 匯出也一律排除（roadmap §4.7）。
 * 解密失敗而落在 `encryptedApiKeyFallbacks` 的供應商會被跳過（送密文過去沒有意義）。
 */
export function getApiKeysForSyncDirect(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of MOBILE_LLM_PROVIDERS) {
    const key = (settings.llm.apiKeys?.[p] ?? '').trim()
    if (key) out[p] = key
  }
  return out
}

export function getLlmSettingsSummaryDirect(): {
  provider: AppSettings['llm']['provider']
  model: string
  models: Partial<Record<AppSettings['llm']['provider'], string>>
  endpoint?: string
  hasApiKey: Record<AppSettings['llm']['provider'], boolean>
  maxResponseTokens: number
  maxGroupRounds: number
  maxImagesPerMessage: number
  utilityEnabled: boolean
  utilityProvider: AppSettings['llm']['provider']
  utilityModel: string
  utilityModels: Partial<Record<AppSettings['llm']['provider'], string>>
} {
  const hasApiKey = {} as Record<AppSettings['llm']['provider'], boolean>
  for (const p of MOBILE_LLM_PROVIDERS) {
    hasApiKey[p] = !!(settings.llm.apiKeys?.[p] ?? '').trim() || fileStore.encryptedApiKeyFallbacks.has(p)
  }
  const utilityProvider = settings.llm.utilityProvider ?? settings.llm.provider
  return {
    provider: settings.llm.provider,
    model: settings.llm.models?.[settings.llm.provider] ?? settings.llm.model,
    models: { ...settings.llm.models },
    endpoint: settings.llm.endpoint,
    hasApiKey,
    maxResponseTokens: Math.max(100, Math.floor(Number(settings.llm.maxResponseTokens) || 400)),
    maxGroupRounds: Math.max(1, Math.floor(Number(settings.llm.maxGroupRounds) || 1)),
    maxImagesPerMessage: Math.max(1, Math.floor(Number(settings.llm.maxImagesPerMessage) || 5)),
    utilityEnabled: !!settings.llm.utilityEnabled,
    utilityProvider,
    utilityModel: settings.llm.utilityModels?.[utilityProvider] ?? '',
    utilityModels: { ...settings.llm.utilityModels }
  }
}

export function setLlmProviderDirect(provider: string): { ok: true } | { error: string } {
  if (!isMobileLlmProvider(provider)) return { error: '不支援的供應商' }
  settings.llm.provider = provider
  const savedModel = settings.llm.models?.[provider]
  if (savedModel) settings.llm.model = savedModel
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

export function setLlmModelDirect(provider: string, model: string): { ok: true } | { error: string } {
  if (!isMobileLlmProvider(provider)) return { error: '不支援的供應商' }
  const trimmed = model.trim()
  if (!trimmed) return { error: '模型名稱不可空白' }
  if (!settings.llm.models) settings.llm.models = {}
  settings.llm.models[provider] = trimmed
  if (settings.llm.provider === provider) settings.llm.model = trimmed
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

export function setLlmUtilityEnabledDirect(enabled: boolean): { ok: true } | { error: string } {
  settings.llm.utilityEnabled = enabled
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

// 同 `setLlmProviderDirect`：換供應商時沒選過型號就補目錄預設值，避免存出空模型。
export function setLlmUtilityProviderDirect(provider: string): { ok: true } | { error: string } {
  if (!isMobileLlmProvider(provider)) return { error: '不支援的供應商' }
  settings.llm.utilityProvider = provider
  const model = settings.llm.utilityModels?.[provider] || DEFAULT_MODEL_BY_PROVIDER[provider] || ''
  if (model) {
    if (!settings.llm.utilityModels) settings.llm.utilityModels = {}
    settings.llm.utilityModels[provider] = model
  }
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

export function setLlmUtilityModelDirect(provider: string, model: string): { ok: true } | { error: string } {
  if (!isMobileLlmProvider(provider)) return { error: '不支援的供應商' }
  const trimmed = model.trim()
  if (!trimmed) return { error: '模型名稱不可空白' }
  if (!settings.llm.utilityModels) settings.llm.utilityModels = {}
  settings.llm.utilityModels[provider] = trimmed
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

export function setLlmEndpointDirect(endpoint: string): { ok: true } | { error: string } {
  settings.llm.endpoint = endpoint.trim() || undefined
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

/**
 * 覆寫 API Key。呼叫端（`mobileServer.ts`）必須先做來源 IP 檢查再呼叫這支——
 * 這裡本身不重複判斷，是否區網直連是傳輸層的事，不是設定層的事。
 */
export function setLlmApiKeyDirect(provider: string, apiKey: string): { ok: true } | { error: string } {
  if (!isMobileLlmProvider(provider)) return { error: '不支援的供應商' }
  if (!settings.llm.apiKeys) settings.llm.apiKeys = {}
  settings.llm.apiKeys[provider] = apiKey
  fileStore.encryptedApiKeyFallbacks.delete(provider)
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

export function setLlmChatLimitsDirect(limits: {
  maxResponseTokens: number
  maxGroupRounds: number
  maxImagesPerMessage: number
}): { ok: true } | { error: string } {
  const maxResponseTokens = Math.round(Number(limits.maxResponseTokens))
  const maxGroupRounds = Math.round(Number(limits.maxGroupRounds))
  const maxImagesPerMessage = Math.round(Number(limits.maxImagesPerMessage))
  if (!Number.isFinite(maxResponseTokens) || maxResponseTokens < 100 || maxResponseTokens > 1000) {
    return { error: '回應字數需在 100–1000' }
  }
  if (!Number.isFinite(maxGroupRounds) || maxGroupRounds < 1 || maxGroupRounds > 10) {
    return { error: '群組回應數需在 1–10' }
  }
  if (!Number.isFinite(maxImagesPerMessage) || maxImagesPerMessage < 1 || maxImagesPerMessage > 10) {
    return { error: '圖片上限需在 1–10' }
  }
  settings.llm.maxResponseTokens = maxResponseTokens
  settings.llm.maxGroupRounds = maxGroupRounds
  settings.llm.maxImagesPerMessage = maxImagesPerMessage
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  // 圖片上限會影響手機 Composer；推一次狀態讓快照刷新
  try { pushRemoteControlState() } catch { /* mobile server 可能未開 */ }
  return { ok: true }
}

export function getMemorySettingsDirect(): { keepRecentN: number; autoSummarizeAfter: number; autoSummarizeEnabled: boolean } {
  return {
    keepRecentN: settings.memory.keepRecentN,
    autoSummarizeAfter: settings.memory.autoSummarizeAfter,
    autoSummarizeEnabled: settings.memory.autoSummarizeEnabled
  }
}

export function setMemorySettingsDirect(m: {
  keepRecentN: number
  autoSummarizeAfter: number
  autoSummarizeEnabled: boolean
}): { ok: true } | { error: string } {
  const keepRecentN = Math.round(Number(m.keepRecentN))
  const autoSummarizeAfter = Math.round(Number(m.autoSummarizeAfter))
  if (!Number.isFinite(keepRecentN) || keepRecentN < 1 || keepRecentN > 200) return { error: '「保留最近幾則」超出範圍（1–200）' }
  if (!Number.isFinite(autoSummarizeAfter) || autoSummarizeAfter < 1 || autoSummarizeAfter > 500) return { error: '「自動摘要門檻」超出範圍（1–500）' }
  settings.memory = { ...settings.memory, keepRecentN, autoSummarizeAfter, autoSummarizeEnabled: !!m.autoSummarizeEnabled }
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

/**
 * 手機「進階」摺疊區的模組開關。**只涵蓋有簡單全域 `enabled` 旗標的模組**——
 * 遙控是獨立的 B6 功能（`Capabilities.remoteControl`），用語解說沒有全域開關
 * （見 `isModuleEffectivelyEnabled` 對 `LORE_MODULE_ID` 的註解），皆不在此列。
 */
// 用函式而非模組頂層 const：`WEATHER_MODULE_ID` 等常數宣告在本檔更下面，
// 頂層 const 會在它們賦值前就執行而撞到 TDZ（`used before its declaration`）。
function mobileModuleToggleDefs(): { id: string; label: string }[] {
  return [
    { id: WEATHER_MODULE_ID, label: '天氣' },
    { id: NEWS_MODULE_ID, label: '新聞陪聊' },
    { id: SPOTIFY_MODULE_ID, label: 'Spotify 音樂偵測' },
    { id: CALENDAR_MODULE_ID, label: 'Google 日曆' }
  ]
}

export function listMobileModuleTogglesDirect(): { id: string; label: string; enabled: boolean }[] {
  return mobileModuleToggleDefs().map(m => ({
    id: m.id,
    label: m.label,
    enabled:
      m.id === WEATHER_MODULE_ID ? !!settings.weather?.enabled :
      m.id === SPOTIFY_MODULE_ID ? !!settings.spotify?.enabled :
      m.id === CALENDAR_MODULE_ID ? !!settings.calendar?.enabled :
      m.id === NEWS_MODULE_ID ? loadNewsModuleSettings().enabled :
      false
  }))
}

/**
 * 天氣／Spotify／日曆需要先在電腦上完成基本設定（地點、Client ID⋯⋯）才有
 * 對應的 settings 子物件；手機這支只負責開關，不做這幾個模組的完整設定流程
 * （那是外部服務的 OAuth／API Key 設定，超出「模組開關」的範圍）。
 */
export function setMobileModuleEnabledDirect(id: string, enabled: boolean): { ok: true } | { error: string } {
  switch (id) {
    case WEATHER_MODULE_ID:
      if (!settings.weather) return { error: '尚未在電腦上設定天氣模組' }
      settings.weather = { ...settings.weather, enabled }
      break
    case SPOTIFY_MODULE_ID:
      if (!settings.spotify) return { error: '尚未在電腦上設定 Spotify' }
      settings.spotify = { ...settings.spotify, enabled }
      break
    case CALENDAR_MODULE_ID:
      if (!settings.calendar) return { error: '尚未在電腦上連結 Google 日曆' }
      settings.calendar = { ...settings.calendar, enabled }
      break
    case NEWS_MODULE_ID:
      saveNewsModuleSettings({ enabled })
      break
    default:
      return { error: '未知的模組' }
  }
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true }
}

/** 手機可讀寫的天氣設定快照（不含 CWA API Key 等進階欄位）。 */
export function getWeatherSettingsDirect(): {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: WeatherLocationSource
  utilityEnabled: boolean
} {
  const w = settings.weather
  return {
    enabled: !!w?.enabled,
    polish: !!w?.polish,
    locationName: w?.locationName ?? '',
    latitude: w?.latitude ?? 0,
    longitude: w?.longitude ?? 0,
    locationSource: w?.locationSource ?? '',
    utilityEnabled: !!settings.llm?.utilityEnabled
  }
}

function ensureWeatherSettings(): NonNullable<typeof settings.weather> {
  if (!settings.weather) {
    settings.weather = {
      enabled: false,
      polish: false,
      locationName: '',
      latitude: 0,
      longitude: 0,
      locationSource: ''
    }
  }
  return settings.weather
}

/**
 * 手機寫入天氣基本設定（位置／開關／潤飾）。
 * CWA 即時查詢與 API Key 仍只在桌面設定（與 Spotify／日曆授權同層級的進階）。
 */
export function setWeatherSettingsDirect(patch: {
  enabled?: boolean
  polish?: boolean
  locationName?: string
  latitude?: number
  longitude?: number
  locationSource?: WeatherLocationSource
}): { ok: true; weather: ReturnType<typeof getWeatherSettingsDirect> } | { error: string } {
  const w = ensureWeatherSettings()
  if (typeof patch.enabled === 'boolean') {
    if (patch.enabled && !w.locationName && !(patch.locationName && patch.locationName.trim())) {
      return { error: '請先設定所在地點' }
    }
    w.enabled = patch.enabled
  }
  if (typeof patch.polish === 'boolean') w.polish = patch.polish
  if (typeof patch.locationName === 'string') w.locationName = patch.locationName.trim().slice(0, 120)
  if (typeof patch.latitude === 'number' && Number.isFinite(patch.latitude)) w.latitude = patch.latitude
  if (typeof patch.longitude === 'number' && Number.isFinite(patch.longitude)) w.longitude = patch.longitude
  if (
    patch.locationSource === 'ip' ||
    patch.locationSource === 'gps' ||
    patch.locationSource === 'manual' ||
    patch.locationSource === ''
  ) {
    w.locationSource = patch.locationSource
  }
  settings.weather = w
  invalidateWeatherCache()
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true, weather: getWeatherSettingsDirect() }
}

/**
 * S1 要送去手機的天氣設定。
 *
 * **不含地點** —— 手機自己有 GPS，帶座標過去只會讓它出門在外顯示家裡的天氣
 * （owner 2026-08-08 決定）。帶的是「設定兩次很煩」的那幾項：潤飾開關、
 * CWA 縣市與金鑰。
 *
 * `cwaApiKey` 只在區網直連時附上，規矩與 LLM 金鑰完全相同：
 * 判定在這一端做，非直連時**連欄位都不出現**（不是空字串，
 * 否則手機會誤判成「電腦上清空了」而把自己填的那把洗掉）。
 */
export function getWeatherSyncSettingsDirect(lanDirect: boolean): {
  polish: boolean
  realtimeQuery?: { enabled: boolean; forecastCounty: string; cwaApiKey?: string }
} {
  const w = settings.weather
  const rq = w?.realtimeQuery
  return {
    polish: !!w?.polish,
    ...(rq
      ? {
          realtimeQuery: {
            enabled: !!rq.enabled,
            forecastCounty: rq.forecastCounty ?? '',
            // 解不開的金鑰長得像密文，那種情況當作沒有，不要送過去汙染手機
            ...(lanDirect && rq.cwaApiKey && !rq.cwaApiKey.startsWith('enc:v1:')
              ? { cwaApiKey: rq.cwaApiKey }
              : {})
          }
        }
      : {})
  }
}

/**
 * S1 要送去手機的新聞設定（owner 2026-08-12：「不然我要手動重設關鍵字很麻煩」）。
 *
 * 帶的是**使用者自己設定過的那些**——關鍵字／訂閱來源、分組、黑名單、
 * 語言與陪聊偏好、新聞報版面配額。手機端的新聞設定畫面能改的欄位全在裡面。
 *
 * **刻意不帶的四項**：
 * - `enabled`：模組開關走 `modules`，那條路徑兩邊都已經有了，不要兩處各送一次
 *   （送兩份而值不同時，後套用的會贏，行為變得看順序）。
 * - `seenIds`：「這則聊過了」是每台裝置各自的去重歷史，不是設定。
 * - `feedback.adjustments`：學習來的權重是衍生資料，跟著各自的使用習慣長。
 * - `reminder`（定時陪聊排程）：手機的提醒是原生精準鬧鐘、有自己的一套
 *   （`docs/mobile-standalone-reminder-plan.md`），把電腦的排程灌過去會憑空
 *   多出一則手機沒答應過的鬧鐘。要排程請在手機上自己設。
 */
export function getNewsSyncSettingsDirect(): Omit<
  NewsModuleSettings,
  'enabled' | 'seenIds' | 'feedback' | 'reminder'
> {
  const { enabled: _enabled, seenIds: _seenIds, feedback: _feedback, reminder: _reminder, ...rest } =
    loadNewsModuleSettings()
  return rest
}

export async function detectWeatherLocationDirect(): Promise<
  { ok: true; weather: ReturnType<typeof getWeatherSettingsDirect> } | { error: string }
> {
  const result = await detectLocationByIP()
  if (!result) return { error: '偵測失敗，請手動輸入城市名稱' }
  const w = ensureWeatherSettings()
  w.locationName = result.city
  w.latitude = result.lat
  w.longitude = result.lon
  w.locationSource = 'ip'
  if (!w.enabled) w.enabled = true
  settings.weather = w
  invalidateWeatherCache()
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true, weather: getWeatherSettingsDirect() }
}

export async function geocodeWeatherLocationDirect(name: string): Promise<
  { ok: true; weather: ReturnType<typeof getWeatherSettingsDirect> } | { error: string }
> {
  const q = name.trim()
  if (!q) return { error: '請輸入城市名稱' }
  const result = await geocodeCity(q)
  if (!result) return { error: '找不到城市，請換個關鍵字' }
  const w = ensureWeatherSettings()
  w.locationName = result.name
  w.latitude = result.lat
  w.longitude = result.lon
  w.locationSource = 'manual'
  if (!w.enabled) w.enabled = true
  settings.weather = w
  invalidateWeatherCache()
  fileStore.saveSettings(settings)
  broadcastToAll('settings:updated', settings)
  return { ok: true, weather: getWeatherSettingsDirect() }
}

export async function fetchWeatherNowDirect(): Promise<
  { ok: true; description: string; temperatureC: number; humidity: number; windSpeed: number } | { error: string }
> {
  const w = settings.weather
  if (!w?.locationName || !w.latitude || !w.longitude) return { error: '尚未設定位置' }
  invalidateWeatherCache()
  const data = await fetchWeather(w.latitude, w.longitude, w.locationName)
  if (!data) return { error: '天氣更新失敗' }
  return { ok: true, ...data }
}

// ── 提醒 CRUD（B3 階段 4 資料面；排程本身是 B5）───────────
//
// 桌面 IPC handler 與手機端共用這幾支，避免「桌面存得起來、手機存出一份
// 存不進排程」這種 drift（比照角色卡寫入，計畫書 §4.14）。

export function listRemindersDirect(): Reminder[] {
  return fileStore.loadReminders()
}

/**
 * 建立一個空白提醒並立刻存檔，回傳含新 id 的完整物件。
 *
 * id 在這裡產生、不讓手機端自己生：手機上 `crypto.randomUUID()` 在非安全內容
 * （`http://192.168.x.x`）不存在，同 `createCharacterDirect` 的理由。
 */
export function createReminderDirect(): Reminder {
  const now = new Date()
  const reminder: Reminder = {
    id: uuidv4(),
    label: '',
    prompt: '',
    schedule: { type: 'daily', hour: now.getHours(), minute: now.getMinutes() },
    enabled: true,
    createdAt: Date.now()
  }
  const list = fileStore.loadReminders()
  list.push(reminder)
  fileStore.saveReminders(list)
  reloadReminders()
  broadcastToAll('reminders:updated', null)
  return reminder
}

export function saveReminderDirect(reminder: Reminder): Reminder {
  const list = fileStore.loadReminders()
  const idx = list.findIndex(r => r.id === reminder.id)
  if (idx >= 0) list[idx] = reminder
  else list.push(reminder)
  fileStore.saveReminders(list)
  reloadReminders()
  broadcastToAll('reminders:updated', null)
  return reminder
}

export function deleteReminderDirect(id: string): void {
  const list = fileStore.loadReminders().filter(r => r.id !== id)
  fileStore.saveReminders(list)
  reloadReminders()
  broadcastToAll('reminders:updated', null)
}

export function toggleReminderDirect(id: string, enabled: boolean): void {
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
}

/** mobile:get-status IPC 的 status 查詢函式（由 index.ts 注入）*/
let _getMobileStatusFn: (() => unknown) | null = null
export function setGetMobileStatusFn(fn: () => unknown): void { _getMobileStatusFn = fn }

let _applyMobileRuntimeSettingsFn: ((previous: AppSettings, next: AppSettings) => void) | null = null
export function setApplyMobileRuntimeSettingsFn(fn: (previous: AppSettings, next: AppSettings) => void): void {
  _applyMobileRuntimeSettingsFn = fn
}

/** mobile server 透過這個呼叫 send message（在 registerIpcHandlers 之後才可用）*/
let _mobileSendImpl: ((payload: {
  content: string
  images?: string[]
  randomResult?: RandomResult
  randomResults?: RandomResult[]
  sourceDeviceName?: string
  newsLink?: NewsLinkInfo | null
  skipLlm?: boolean
}) => Promise<{ ok: boolean } | { error: string }>) | null = null

export function handleSendMessageFromMobile(payload: {
  content: string
  images?: string[]
  randomResult?: RandomResult
  randomResults?: RandomResult[]
  skipLlm?: boolean
  sourceDeviceName?: string
  newsLink?: NewsLinkInfo | null
}): Promise<{ ok: boolean } | { error: string }> {
  if (!_mobileSendImpl) return Promise.resolve({ error: 'IPC handlers not registered yet' })
  return _mobileSendImpl(payload)
}

/** 中止進行中的送出；回草稿給呼叫端還原輸入框。沒有進行中的請求就回 null。 */
export function stopSendDirect(): { content: string; images?: string[] } | null {
  if (!activeSendAbort) return null
  const draft = activeSendDraft
  activeSendAbort.abort()
  return draft ? { content: draft.content, images: draft.images } : { content: '' }
}

export function deleteMessageDirect(id: string): boolean {
  if (!activeConversationId) return false
  const conv = getOrLoadConversation(activeConversationId)
  if (!conv) return false
  const idx = conv.messages.findIndex(m => m.id === id)
  if (idx === -1) return false
  conv.messages.splice(idx, 1)
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)
  return true
}

export function editMessageDirect(id: string, content: string): boolean {
  if (!activeConversationId) return false
  const conv = getOrLoadConversation(activeConversationId)
  if (!conv) return false
  const msg = conv.messages.find(m => m.id === id)
  if (!msg) return false
  msg.content = content.trim()
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)
  return true
}

/** 覆寫訊息上的新聞 promptContext；可選同步釘住話題（供後續延續） */
export function updateNewsPromptContextDirect(payload?: {
  messageId?: string
  promptContext?: string
  syncTopic?: boolean
}): { ok: true } | { ok: false; error: string } {
  const pc = typeof payload?.promptContext === 'string' ? payload.promptContext.trim() : ''
  if (!payload?.messageId) return { ok: false, error: 'missing-id' }
  if (!activeConversationId) return { ok: false, error: 'no-conversation' }
  const conv = getOrLoadConversation(activeConversationId)
  if (!conv) return { ok: false, error: 'no-conversation' }
  const msg = conv.messages.find(m => m.id === payload.messageId)
  if (!msg?.newsLink) return { ok: false, error: 'no-news-link' }

  msg.newsLink = { ...msg.newsLink, promptContext: pc }
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)

  if (msg.newsLink.id) cacheManualPromptContext(msg.newsLink.id, pc)

  if (payload.syncTopic !== false) {
    const topic = getActiveNewsTopic()
    if (topic && (topic.id === msg.newsLink.id || topic.title === msg.newsLink.title)) {
      setActiveNewsTopic({ ...topic, promptContext: pc })
    }
  }
  return { ok: true }
}

export async function resendMessageDirect(id: string): Promise<{ ok: boolean } | { error: string }> {
  if (!_mobileSendImpl) return { error: 'IPC handlers not ready' }
  if (!activeConversationId) return { error: '找不到對話' }
  const conv = getOrLoadConversation(activeConversationId)
  if (!conv) return { error: '找不到對話' }
  const idx = conv.messages.findIndex(m => m.id === id)
  if (idx === -1) return { error: '找不到訊息' }
  const msg = conv.messages[idx]
  if (msg.role !== 'user') return { error: '只能重新發送使用者訊息' }
  const content = msg.content
  const randomResult = msg.randomResult
  // Truncate to before this message, then re-send
  conv.messages = conv.messages.slice(0, idx)
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)  // resets mobileLastConvMessageCount via hook
  return _mobileSendImpl({ content, randomResult })
}

// ── 角色卡寫入（B3 階段 3）────────────────────────────────
//
// 這一整段是 IPC handler 與 mobileServer **共用**的實作。
// 手機端要能編角色，就必須有同一套邏輯；各寫一份的結果是
// 「桌面存得起來、手機存出一張壞卡」而且沒有任何錯誤訊息（roadmap §4.1 的 drift）。
// 因此下面每一支都由 `registerIpcHandlers` 裡對應的 handler 直接呼叫，**不重複實作**。

/** 空白角色卡的欄位預設值。與 `CharacterLibraryWindow.handleNew` 同一份。 */
export function createCharacterDirect(name?: string): Character {
  const now = Date.now()
  const char: Character = {
    id: uuidv4(),
    name: name?.trim() || '新角色',
    nicknames: [],
    avatar: '',
    description: '',
    personality: '',
    firstMessage: '',
    exampleDialogue: '',
    emotions: {},
    scenario: '',
    systemPromptOverride: '',
    creatorNotes: '',
    createdAt: now,
    updatedAt: now
  }
  saveCharacterDirect(char)
  return char
}

export function saveCharacterDirect(char: Character): true {
  char.updatedAt = Date.now()
  const idx = characters.findIndex(c => c.id === char.id)
  if (idx >= 0) characters[idx] = char
  else characters.push(char)
  fileStore.saveCharacter(char)
  broadcastToAll('characters:updated', characters)
  return true
}

export function deleteCharacterDirect(id: string): { ok: true } | { error: 'last-character' | 'not-found' } {
  if (!characters.some(c => c.id === id)) return { error: 'not-found' }
  if (characters.length <= 1) return { error: 'last-character' }
  characters = characters.filter(c => c.id !== id)
  fileStore.deleteCharacter(id)
  // Remove from desktop if present
  settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== id)
  fileStore.saveSettings(settings)
  closeCharacterWindow(id)
  broadcastToAll('characters:updated', characters)
  broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
  return { ok: true }
}

export function saveCharacterAvatarDirect(payload: { id: string; buffer: ArrayBuffer; ext: string }): { path: string } | { error: string } {
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
    const idx = characters.findIndex(c => c.id === payload.id)
    if (idx >= 0) {
      characters[idx] = { ...characters[idx], avatar: dest, updatedAt: Date.now() }
      fileStore.saveCharacter(characters[idx])
      broadcastToAll('characters:updated', characters)
    }
    return { path: dest }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function importCharacterPngDirect(buffer: ArrayBuffer): Character | { error: string } {
  try {
    const buf = Buffer.from(buffer ?? new ArrayBuffer(0))
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
    char = attachCharacterBookOnImport(parsed, char)
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
}

export function importCharacterJsonDirect(payload: ImportJsonPayload): Character | { error: string } {
  try {
    const { json, sourcePath, replaceCharacterId } = normalizeImportJsonPayload(payload)
    const raw = JSON.parse(json)
    const existing = replaceCharacterId
      ? characters.find(c => c.id === replaceCharacterId)
      : undefined
    const id = existing?.id ?? uuidv4()
    let char = importStJson(raw, id)
    char = attachCharacterBookOnImport(raw, char)
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
}

export function exportCharacterJsonDirect(char: Character): { json: string } | { error: string } {
  try {
    return { json: exportToStJson(char) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export function exportCharacterPngDirect(char: Character): { buffer: ArrayBuffer } | { error: string } {
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
    return { buffer: toArrayBuffer(out) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function buildDstPackDirect(payload: { characterIds: string[]; includeGlobalSettings: boolean; includeLorebooks?: boolean }): Promise<{ buffer: ArrayBuffer } | { error: string }> {
  try {
    const ids = Array.isArray(payload?.characterIds) ? payload.characterIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
    if (ids.length === 0) return { error: '尚未選擇任何角色' }
    // 用語解說預設不外流（§7.3）；勾選時只帶這些角色與當前世界觀實際掛的那幾本
    const lorebooks: Lorebook[] = []
    if (payload?.includeLorebooks) {
      const wanted = new Set<string>()
      for (const id of ids) for (const bid of getCharacter(id)?.lorebookIds ?? []) wanted.add(bid)
      for (const bid of getActiveWorld()?.lorebookIds ?? []) wanted.add(bid)
      for (const bid of wanted) {
        const book = fileStore.loadLorebook(bid)
        if (book) lorebooks.push(book)
      }
    }
    const buf = await buildDstPackBuffer({
      lorebooks,
      charsRoot: path.join(fileStore.getDataDir(), 'characters'),
      characterIds: ids,
      includeGlobalSettings: !!payload?.includeGlobalSettings,
      settings,
      persona: getActivePersona(),
      world: getActiveWorld()
    })
    return { buffer: toArrayBuffer(buf) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Buffer → 該段位元組的 ArrayBuffer 複本（IPC 與 HTTP 都只能傳這個）。 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer
}

/** 用語解說清單（只有 id 與名字）。角色卡編輯器的綁定用。 */
export function listLorebooksDirect(): { id: string; name: string }[] {
  return fileStore.loadLorebooks().map(b => ({ id: b.id, name: b.name }))
}

/** 用語解說的輕量清單，多帶 `updatedAt`。給 `/api/sync-manifest`（S2 M2 差異預覽）用。 */
export function getLorebookManifestDirect(): { id: string; name: string; updatedAt: number }[] {
  return fileStore.loadLorebooks().map(b => ({ id: b.id, name: b.name, updatedAt: b.updatedAt }))
}

/** 匯入 DST Pack 遇到同 id ／同名角色時的處置。 */
export type DstPackConflictChoice = 'overwrite' | 'new' | 'skip'

/**
 * 匯入 DST Pack 時要問使用者的兩件事。
 *
 * **抽成回呼是為了讓手機端也能用同一份匯入邏輯**：桌面版彈 `dialog.showMessageBox`，
 * 手機端則由使用者在**送出前**就選好策略，一律套用（電腦前面沒有人，
 * 彈一個對話框在電腦上等著按等於讓手機那邊卡住直到有人回家）。
 */
export interface DstPackImportResolvers {
  onConflict: (info: { name: string; reason: 'same-id' | 'same-name' }) => Promise<DstPackConflictChoice>
  confirmGlobalSettings: () => Promise<boolean>
}

export async function importDstPackDirect(
  buffer: ArrayBuffer,
  resolvers: DstPackImportResolvers
): Promise<{ ok: true; imported: number; skipped: number } | { error: string }> {
  try {
    const buf = Buffer.from(buffer ?? new ArrayBuffer(0))
    if (buf.length < 32) return { error: '檔案過小或已損毀' }
    const { parsed, zip } = await loadDstPackZip(buf)
    // 用語解說：本機已有同 id 就視為同一本、不覆蓋使用者手邊的版本
    for (const book of parsed.lorebooks) {
      if (book?.id && !fileStore.loadLorebook(book.id)) fileStore.saveLorebook(book)
    }
    if (parsed.lorebooks.length > 0) broadcastToAll('lorebooks:updated', null)
    const charsRoot = path.join(fileStore.getDataDir(), 'characters')
    let imported = 0
    let skipped = 0

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
        const choice = await resolvers.onConflict({ name: charPreview.name, reason: 'same-id' })
        if (choice === 'skip') {
          skipped++
          continue
        }
        if (choice === 'new') {
          targetDirId = uuidv4()
        } else {
          targetDirId = charPreview.id
          fs.rmSync(path.join(charsRoot, targetDirId), { recursive: true, force: true })
        }
      } else if (nameHit && nameHit.id !== charPreview.id) {
        const choice = await resolvers.onConflict({ name: charPreview.name, reason: 'same-name' })
        if (choice === 'skip') {
          skipped++
          continue
        }
        if (choice === 'new') {
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
      if (await resolvers.confirmGlobalSettings()) {
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
}

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
  setLowPerformanceMode(settings.ui.lowPerformanceMode ?? false, settings.ui.lowPerformanceLogMessageLimit ?? 50)
  setEventDrivenHitTest(settings.ui.eventDrivenHitTest ?? false)
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

/**
 * 標題主觀／情緒評分是額外一次 LLM 往返請求（debug 用，見 docs/news-future-sensational-score.md）。
 * 絕不能擋在角色回覆之前——背景執行，完成後才補回該則訊息的 newsDebug 欄位並重新存檔/廣播。
 */
function attachNewsSubjectivityInBackground(
  conv: Conversation,
  msgId: string,
  item: { title: string; summary?: string }
): void {
  classifyNewsSubjectivityWithLLM({ settings, title: item.title, summary: item.summary })
    .then(subjectivity => {
      if (!subjectivity) return
      const msg = conv.messages.find(m => m.id === msgId)
      if (!msg?.newsDebug?.item) return
      msg.newsDebug.item.subjectivityScore = subjectivity.score
      msg.newsDebug.item.subjectivityReason = subjectivity.reason
      fileStore.saveConversation(conv)
      scheduleConversationBroadcast(conv)
      flushConversationBroadcast()
    })
    .catch(() => {})
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
      const candidateIds = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)
      if (candidateIds.length === 0) return
      const candidateChars = candidateIds.map(id => getCharacter(id)).filter((c): c is Character => c != null)
      const ns = loadNewsModuleSettings()
      charId = reminder.injectNews && isModuleEffectivelyEnabled(NEWS_MODULE_ID, ns.enabled) && candidateChars.length > 1
        ? (await pickNewsAwareCharacter(candidateChars, ns)).id
        : candidateIds[Math.floor(Math.random() * candidateIds.length)]
    }
  }

  if (!charId) {
    const candidateIds = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)
    if (candidateIds.length === 0) return
    const candidateChars = candidateIds.map(id => getCharacter(id)).filter((c): c is Character => c != null)
    const ns = loadNewsModuleSettings()
    charId = reminder.injectNews && isModuleEffectivelyEnabled(NEWS_MODULE_ID, ns.enabled) && candidateChars.length > 1
      ? (await pickNewsAwareCharacter(candidateChars, ns)).id
      : candidateIds[Math.floor(Math.random() * candidateIds.length)]
  }

  const char = getCharacter(charId)
  const conv = getActiveConversation()
  if (!char || !conv) return

  const activePersona = getActivePersona()
  const activeWorld = getActiveWorld()

  const ctxParts: string[] = []
  let reminderNewsMeta: BubbleNewsMeta | null = null
  let reminderNewsDebugData: NewsDebugInfo | null = null
  let reminderNewsSubjectItem: { title: string; summary?: string } | null = null

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
  // 候選素材：便利貼 + 新聞（提醒內容＝優先素材，其餘只是順帶）
  const reminderNoteBlock = reminder.injectPinnedNotes ? buildVisiblePinnedNotesContext() : null
  if (reminderNoteBlock) ctxParts.push(reminderNoteBlock.text)

  if (reminder.injectWeather) {
    const weatherStr = await getWeatherContextString(applySceneModuleOverrides(settings))
    if (weatherStr) ctxParts.push(weatherStr)
  }

  if (reminder.injectCalendar) {
    const calendarStr = await getCalendarContextString(applySceneModuleOverrides(settings))
    if (calendarStr) ctxParts.push(calendarStr)
  }

  let reminderNewsTitle: string | undefined
  let reminderNewsDirective: string | undefined
  if (reminder.injectNews) {
    try {
      const reminderNewsCtx = resolveNewsSelectionContext(char)
      const inj = await getNewsInjectionForSpeak({
        force: true,
        ctx: reminderNewsCtx,
        enabledOverride: isModuleEffectivelyEnabled(NEWS_MODULE_ID, loadNewsModuleSettings().enabled),
        appSettings: settings
      })
      if (inj) {
        ctxParts.push(inj.text)
        if (!inj.fromTopic && inj.item) {
          const it = inj.item
          reminderNewsTitle = it.title
          reminderNewsDirective = inj.directive
          reminderNewsMeta = {
            id: it.id, sourceId: it.sourceId, title: it.title,
            url: it.url, summary: it.summary, source: it.source, keyword: it.keyword,
            promptContext: it.promptContext
          }
          reminderNewsSubjectItem = { title: it.title, summary: it.summary }
        } else if (inj.fromTopic) {
          reminderNewsTitle = undefined
          // 話題泡泡模式：釘住話題本身也有原文連結，同樣顯示在泡泡上
          const topic = getActiveNewsTopic()
          if (topic?.url) {
            reminderNewsMeta = {
              id: topic.id,
              sourceId: '',
              title: topic.title,
              url: topic.url,
              summary: topic.summary,
              source: topic.source,
              promptContext: topic.promptContext
            }
          }
        }
      }
      // 提醒路線的新聞 debug
      const newsSettings = loadNewsModuleSettings()
      if (isModuleEffectivelyEnabled(NEWS_MODULE_ID, newsSettings.enabled)) {
        const terms = collectInterestTerms(newsSettings, reminderNewsCtx)
        const groupName = reminderNewsCtx.sceneGroupId
          ? (newsSettings.keywordGroups.find(g => g.id === reminderNewsCtx.sceneGroupId)?.name ?? reminderNewsCtx.sceneGroupId)
          : '預設組'
        const mode: NewsDebugInfo['mode'] = inj?.fromTopic ? 'topic' : inj?.item ? 'news' : 'none'
        reminderNewsDebugData = {
          groupName,
          characterKeywords: reminderNewsCtx.characterKeywords ?? [],
          interestTerms: terms,
          item: inj?.item ? {
            title: inj.item.title,
            source: inj.item.source,
            keyword: inj.item.keyword,
            url: inj.item.url,
            summary: inj.item.summary
          } : null,
          fromTopic: mode === 'topic',
          mode
        }
      }
    } catch (e) {
      console.warn('[news] reminder inject failed:', (e as Error).message)
    }
  }

  const reminderMessages = reminder.injectConversationContext
    ? contextMessages(conv.messages, settings.memory.keepRecentN)
    : []
  if (reminder.injectConversationContext && reminderMessages.length > 0) {
    ctxParts.push('[近期對話紀錄]\n以下僅供參考語境；不要長篇接續聊天。')
  }

  // 發話重點：有提醒內容＝優先；沒有＝從候選素材挑一個聊（design：優先/候選）
  if (reminder.prompt?.trim()) {
    ctxParts.push('[發話重點]\n這次主要是要把上面的「提醒指令」用你自己的個性講出來；天氣／便利貼／新聞如果有，只是順帶提及、別喧賓奪主。換個新鮮的開場，別跟你最近說過的雷同。')
  } else {
    const hasNotes = !!reminderNoteBlock?.titles?.length
    if (reminderNewsDirective && !hasNotes) {
      // 只有新聞、沒有便利貼候選：直接用新聞專屬指令（和「說點什麼」路徑一致，角色確定聊這則）
      ctxParts.push(`[發話重點]\n${reminderNewsDirective}`)
    } else {
      const candidates = [
        ...(reminderNewsTitle ? [`新聞：「${reminderNewsTitle}」`] : []),
        ...((reminderNoteBlock?.titles ?? []).map(t => `便利貼：「${t}」`))
      ]
      if (candidates.length > 0) {
        ctxParts.push(`[發話重點]\n沒有特定提醒。從這些你注意到的事裡挑「一個」現在最想聊的開個話題（${candidates.join('、')}），完全用你的個性，不必每個都提到。`)
      }
    }
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

  setThinking(charId, true)
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
    // 提醒發話走主要模型（角色口吻優先）；情緒分類才走輔助模型
    // 若使用者未啟用分流，applyUtilitySettings 回傳原始 settings，行為不變
    // 情境模組覆蓋（系統時間等）在此生效
    const reminderChatSettings = applySceneModuleOverrides(settings)

    if (hasApiKey) {
      // 有 API Key：調用 LLM 生成角色化回應
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
        memorySummary: reminder.injectConversationContext ? conv.summary : undefined,
        loreBlock: buildLoreBlockFor(char, activeWorld, {
          summary: reminder.injectConversationContext ? conv.summary : undefined,
          recentMessages: reminderMessages
        }),
        isReminder: true,
        splitEmotion: doSplitEmotionReminder
      })
      cleanReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, char),
        char.id,
        characters
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
      hasDebugPrompt: !!((hasApiKey && debugPrompt) || reminderUtilityDebugPrompt),
      newsDebug: reminderNewsDebugData ?? undefined,
      hasNewsDebug: !!reminderNewsDebugData,
      newsLink: reminderNewsMeta ?? undefined,
      timestamp: Date.now()
    }
    conv.messages.push(msg)
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    scheduleConversationBroadcast(conv)
    flushConversationBroadcast()
    if (reminderNewsSubjectItem) attachNewsSubjectivityInBackground(conv, msg.id, reminderNewsSubjectItem)

    // 播放提醒音效（發給說話的角色的窗口，一個角色只響一次）
    if (settings.ui.reminderNotificationSound?.enabled !== false) {
      const volume = settings.ui.reminderNotificationSound?.volume ?? 0.7
      const charWin = getCharacterWindow(charId)
      if (charWin && !charWin.isDestroyed()) {
        charWin.webContents.send('audio:play-notification', { volume })
      }
    }

    setImmediate(() => {
      showSpeechBubble(charId, char.name, cleanReply, msg.emotion, bubbleAnchorForCharacter(charId), reminderNewsMeta, { messageId: msg.id })
      sendCharacterContextUpdate(charId, { lastMessage: { id: msg.id, emotion: msg.emotion } })
    })
  } catch (e) {
    console.error('[reminder] triggerReminderSpeak failed:', e)
  } finally {
    setThinking(charId, false)
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

  // Apply persona / world / theme（設定層那段與手機獨立版共用 `core/scene/apply`）
  const sceneTarget = {
    activePersonaId: settings.activePersonaId,
    activeWorldId: settings.activeWorldId,
    activeSceneId: settings.activeSceneId,
    colorTheme: settings.ui.colorTheme,
    lastActiveConversationId: settings.ui.lastActiveConversationId
  }
  applySceneSettings(scene, sceneTarget)
  settings.activePersonaId = sceneTarget.activePersonaId
  settings.activeWorldId = sceneTarget.activeWorldId
  settings.activeSceneId = sceneTarget.activeSceneId
  settings.ui.colorTheme = sceneTarget.colorTheme
  settings.ui.lastActiveConversationId = sceneTarget.lastActiveConversationId

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


/** 收集桌面可見便利貼，組成上下文區塊 + 標題清單（說點什麼 / 提醒共用） */
function buildVisiblePinnedNotesContext(): { text: string; titles: string[] } | null {
  const visible = (settings.ui.pinnedNotes ?? []).filter(n => n.visible)
  if (visible.length === 0) return null
  const titles: string[] = []
  const lines = visible.map(n => {
    const title = n.title?.trim() || '便利貼'
    titles.push(title)
    const body = n.content?.trim()
    return body ? `- 《${title}》${body}` : `- 《${title}》（空白）`
  })
  return { text: `[桌面便利貼]\n${lines.join('\n')}`, titles }
}

// ── 情境模組開關覆蓋 ────────────────────────────────────────
// 天氣 / Spotify / 系統時間沒掛在 module host 下，用固定虛擬 id 一起納入情境覆蓋管理。
export const WEATHER_MODULE_ID = 'desktopst.weather'
export const SPOTIFY_MODULE_ID = 'desktopst.spotify'
export const SYSTEM_TIME_MODULE_ID = 'desktopst.systemTime'
export const CALENDAR_MODULE_ID = 'desktopst.calendar'

/** 讀取目前情境對某模組的開關覆蓋；無情境或未設定時回傳 undefined（跟隨全域）。 */
function getActiveSceneModuleOverride(moduleId: string): 'on' | 'off' | undefined {
  if (!settings.activeSceneId) return undefined
  const scene = fileStore.loadScenePreset(settings.activeSceneId)
  return scene?.moduleOverrides?.[moduleId]
}

/** 情境覆蓋優先的有效開關：'on' / 'off' 直接生效，未覆蓋時用全域開關。 */
export function isModuleEffectivelyEnabled(moduleId: string, globalEnabled: boolean): boolean {
  const ov = getActiveSceneModuleOverride(moduleId)
  if (ov === 'on') return true
  if (ov === 'off') return false
  return globalEnabled
}

/**
 * 依目前情境覆蓋回傳天氣 / Spotify / 系統時間 / 日曆開關已調整的 settings 副本（無覆蓋時原樣回傳）。
 * getWeatherContextString / getSpotifyContextString / getCalendarContextString / chatWithLLM（injectSystemTime）
 * 內部會檢查各自的 enabled 旗標，所以「強制開／強制關」要在傳入前改寫。
 *
 * ⚠️ 用語解說（`desktopst.lorebook`）**不在這裡**：它在 settings 裡沒有對應的 enabled 旗標
 * （資料為空時本來就不影響 prompt），所以直接在 `buildLoreBlockFor()` 裡問
 * `isModuleEffectivelyEnabled()` 即可，不需要改寫 settings 副本。
 */
function applySceneModuleOverrides(s: AppSettings): AppSettings {
  const wOv = getActiveSceneModuleOverride(WEATHER_MODULE_ID)
  const sOv = getActiveSceneModuleOverride(SPOTIFY_MODULE_ID)
  const tOv = getActiveSceneModuleOverride(SYSTEM_TIME_MODULE_ID)
  const cOv = getActiveSceneModuleOverride(CALENDAR_MODULE_ID)
  if (!wOv && !sOv && !tOv && !cOv) return s
  const out = { ...s }
  if (wOv && out.weather) out.weather = { ...out.weather, enabled: wOv === 'on' }
  if (sOv && out.spotify) out.spotify = { ...out.spotify, enabled: sOv === 'on' }
  if (tOv) out.injectSystemTime = tOv === 'on'
  if (cOv && out.calendar) out.calendar = { ...out.calendar, enabled: cOv === 'on' }
  return out
}

// ── 用語解說（Lorebook）注入 ────────────────────────────
// 規格 docs/future-lorebook.md。零設定時完全不影響 prompt（§6.1）。

/**
 * 組出這一輪的 `[Glossary]` 注入區塊；沒有命中任何條目時回傳 undefined（連空標籤都不出現）。
 *
 * ⚠️ `recentContents` 必須是 `contextMessages()` 的結果（規格 §6.2），
 * 否則已被摘要吃掉的舊訊息還會觸發 lore ——
 * 角色手上沒有那段對話，卻收到對應的術語解說。
 */
function buildLoreBlockFor(
  char: Character | null | undefined,
  world: WorldPreset | null | undefined,
  scan: { summary?: string; recentMessages?: Message[]; currentInput?: string }
): string | undefined {
  // 情境總開關（無全域開關；資料為空時本來就不影響 prompt，故全域預設視為開啟）
  if (!isModuleEffectivelyEnabled(LORE_MODULE_ID, true)) return undefined

  const activeScene = settings.activeSceneId ? fileStore.loadScenePreset(settings.activeSceneId) : null
  const ids = resolveLorebookIds({
    characterIds: char?.lorebookIds,
    worldIds: world?.lorebookIds,
    sceneIds: activeScene?.lorebookIds
  })
  if (ids.length === 0) return undefined

  // 載入失敗的那本直接不放進 map → orderLorebooks 會跳過（§6.6 靜默略過）
  const loaded = new Map<string, Lorebook>()
  for (const id of ids) {
    const book = fileStore.loadLorebook(id)
    if (book) loaded.set(id, book)
  }
  const books = orderLorebooks(ids, loaded)
  if (books.length === 0) return undefined

  const scanText = buildScanText({
    summary: scan.summary,
    recentContents: (scan.recentMessages ?? []).map(m => m.content ?? ''),
    currentInput: scan.currentInput
  }, resolveScanDepth(books))

  const block = formatLoreBlock(selectLoreEntries(books, scanText))
  return block || undefined
}

/** core 的 LoreError 代碼 → 中文文案（UI 文案不得進 core）。 */
function loreErrorMessage(e: unknown): string {
  if (e instanceof LoreError) {
    return e.code === 'not-a-lorebook'
      ? '這個檔案不是用語解說（找不到 entries 清單）'
      : e.message
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * ST 角色卡匯入時把 `character_book` 撈出來另存一本，並掛到該角色（規格 §4.2）。
 *
 * 卡片沒帶 `character_book` 或內容壞掉時原樣回傳角色，**不擋匯入流程**。
 */
function attachCharacterBookOnImport(rawCard: unknown, char: Character): Character {
  try {
    const source = extractCharacterBook(rawCard)
    if (!source) return char
    const book = importStLorebook(source, {
      id: uuidv4(),
      fallbackName: char.name,
      makeEntryId: () => uuidv4()
    })
    if (book.entries.length === 0) return char
    fileStore.saveLorebook(book)
    broadcastToAll('lorebooks:updated', null)
    return { ...char, lorebookIds: [...(char.lorebookIds ?? []), book.id] }
  } catch (e) {
    console.warn('[lore] character_book import failed:', (e as Error).message)
    return char
  }
}

/**
 * 從角色卡生成一條用語解說；失敗一律回 null（不擋匯入流程，規格 §8.2）。
 */
async function generateLoreEntryForCharacterSafe(char: Character) {
  try {
    return await generateLoreEntryForCharacter({
      settings,
      character: {
        name: char.name,
        nicknames: char.nicknames,
        description: char.description,
        personality: char.personality,
        scenario: char.scenario
      }
    })
  } catch (e) {
    console.warn('[lore] generate entry failed:', (e as Error).message)
    return null
  }
}

/** 解析當前發話角色的新聞抽選脈絡：情境組（取代式）＋角色卡關鍵字（疊加）。 */
function resolveNewsSelectionContext(char: Character | null | undefined): NewsSelectionContext {
  const activeScene = settings.activeSceneId ? fileStore.loadScenePreset(settings.activeSceneId) : null
  return {
    sceneGroupId: activeScene?.newsKeywordGroupId,
    characterKeywords: char?.newsKeywords
  }
}

/**
 * 從候選角色中，依新聞池關鍵字匹配度加權抽選一位。
 * 有 newsKeywords 且與當前可用新聞有交叉的角色，抽中機率是無關鍵字角色的數倍。
 * 若新聞池為空或抓取失敗，退回純隨機。
 */
async function pickNewsAwareCharacter(
  candidates: Character[],
  newsSettings: NewsModuleSettings
): Promise<Character> {
  if (candidates.length === 1) return candidates[0]
  const withKeywords = candidates.filter(c => c.newsKeywords?.length)
  if (withKeywords.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
  let pool: import('./modules/news/types').NewsItem[] = []
  try {
    pool = await fetchAllSources(newsSettings, { useCache: true }, {})
  } catch { /* fallback to pure random */ }
  if (pool.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
  const weights = candidates.map(char => {
    const kws = (char.newsKeywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean)
    if (kws.length === 0) return 1
    let matched = 0
    for (const item of pool) {
      const text = [item.title, item.summary ?? '', ...(item.tags ?? []), item.keyword ?? ''].join(' ').toLowerCase()
      if (kws.some(k => text.includes(k))) matched++
    }
    // 每多一則匹配新聞，權重多 +1（最少為 2，無匹配仍為 1）
    return matched > 0 ? 1 + matched : 1
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r < 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

export async function forceSpeakDirect(
  characterId: string,
  extra?: { extraSystemContext?: string; triggerDirective?: string }
): Promise<{ ok: true } | { error: string }> {
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
      showSpeechBubble(characterId, char.name, noKeyText, undefined, bubbleAnchorForCharacter(characterId), null, { messageId: msg.id })
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    // 先亮思考氣泡再做網路抓取（天氣 / Spotify / 新聞），避免使用者看到約 1 秒的無回饋停頓。
    setThinking(characterId, true)
    // 手機遠端按「說點什麼」時，回饋只能靠這個推播（桌面泡泡在手機上看不到）
    deferRaiseCharacterAbovePinnedNotes(characterId)

    const ctxParts: string[] = []
    if (conv.messages.length === 0 && char.firstMessage?.trim()) {
      ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
    }
    if (extra?.extraSystemContext) {
      ctxParts.push(extra.extraSystemContext)
    }
    const moduleCtx = await collectModuleContext(id => isModuleEffectivelyEnabled(id, true))
    for (const s of moduleCtx) ctxParts.push(s)
    const effSettings = applySceneModuleOverrides(settings)
    if (effSettings.weather?.enabled) {
      const weatherStr = await getWeatherContextString(effSettings)
      if (weatherStr) ctxParts.push(weatherStr)
    }
    if (effSettings.spotify?.enabled) {
      const spotifyStr = await getSpotifyContextString(effSettings)
      if (spotifyStr) ctxParts.push(spotifyStr)
    }
    if (effSettings.calendar?.enabled) {
      const calendarStr = await getCalendarContextString(effSettings)
      if (calendarStr) ctxParts.push(calendarStr)
    }
    // 候選素材：主題泡泡（優先素材，主導）／新聞 ＋ 便利貼（候選，讓角色挑一個）／天氣 Spotify（背景）。
    let newsUsedUtilityModel = false
    let newsDirective: string | undefined = extra?.triggerDirective
    let newsBubbleMeta: BubbleNewsMeta | null = null
    let newsDebugData: NewsDebugInfo | null = null
    let newsSubjectItem: { title: string; summary?: string } | null = null
    const newsEffEnabled = isModuleEffectivelyEnabled(NEWS_MODULE_ID, loadNewsModuleSettings().enabled)
    try {
      const newsCtx = resolveNewsSelectionContext(char)
      const newsInjection = await getNewsInjectionForSpeak({
        ctx: newsCtx,
        enabledOverride: newsEffEnabled,
        appSettings: settings
      })
      const noteBlock = settings.ui.speakUsePinnedNotes ? buildVisiblePinnedNotesContext() : null

      // 先算發話模式（供 debug 用，邏輯和下方 branch 一致）
      const newsMode: NewsDebugInfo['mode'] =
        newsInjection?.fromTopic ? 'topic'
        : newsInjection && noteBlock ? 'survey'
        : newsInjection ? 'news'
        : noteBlock ? 'notes'
        : 'none'

      if (newsInjection?.fromTopic) {
        // 主題泡泡＝優先素材，主導；便利貼只當背景帶過
        ctxParts.push(newsInjection.text)
        newsDirective = newsInjection.directive
        newsUsedUtilityModel = true
        setPendingNewsCredit(null)
        if (noteBlock) ctxParts.push(noteBlock.text)
      } else {
        const it = newsInjection?.item ?? null
        if (noteBlock) ctxParts.push(noteBlock.text)

        // 指令：新聞＋便利貼→讓角色挑一個；只有新聞→新聞指令；只有便利貼→便利貼指令
        if (newsInjection && noteBlock) {
          // Survey 模式：角色自選，不知道他選了哪個。
          // → 新聞素材放 system context，泡泡顯示「↗新聞」連結（讓使用者可點開查看），
          //   但不設 pendingCredit（無法確認角色是否聊了那則）。
          ctxParts.push(newsInjection.text)
          newsUsedUtilityModel = true
          newsDirective = buildSurveyDirective({ newsTitle: it?.title, noteTitles: noteBlock.titles })
          if (it) {
            newsBubbleMeta = {
              id: it.id, sourceId: it.sourceId, title: it.title,
              url: it.url, summary: it.summary, source: it.source, keyword: it.keyword,
              promptContext: it.promptContext
            }
          }
          setPendingNewsCredit(null)
        } else if (newsInjection) {
          // 只有新聞：確定角色在聊它，貼按鈕、設信用。
          ctxParts.push(newsInjection.text)
          newsUsedUtilityModel = true
          newsDirective = newsInjection.directive
          if (it) {
            newsBubbleMeta = {
              id: it.id, sourceId: it.sourceId, title: it.title,
              url: it.url, summary: it.summary, source: it.source, keyword: it.keyword,
              promptContext: it.promptContext
            }
            setPendingNewsCredit(it.sourceId)
          } else {
            setPendingNewsCredit(null)
          }
        } else if (noteBlock) {
          // 只有便利貼：無新聞按鈕。
          newsDirective = buildNotesDirective(noteBlock.titles)
          setPendingNewsCredit(null)
        } else {
          setPendingNewsCredit(null)
        }
      }

      // ── 新聞 debug 資訊（只在模組有效啟用時收集）──
      const newsSettings = loadNewsModuleSettings()
      if (newsEffEnabled) {
        const terms = collectInterestTerms(newsSettings, newsCtx)
        const groupName = newsCtx.sceneGroupId
          ? (newsSettings.keywordGroups.find(g => g.id === newsCtx.sceneGroupId)?.name ?? newsCtx.sceneGroupId)
          : '預設組'
        if (newsInjection?.item && !newsInjection.fromTopic) {
          newsSubjectItem = { title: newsInjection.item.title, summary: newsInjection.item.summary }
        }
        newsDebugData = {
          groupName,
          characterKeywords: newsCtx.characterKeywords ?? [],
          interestTerms: terms,
          item: newsInjection?.item ? {
            title: newsInjection.item.title,
            source: newsInjection.item.source,
            keyword: newsInjection.item.keyword,
            url: newsInjection.item.url,
            summary: newsInjection.item.summary
          } : null,
          fromTopic: newsMode === 'topic',
          mode: newsMode
        }
      }
    } catch (e) {
      console.warn('[news] inject failed:', (e as Error).message)
    }
    const extraSystemContext = ctxParts.join('\n\n') || undefined
    // 新聞陪聊走哪個模型由新聞設定 replyModel 決定（預設 main＝主要模型，口吻優先）。
    // 只有使用者選擇 'utility' 時才套用 applyUtilitySettings（未啟用分流時它原樣回傳主模型）。
    const useUtilityForNews = newsUsedUtilityModel && loadNewsModuleSettings().replyModel === 'utility'
    // 以 effSettings 為底，讓情境模組覆蓋（系統時間等）帶進 chatWithLLM
    const chatSettings = useUtilityForNews ? applyUtilitySettings(effSettings) : effSettings

    try {
      let recentMessages = contextMessages(conv.messages, settings.memory.keepRecentN)
      const desktopCharNamesForce = settings.ui.desktopCharacters.map(d => getCharacter(d.characterId)?.name ?? '').filter(Boolean)
      const forceHasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
      const doSplitEmotionForce = !!(settings.llm.utilityEnabled && forceHasCustomSprites)
      const { content, emotion: rawEmotionForce, debugPrompt, inputTokens: forceInputTk, outputTokens: forceOutputTk } = await chatWithLLM({
        settings: chatSettings,
        character: char,
        messages: recentMessages,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames: desktopCharNamesForce,
        extraSystemContext,
        memorySummary: conv.summary,
        loreBlock: buildLoreBlockFor(char, activeWorld, {
          summary: conv.summary,
          recentMessages
        }),
        triggerDirective: newsDirective,
        splitEmotion: doSplitEmotionForce
      })
      const forcedReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, char),
        char.id,
        characters
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
        hasDebugPrompt: !!(debugPrompt || forceUtilityDebugPrompt),
        newsDebug: newsDebugData ?? undefined,
        hasNewsDebug: !!newsDebugData,
        newsLink: newsBubbleMeta ?? undefined,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      fileStore.saveConversation(conv)
      scheduleConversationBroadcast(conv)
      flushConversationBroadcast()
      if (newsSubjectItem) attachNewsSubjectivityInBackground(conv, msg.id, newsSubjectItem)
      setImmediate(() => {
        showSpeechBubble(characterId, char.name, forcedReply, msg.emotion, bubbleAnchorForCharacter(characterId), newsBubbleMeta, { messageId: msg.id })
        sendCharacterContextUpdate(characterId, { lastMessage: { id: msg.id, emotion: msg.emotion } })
      })
      maybeAutoSummarize(conv)
      return { ok: true }
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) }
    } finally {
      setThinking(characterId, false)
    }
}

export function toggleMuteDirect(characterId: string): boolean {
  const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
  if (!d) return false
  d.muted = !d.muted
  fileStore.saveSettings(settings)
  broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
  return d.muted
}
/** 組 prompt 用的近期上下文：先濾掉「排除於記憶外」的訊息、再取最後 keepRecentN 則（排除的不佔名額） */
function contextMessages(messages: Message[], keepRecentN: number): Message[] {
  return messages.filter(m => !m.excludeFromContext).slice(-Math.max(1, keepRecentN))
}

/** 摘要進行中的對話 id（防止重複觸發） */
const summarizingConvIds = new Set<string>()

/**
 * 執行一次記憶摘要並寫回對話（自動與手動共用）。
 * 成功時更新 conv.summary / summaryCoversTs、存檔並廣播；沒有可摘要訊息時回傳 noNew。
 */
async function runConversationSummarize(conv: Conversation): Promise<{ ok: boolean; noNew?: boolean; error?: string }> {
  if (summarizingConvIds.has(conv.id)) return { ok: false, error: '摘要進行中' }
  if (listSummarizableMessages(conv, settings.memory.keepRecentN).length === 0) return { ok: true, noNew: true }
  summarizingConvIds.add(conv.id)
  try {
    const result = await summarizeConversation({
      settings,
      conv,
      persona: getActivePersona(),
      speakerNameById: getSpeakerNameById()
    })
    if (!result) return { ok: true, noNew: true }
    conv.summary = result.summary
    conv.summaryCoversTs = result.coversTs
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    summarizingConvIds.delete(conv.id)
  }
}

/** 自動摘要：未涵蓋訊息達閾值時在背景執行（fire-and-forget，失敗只留 console 警告） */
function maybeAutoSummarize(conv: Conversation): void {
  if (!settings.memory.autoSummarizeEnabled) return
  if (!settings.llm.apiKeys[settings.llm.provider]?.trim()) return
  const threshold = Math.max(1, Number(settings.memory.autoSummarizeAfter) || 50)
  if (countUncoveredMessages(conv) < threshold) return
  void runConversationSummarize(conv).then(r => {
    if (!r.ok && r.error !== '摘要進行中') console.warn('[summary] auto summarize failed:', r.error)
  })
}

/** 手機（獨立／遙控）用：依 id 操作任一對話的記憶摘要，不限「目前使用中」那個。 */
export function getConversationMemoryDirect(id: string): { ok: true; summary: string; coversTs: number; coveredCount: number } | { ok: false; error: string } {
  const conv = getOrLoadConversation(id)
  if (!conv) return { ok: false, error: '找不到這個對話' }
  const coversTs = conv.summaryCoversTs ?? 0
  return {
    ok: true,
    summary: conv.summary ?? '',
    coversTs,
    coveredCount: coversTs ? conv.messages.filter(m => m.timestamp <= coversTs).length : 0
  }
}

export async function summarizeConversationNowDirect(id: string): Promise<{ ok: boolean; noNew?: boolean; error?: string; summary?: string; coveredCount?: number }> {
  const conv = getOrLoadConversation(id)
  if (!conv) return { ok: false, error: '找不到這個對話' }
  if (!settings.llm.apiKeys[settings.llm.provider]?.trim()) return { ok: false, error: '尚未設定 API Key' }
  const r = await runConversationSummarize(conv)
  if (!r.ok || r.noNew) return r
  const coversTs = conv.summaryCoversTs ?? 0
  return { ok: true, summary: conv.summary, coveredCount: coversTs ? conv.messages.filter(m => m.timestamp <= coversTs).length : 0 }
}

export function updateConversationSummaryDirect(id: string, summary: string): { ok: true } | { ok: false; error: string } {
  const conv = getOrLoadConversation(id)
  if (!conv) return { ok: false, error: '找不到這個對話' }
  conv.summary = String(summary ?? '').trim()
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)
  return { ok: true }
}

export function clearConversationSummaryDirect(id: string): { ok: true } | { ok: false; error: string } {
  const conv = getOrLoadConversation(id)
  if (!conv) return { ok: false, error: '找不到這個對話' }
  conv.summary = ''
  conv.summaryCoversTs = undefined
  conv.updatedAt = Date.now()
  fileStore.saveConversation(conv)
  broadcastConversationUpdate(conv)
  return { ok: true }
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
      utilityDebugPrompt: msg.utilityDebugPrompt ?? null,
      newsDebug: msg.newsDebug ?? null,
      convSearchDebugPrompt: msg.convSearchDebugPrompt ?? null
    }
  })

  ipcMain.handle('log:get-message-images', (_, messageId: string) => {
    const conv = getActiveConversation()
    if (!conv || !messageId) return []
    const msg = conv.messages.find(m => m.id === messageId)
    return Array.isArray(msg?.images) ? msg.images : []
  })

  // Settings
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:save', (_, s: AppSettings) => {
    s.ui.unfocusedBubbleOpacity = normalizeUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setUnfocusedBubbleOpacity(s.ui.unfocusedBubbleOpacity)
    setCharactersAlwaysOnTop(s.ui.alwaysOnTop ?? true)
    setLowPerformanceMode(s.ui.lowPerformanceMode ?? false, s.ui.lowPerformanceLogMessageLimit ?? 50)
    setEventDrivenHitTest(s.ui.eventDrivenHitTest ?? false)
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
    // Protect CWA API Key (same fallback pattern as LLM keys)
    let protectedWeather = s.weather
    if (protectedWeather?.realtimeQuery !== undefined) {
      const fallbackCwa = fileStore.encryptedApiKeyFallbacks.get('cwaApiKey')
      if (fallbackCwa && !protectedWeather.realtimeQuery.cwaApiKey) {
        protectedWeather = {
          ...protectedWeather,
          realtimeQuery: { ...protectedWeather.realtimeQuery, cwaApiKey: fallbackCwa }
        }
      } else if (protectedWeather.realtimeQuery.cwaApiKey) {
        fileStore.encryptedApiKeyFallbacks.delete('cwaApiKey')
      }
    }
    const previousSettings = settings
    const prevLocationName = settings.weather?.locationName
    settings = { ...s, llm: { ...s.llm, apiKeys: protectedApiKeys }, weather: protectedWeather, ui }
    if (settings.weather?.locationName !== prevLocationName) invalidateWeatherCache()
    fileStore.saveSettings(settings)
    _applyMobileRuntimeSettingsFn?.(previousSettings, settings)
    broadcastToAll('settings:updated', settings)
    pushRemoteControlState()
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('app:relaunch', () => {
    if (!app.isPackaged) {
      return { ok: false, error: 'Dev mode does not support in-app relaunch. Restart npm run dev from the terminal instead.' }
    }
    app.relaunch()
    app.exit(0)
    return { ok: true }
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

  ipcMain.handle('weather:test-cwa-key', async (_, apiKey: string) => {
    return testCwaApiKey(apiKey)
  })

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

  // Google Calendar
  ipcMain.handle('calendar:open-settings', () => {
    openCalendarSettingsWindow()
  })

  ipcMain.handle('calendar:close-settings', () => {
    cancelGoogleAuth()
    closeCalendarSettingsWindow()
  })

  ipcMain.handle('calendar:start-auth', async (_, payload: { clientId: string; clientSecret?: string }) => {
    const clientId = (payload?.clientId ?? '').trim()
    const clientSecret = (payload?.clientSecret ?? '').trim()
    if (!clientId) return { ok: false, error: '請輸入 Client ID' }

    settings.calendar = {
      ...DEFAULT_CALENDAR_SETTINGS,
      ...(settings.calendar ?? {}),
      clientId,
      // 密鑰以 safeStorage 加密後才落地，比照 API Key / CWA Key
      clientSecret: clientSecret ? encrypt(clientSecret) : settings.calendar?.clientSecret
    }
    fileStore.saveSettings(settings)

    // 授權在背景等回呼，這裡先回 ok 讓 UI 進入「等待授權」狀態
    beginGoogleAuth(
      { clientId, clientSecret: clientSecret || readClientSecret(settings.calendar) },
      url => { shell.openExternal(url) }
    ).then(result => {
      if (result.ok) {
        settings.calendar = {
          ...DEFAULT_CALENDAR_SETTINGS,
          ...(settings.calendar ?? { clientId }),
          displayName: result.displayName,
          enabled: true
        }
        invalidateCalendarCache()
        fileStore.saveSettings(settings)
        broadcastToAll('settings:updated', settings)
      } else {
        broadcastToAll('calendar:auth-error', result.error ?? '授權失敗')
      }
    }).catch(e => {
      broadcastToAll('calendar:auth-error', String(e))
    })

    return { ok: true }
  })

  ipcMain.handle('calendar:disconnect', () => {
    cancelGoogleAuth()
    invalidateCalendarCache()

    settings.calendar = {
      ...DEFAULT_CALENDAR_SETTINGS,
      ...(settings.calendar ?? {}),
      enabled: false,
      displayName: undefined
    }
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)

    // 向 Google 撤銷是「順便做」的清理，不讓它擋住畫面更新。
    // 本機憑證在 revokeGoogleAuth() 一開始就已刪除，即使這個請求失敗也已經斷線。
    void revokeGoogleAuth().catch(() => { /* 本機已清掉，撤銷失敗不影響 */ })

    return { ok: true }
  })

  ipcMain.handle('calendar:get-status', () => ({
    connected: isCalendarAuthenticated(),
    displayName: settings.calendar?.displayName,
    enabled: settings.calendar?.enabled ?? false
  }))

  /**
   * Log 視窗 debug 面板：直接看實際抓到什麼，不必發一則訊息去試探角色。
   * 略過快取，並套用目前情境的模組覆蓋，所見即聊天時所得。
   */
  ipcMain.handle('calendar:peek', async () => {
    const eff = applySceneModuleOverrides(settings)
    return {
      ...await peekCalendar(eff),
      enabled: isModuleEffectivelyEnabled(CALENDAR_MODULE_ID, settings.calendar?.enabled ?? false),
      sceneOverridden: (eff.calendar?.enabled ?? false) !== (settings.calendar?.enabled ?? false)
    }
  })

  /** 設定視窗調整區間／筆數後呼叫，讓下一次注入立刻反映新設定 */
  ipcMain.handle('calendar:save-options', (_, opts: { lookaheadHours?: number; maxEvents?: number; mentionWhenEmpty?: boolean }) => {
    settings.calendar = {
      ...DEFAULT_CALENDAR_SETTINGS,
      ...(settings.calendar ?? {}),
      ...(opts.lookaheadHours ? { lookaheadHours: Math.max(1, Math.min(opts.lookaheadHours, 168)) } : {}),
      ...(opts.maxEvents ? { maxEvents: Math.max(1, Math.min(opts.maxEvents, 20)) } : {}),
      ...(opts.mentionWhenEmpty !== undefined ? { mentionWhenEmpty: opts.mentionWhenEmpty } : {})
    }
    invalidateCalendarCache()
    fileStore.saveSettings(settings)
    broadcastToAll('settings:updated', settings)
    return { ok: true }
  })

  // Characters
  ipcMain.handle('characters:list', () => characters)

  ipcMain.handle('character:save', (_, char: Character) => saveCharacterDirect(char))

  ipcMain.handle('character:delete', (_, id: string) => deleteCharacterDirect(id))

  ipcMain.handle('character-library:open', (_, payload?: { mode?: 'home' | 'edit'; characterId?: string }) => {
    try {
      createCharacterLibraryWindow(payload)
      return true
    } catch (e) {
      console.error(e)
      return false
    }
  })

  ipcMain.handle('character:import-png', (_, payload: { buffer: ArrayBuffer }) =>
    importCharacterPngDirect(payload?.buffer ?? new ArrayBuffer(0)))

  ipcMain.handle('character:export-json', (_, char: Character) => exportCharacterJsonDirect(char))

  ipcMain.handle('character:export-png', (_, char: Character) => exportCharacterPngDirect(char))

  ipcMain.handle('character:build-dstpack', (_, payload: { characterIds: string[]; includeGlobalSettings: boolean; includeLorebooks?: boolean }) =>
    buildDstPackDirect(payload))

  ipcMain.handle('character:import-dstpack', async (event, payload: { buffer: ArrayBuffer }) => {
    // 匯入邏輯與手機端共用（`importDstPackDirect`）；桌面版的差別只有
    // 「怎麼問使用者」—— 這裡用系統對話框，手機端則是事先選好的策略。
    const win = BrowserWindow.fromWebContents(event.sender)
    const ask = async (opts: Electron.MessageBoxOptions): Promise<number> => {
      const r = win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, opts)
        : await dialog.showMessageBox(opts)
      return r.response
    }
    return importDstPackDirect(payload?.buffer ?? new ArrayBuffer(0), {
      onConflict: async ({ name, reason }) => {
        const response = await ask({
          type: 'question',
          buttons: ['覆蓋', '建立新角色', '取消匯入此角色'],
          defaultId: 2,
          cancelId: 2,
          title: 'DesktopST',
          message: `角色「${name}」匯入衝突`,
          detail: reason === 'same-id'
            ? '本機已存在相同角色 ID。要覆蓋、建立成另一個角色，或略過此角色？'
            : '本機已存在同名但不同 ID 的角色。要覆蓋本機同名角色、建立成另一個角色，或略過此角色？'
        })
        return response === 2 ? 'skip' : response === 1 ? 'new' : 'overwrite'
      },
      confirmGlobalSettings: async () => await ask({
        type: 'question',
        buttons: ['套用', '不要套用'],
        defaultId: 1,
        title: 'DesktopST',
        message: '此封裝包含世界觀與使用者資訊',
        detail: '是否套用匯入的世界觀與使用者資訊？（不會變更 API Key）'
      }) === 0
    })
  })

  ipcMain.handle('character:save-avatar', (_, payload: { id: string; buffer: ArrayBuffer; ext: string }) =>
    saveCharacterAvatarDirect(payload))

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

  // 事件驅動模式的「活動訊號」：renderer 偵測到游標在角色視窗範圍內移動時送出（已節流）。
  // 收到後喚醒慢輪詢當安全網；非事件驅動模式時 notifyPointerActivity 會自行忽略。
  ipcMain.on('desktop:pointer-activity', () => {
    notifyPointerActivity()
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

  // seq＝renderer 目前顯示的那一次現身；主程序若已排入更新的一次，這個關閉請求視為過期並忽略
  ipcMain.handle('bubble:close', (_, characterId: string, seq?: number) => {
    return hideSpeechBubble(characterId, seq == null ? undefined : Number(seq))
  })

  // renderer 掛好 bubble:show listener 後主動拉取進行中的 payload
  // （純推送會在 React 掛載前丟事件；拉取讓交握不依賴時序）
  ipcMain.handle('bubble:request-latest', (_, characterId: string) => {
    return getPendingBubbleShowPayload(characterId)
  })

  // renderer 確認已套用 payload；在此之前主程序的保底逾時不得把泡泡掀開
  ipcMain.handle('bubble:ack', (_, characterId: string, seq: number) => {
    return ackBubbleShow(characterId, Number(seq))
  })

  // renderer 畫好新對白後才真正顯示泡泡視窗（先畫好再現身，避免舊對白殘影）
  ipcMain.handle('bubble:reveal', (_, characterId: string, seq?: number) => {
    return revealSpeechBubble(characterId, seq == null ? undefined : Number(seq))
  })

  // 後續聊天主題：釘住一則新聞，桌面浮出主題泡泡；主動發話圍繞它聊
  ipcMain.handle('news:set-topic', (_, topic: NewsTopic & { sourceId?: string; promptContext?: string }) => {
    if (!topic || typeof topic.title !== 'string' || !topic.title) return { ok: false }
    setActiveNewsTopic({
      id: String(topic.id ?? ''),
      title: topic.title,
      summary: typeof topic.summary === 'string' ? topic.summary : '',
      url: typeof topic.url === 'string' ? topic.url : '',
      source: typeof topic.source === 'string' ? topic.source : '',
      promptContext: typeof topic.promptContext === 'string' ? topic.promptContext : undefined
    })
    // 設為聊天主題＝有興趣，加一點分（比回話少）；並清掉待結算避免重複計分
    consumePendingNewsCredit()
    if (topic.sourceId) applyNewsFeedbackDelta(topic.sourceId, 0.2)
    showTopicBubbleWindow()
    return { ok: true }
  })

  ipcMain.handle('news:clear-topic', () => {
    setActiveNewsTopic(null)
    closeTopicBubbleWindow()
    return { ok: true }
  })

  ipcMain.handle('news:get-topic', () => getActiveNewsTopic())

  /** 覆寫訊息（或主題）上的 promptContext；不回溯已產生的回覆 */
  ipcMain.handle('news:update-prompt-context', (_, payload?: {
    messageId?: string
    promptContext?: string
    syncTopic?: boolean
  }) => updateNewsPromptContextDirect(payload))

  ipcMain.handle('bubble:debug-show', (_, payload: { characterId: string; speakerName: string; text: string; emotion?: string; newsLink?: BubbleNewsMeta | null; messageId?: string; reaction?: string | null }) => {
    const { characterId, speakerName, text, emotion, newsLink, messageId, reaction } = payload ?? { characterId: '', speakerName: '', text: '' }
    if (!characterId) return false
    showSpeechBubble(
      characterId,
      speakerName || (getCharacter(characterId)?.name ?? '角色'),
      String(text ?? ''),
      emotion,
      bubbleAnchorForCharacter(characterId),
      newsLink ?? null,
      { messageId, reaction: reaction ?? null }
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
      const winType = windowTypeFromSender(event.sender)
      if (winType === 'log' || (winType === 'input' && settings.ui.lowPerformanceMode)) win.destroy()
      else win.hide()
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

  ipcMain.handle('window:open-remote-control-log', () => {
    openRemoteControlLog()
    return true
  })

  ipcMain.handle('window:close-remote-control-log', () => {
    closeRemoteControlLog()
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
    fileStore.pruneConversationDebugPrompts(conv, settings.memory.keepDebugPromptN)
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
    conv.summaryCoversTs = undefined
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

  // 記憶摘要：手動觸發（忽略自動閾值，立即把視窗外未涵蓋訊息濃縮進摘要）
  ipcMain.handle('conversation:summarize-now', async () => {
    const conv = getActiveConversation()
    if (!conv) return { ok: false, error: '沒有進行中的對話' }
    if (!settings.llm.apiKeys[settings.llm.provider]?.trim()) return { ok: false, error: '尚未設定 API Key' }
    return runConversationSummarize(conv)
  })

  // 記憶摘要：儲存使用者手動編輯的內容（不動 summaryCoversTs，下次增量摘要以此為基礎）
  ipcMain.handle('conversation:update-summary', (_, summary: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.summary = String(summary ?? '').trim()
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  // 記憶摘要：清除（連涵蓋點一起重設，之後重新摘要會從頭讀舊訊息）
  ipcMain.handle('conversation:clear-summary', () => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.summary = ''
    conv.summaryCoversTs = undefined
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  // 排除於記憶外：不進 prompt 上下文、也不被摘要收錄（可再次切換恢復）
  ipcMain.handle('conversation:set-message-excluded', (_, payload: { messageId: string; excluded: boolean }) => {
    const conv = getActiveConversation()
    if (!conv) return false
    const msg = conv.messages.find(m => m.id === payload?.messageId)
    if (!msg || msg.role === 'system') return false
    if (payload.excluded) msg.excludeFromContext = true
    else delete msg.excludeFromContext
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
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

  // 訊息 emoji reaction（單選；再按同一顆 = 取消）。😒 對新聞訊息兼作「主題沒興趣」弱負向回饋。
  ipcMain.handle('conversation:set-reaction', (_, payload: { messageId: string; reaction: string | null }) => {
    const conv = getActiveConversation()
    if (!conv) return false
    const msg = conv.messages.find(m => m.id === payload?.messageId)
    if (!msg || msg.role !== 'character') return false
    const next = payload.reaction && (MESSAGE_REACTION_EMOJIS as readonly string[]).includes(payload.reaction)
      ? payload.reaction
      : null
    const prev = msg.reaction ?? null
    if (prev === next) return true
    // 新聞來源回饋：設 😒 → −0.5；取消 / 換掉 😒 → +0.5 補回（applyNewsFeedbackDelta 內部有夾限）
    if (msg.newsLink?.sourceId) {
      if (next === '😒' && prev !== '😒') applyNewsFeedbackDelta(msg.newsLink.sourceId, -0.5)
      else if (prev === '😒' && next !== '😒') applyNewsFeedbackDelta(msg.newsLink.sourceId, 0.5)
    }
    if (next) msg.reaction = next
    else delete msg.reaction
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastConversationUpdate(conv)
    return true
  })

  // Messaging
  const sendMsgBody = async (payload: {
    content: string
    images?: string[]
    randomResult?: RandomResult
    randomResults?: RandomResult[]
    skipLlm?: boolean
    sourceDeviceName?: string
    newsLink?: NewsLinkInfo | null
  }): Promise<{ ok: boolean } | { error: string }> => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

    const activePersona = getActivePersona()
    const activeWorld = getActiveWorld()

    let userContentForPrompt = payload.content
    // ─── 斜線指令解析 ──────────────────────────────────────────
    // /news → 強制搜尋新聞；/weather → 強制查 CWA 天氣。指令文字從 prompt 中移除。
    const slashNews = /\/news\b/i.test(payload.content)
    const slashWeather = /\/weather\b/i.test(payload.content)
    if (slashNews || slashWeather) {
      userContentForPrompt = payload.content.replace(/\/news\b/gi, '').replace(/\/weather\b/gi, '').trim()
    }
    const sourceDeviceName = String(
      settings.mobile?.enabled
        ? payload.sourceDeviceName?.trim() || 'Desktop'
        : ''
    ).trim()
    if (sourceDeviceName) {
      userContentForPrompt = `[from: ${sourceDeviceName}]\n${userContentForPrompt}`
    }
    // Legacy single randomResult support (for mobile / old clients)
    if (payload.randomResult) {
      const label = formatRandomResultForPrompt(payload.randomResult)
      userContentForPrompt = `${userContentForPrompt}${userContentForPrompt ? '\n' : ''}（${label}）`
    }

    // 新聞「聊這個」：payload 優先，否則吃暫存的 pending link
    const attachedNewsLink: NewsLinkInfo | undefined =
      (payload.newsLink && payload.newsLink.title
        ? payload.newsLink
        : consumePendingUserNewsLink() ?? undefined) || undefined

    // Add user message
    // 發話當下的身分名字跟訊息一起存：身分之後改名或刪掉，舊記錄仍要看得出是誰說的。
    // 取名規則與手機輸入框上方的身分列一致（顯示名 → 暱稱 → 設定組名稱）。
    const sendPersona = getActivePersona()
    const sendPersonaName = sendPersona
      ? sendPersona.displayName.trim() || sendPersona.nickname.trim() || sendPersona.name
      : ''

    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      personaName: sendPersonaName || undefined,
      content: payload.content,
      images: payload.images,
      randomResult: payload.randomResult,
      randomResults: payload.randomResults,
      newsLink: attachedNewsLink,
      timestamp: Date.now()
    }
    conv.messages.push(userMsg)
    // 使用者回了話 → 把剛才角色聊的那則新聞來源加分（隱性正向回饋，design §9）
    const creditSourceId = consumePendingNewsCredit()
    if (creditSourceId) applyNewsFeedbackDelta(creditSourceId, 0.5)
    deferBroadcastConversationUpdate(conv)
    const shownUserText = String(payload.content ?? '').trim()
    const shownUserBubbleText = payload.randomResult
      ? `${shownUserText}${shownUserText ? '\n' : ''}（${formatRandomResultForPrompt(payload.randomResult)}）`
      : shownUserText
    if (shownUserBubbleText) {
      setImmediate(() => showUserSpeechBubble(getPersonaDisplayName(), shownUserBubbleText))
    }
    const userMsgForPrompt: Message = { ...userMsg, content: userContentForPrompt }

    // ─── skipLlm：僅記錄訊息、不觸發角色回應 ──────────────────
    if (payload.skipLlm) {
      fileStore.saveConversation(conv)
      return { ok: true }
    }

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
      : sortRespondersByKeywordMatch(desktopResponders, payload.content, getCharacter)

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
      showSpeechBubble(primaryId, primaryChar.name, noKeyText, noApiKeyMsg.emotion, bubbleAnchorForCharacter(primaryId), null, { messageId: noApiKeyMsg.id })
      sendCharacterContextUpdate(primaryId, { lastMessage: { id: noApiKeyMsg.id, emotion: noApiKeyMsg.emotion } })
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    const abortController = new AbortController()
    activeSendAbort = abortController
    activeSendDraft = { content: payload.content, images: payload.images }

    setThinking(primaryId, true)
    deferRaiseCharacterAbovePinnedNotes(primaryId)

    const recentMessagesBase = contextMessages([...conv.messages.slice(0, -1), userMsgForPrompt], settings.memory.keepRecentN)
    let lastReplyText = ''

    // Pre-fetch weather + spotify + realtime query context once for this message (shared across all responders)
    // 天氣 / Spotify / 新聞依情境模組覆蓋調整（'off' 時不抓、'on' 時強制啟用）
    const effChatSettings = applySceneModuleOverrides(settings)
    const weatherContext = effChatSettings.weather?.enabled ? await getWeatherContextString(effChatSettings) : null
    const spotifyContext = effChatSettings.spotify?.enabled ? await getSpotifyContextString(effChatSettings) : null
    const calendarContext = effChatSettings.calendar?.enabled ? await getCalendarContextString(effChatSettings) : null
    const realtimeQueryContext = (isModuleEffectivelyEnabled(WEATHER_MODULE_ID, true) || slashWeather)
      ? await getRealtimeQueryContextString(payload.content, settings)
      : { injectionText: null }
    const newsSearchResult = (isModuleEffectivelyEnabled(NEWS_MODULE_ID, true) || slashNews)
      ? await getConversationSearchContext(payload.content, settings, loadNewsModuleSettings())
      : { context: null, debugPrompt: null }
    // 災害新聞補搜：CWA 即時查詢命中時，自動從 Google News 補充社會面資訊
    const disasterNews = (isModuleEffectivelyEnabled(NEWS_MODULE_ID, true) || slashNews)
      ? await getDisasterNewsSupplement(payload.content, settings, realtimeQueryContext.typhoonName)
      : { context: null, category: null, queryUsed: null }
    // convSearch debug は userMsg に保存（主 LLM call の前に確定するため）
    if (newsSearchResult.debugPrompt) {
      userMsg.convSearchDebugPrompt = newsSearchResult.debugPrompt
      userMsg.convSearchInputTokens = newsSearchResult.inputTokens
      userMsg.convSearchOutputTokens = newsSearchResult.outputTokens
    }
    const chatPinnedNotesBlock = settings.ui.chatUsePinnedNotes ? buildVisiblePinnedNotesContext()?.text ?? null : null
    const moduleContextParts = await collectModuleContext(id => isModuleEffectivelyEnabled(id, true))
    const extraContextParts = [weatherContext, spotifyContext, calendarContext, realtimeQueryContext.injectionText, newsSearchResult.context, disasterNews.context, chatPinnedNotesBlock, ...moduleContextParts].filter(Boolean) as string[]
    const combinedExtraContext = extraContextParts.length > 0 ? extraContextParts.join('\n\n') : null

    // Emotion split: use utility model to classify if utilityEnabled + character has custom sprites
    const primaryHasCustomSprites = Object.values(primaryChar.emotions ?? {}).some(p => p?.trim())
    const doSplitEmotion = !!(settings.llm.utilityEnabled && primaryHasCustomSprites)

    // 1) Primary responder always replies
    try {
      const { content, emotion: rawEmotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM({
        settings: effChatSettings,
        character: primaryChar,
        messages: recentMessagesBase,
        images: payload.images,
        speakerNameById: getSpeakerNameById(),
        persona: activePersona,
        world: activeWorld,
        desktopCharacterNames,
        extraSystemContext: combinedExtraContext ?? undefined,
        memorySummary: conv.summary,
        loreBlock: buildLoreBlockFor(primaryChar, activeWorld, {
          summary: conv.summary,
          recentMessages: recentMessagesBase
        }),
        splitEmotion: doSplitEmotion,
        signal: abortController.signal
      })
      const primaryReply = stripOtherCharacterSpeakerLines(
        normalizeCharacterDialogue(content, primaryChar),
        primaryChar.id,
        characters
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
        const classifyResult = await classifyEmotionWithLLM({ settings, character: primaryChar, reply: primaryReply, signal: abortController.signal })
        emotion = classifyResult.emotion
        utilityInputTokens = classifyResult.inputTokens
        utilityOutputTokens = classifyResult.outputTokens
        utilityDebugPrompt = classifyResult.debugPrompt
      }
      userMsg.debugPrompt = debugPrompt
      userMsg.hasDebugPrompt = !!(debugPrompt || userMsg.convSearchDebugPrompt)
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
        convSearchDebugPrompt: userMsg.convSearchDebugPrompt,
        convSearchInputTokens: userMsg.convSearchInputTokens,
        convSearchOutputTokens: userMsg.convSearchOutputTokens,
        hasDebugPrompt: !!(debugPrompt || utilityDebugPrompt || userMsg.convSearchDebugPrompt),
        timestamp: Date.now()
      }
      conv.messages.push(charMsg)
      conv.updatedAt = Date.now()
      setThinking(primaryId, false)
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
        showSpeechBubble(primaryId, primaryChar.name, primaryReply, charMsg.emotion, bubbleAnchorForCharacter(primaryId), null, { messageId: charMsg.id })
        sendCharacterContextUpdate(primaryId, { lastMessage: { id: charMsg.id, emotion: charMsg.emotion } })
      })
    } catch (e: unknown) {
      setThinking(primaryId, false)
      if (abortController.signal.aborted) {
        activeSendAbort = null
        activeSendDraft = null
        // 使用者按下停止：移除尚未獲得回覆的訊息，關閉使用者泡泡，並把內容還給輸入框讓使用者修改重發
        conv.messages = conv.messages.filter(m => m.id !== userMsg.id)
        conv.updatedAt = Date.now()
        hideUserSpeechBubble()
        broadcastConversationUpdate(conv)
        syncCharacterContextsFromConversation(conv)
        const iw = getInputWindow()
        if (iw && !iw.isDestroyed()) {
          iw.webContents.send('input:restore-draft', { text: payload.content, images: payload.images ?? [] })
        }
        fileStore.saveConversation(conv)
        return { ok: true }
      }
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
      activeSendAbort = null
      activeSendDraft = null
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
      if (abortController.signal.aborted) break
      const char = getCharacter(charId)
      if (!char) continue

      try {
        setThinking(charId, true)
        deferRaiseCharacterAbovePinnedNotes(charId)
        let recentMessages = contextMessages(conv.messages, settings.memory.keepRecentN).map(m =>
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
          settings: effChatSettings,
          character: char,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById(),
          persona: activePersona,
          world: activeWorld,
          desktopCharacterNames,
          extraSystemContext: combinedExtraContext ?? undefined,
          memorySummary: conv.summary,
          loreBlock: buildLoreBlockFor(char, activeWorld, {
            summary: conv.summary,
            recentMessages
          }),
          splitEmotion: doSplitEmotionSec,
          signal: abortController.signal
        })
        const cleanReply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(reply.trim(), char),
          char.id,
          characters
        )

        if (!cleanReply) {
          setThinking(charId, false)
          continue
        }
        // Skip near-duplicates
        const replyNorm = normalizeForCompare(cleanReply)
        const lastNorm = normalizeForCompare(lastReplyText)
        if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
          setThinking(charId, false)
          continue
        }

        let emotionSec: string
        let secUtilityInputTk: number | undefined
        let secUtilityOutputTk: number | undefined
        let secUtilityDebugPrompt: string | undefined
        if (doSplitEmotionSec) {
          const cr = await classifyEmotionWithLLM({ settings, character: char, reply: cleanReply, signal: abortController.signal })
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
          convSearchDebugPrompt: userMsg.convSearchDebugPrompt,
          convSearchInputTokens: userMsg.convSearchInputTokens,
          convSearchOutputTokens: userMsg.convSearchOutputTokens,
          hasDebugPrompt: !!(debugPrompt || secUtilityDebugPrompt || userMsg.convSearchDebugPrompt),
          timestamp: Date.now()
        }
        lastReplyText = cleanReply
        conv.messages.push(charMsg)
        conv.updatedAt = Date.now()
        setThinking(charId, false)
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
          showSpeechBubble(charId, char.name, cleanReply, charMsg.emotion, bubbleAnchorForCharacter(charId), null, { messageId: charMsg.id })
          sendCharacterContextUpdate(charId, { lastMessage: { id: charMsg.id, emotion: charMsg.emotion } })
        })
      } catch (e: unknown) {
        // If a secondary decision fails, don't break the whole send flow.
        setThinking(charId, false)
        if (abortController.signal.aborted) break
      }
    }

    activeSendAbort = null
    activeSendDraft = null
    flushConversationBroadcast()
    fileStore.saveConversation(conv)
    maybeAutoSummarize(conv)
    return { ok: true }
  }
  _mobileSendImpl = sendMsgBody
  ipcMain.handle('message:send', (_, payload) => sendMsgBody(payload))

  // Stop the in-flight message:send LLM call(s), if any
  ipcMain.handle('message:stop', () => {
    stopSendDirect()
    return { ok: true }
  })

  // Resend the last message if it's a user message with no reply yet
  ipcMain.handle('message:resend-last', async () => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }
    const last = conv.messages[conv.messages.length - 1]
    if (!last || last.role !== 'user') return { error: 'Last message is not from user' }
    conv.messages.pop()
    conv.updatedAt = Date.now()
    broadcastConversationUpdate(conv)
    syncCharacterContextsFromConversation(conv)
    return sendMsgBody({ content: last.content, images: last.images, randomResult: last.randomResult })
  })

  // Force speak: one character speaks now
  ipcMain.handle('character:force-speak', async (_, characterId: string) => forceSpeakDirect(characterId))

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

    // 情境模組覆蓋（系統時間等）在此生效
    const effGroupSettings = applySceneModuleOverrides(settings)
    let lastReplyText = ''
    for (let i = 0; i < maxRounds; i++) {
      const char = nonMuted[i % nonMuted.length]
      setThinking(char.id, true)
      deferRaiseCharacterAbovePinnedNotes(char.id)
      try {
        let recentMessages = contextMessages(conv.messages, settings.memory.keepRecentN)
        if (recentMessages.length === 0) {
          recentMessages = [{ id: uuidv4(), role: 'user' as const, content: '……', timestamp: Date.now() }]
        }
        const hasCustomSprites = Object.values(char.emotions ?? {}).some(p => p?.trim())
        const doSplitEmotion = !!(settings.llm.utilityEnabled && hasCustomSprites)
        const { content, emotion: rawEmotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM({
          settings: effGroupSettings,
          character: char,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById(),
          persona: activePersona,
          world: activeWorld,
          desktopCharacterNames,
          memorySummary: conv.summary,
          loreBlock: buildLoreBlockFor(char, activeWorld, {
            summary: conv.summary,
            recentMessages
          }),
          splitEmotion: doSplitEmotion
        })
        const cleanReply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(content, char),
          char.id,
          characters
        )
        if (!cleanReply) { setThinking(char.id, false); continue }
        if (nonMuted.length > 1) {
          const replyNorm = normalizeForCompare(cleanReply)
          const lastNorm = normalizeForCompare(lastReplyText)
          if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
            setThinking(char.id, false); continue
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
          hasDebugPrompt: !!(debugPrompt || utilityDebugPrompt),
          timestamp: Date.now()
        }
        conv.messages.push(msg)
        conv.updatedAt = Date.now()
        setThinking(char.id, false)
        scheduleConversationBroadcast(conv)
        if (settings.ui.messageNotificationSound?.enabled !== false) {
          const volume = settings.ui.messageNotificationSound?.volume ?? 0.7
          const charWin = getCharacterWindow(char.id)
          if (charWin && !charWin.isDestroyed()) {
            charWin.webContents.send('audio:play-message-notification', { volume })
          }
        }
        await new Promise<void>(resolve => setImmediate(() => {
          showSpeechBubble(char.id, char.name, cleanReply, msg.emotion, bubbleAnchorForCharacter(char.id), null, { messageId: msg.id })
          sendCharacterContextUpdate(char.id, { lastMessage: { id: msg.id, emotion: msg.emotion } })
          resolve()
        }))
      } catch (e: unknown) {
        setThinking(char.id, false)
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
    maybeAutoSummarize(conv)
    return { ok: true }
  })

  // Mute toggle
  ipcMain.handle('desktop:toggle-mute', (_, characterId: string) => toggleMuteDirect(characterId))

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
    // Don't close — user can insert multiple tokens
    broadcastToAll('random-tools:selected', selection)
    return true
  })

  ipcMain.handle('random-tools:skip-llm', (_, skip: boolean) => {
    broadcastToAll('random-tools:skip-llm-changed', skip)
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
  ipcMain.handle('character:import-json', (_, payload: ImportJsonPayload) => importCharacterJsonDirect(payload))

  // ── Persona Presets ──────────────────────────────────────
  ipcMain.handle('presets:persona:list', () => fileStore.loadPersonaPresets())

  ipcMain.handle('presets:persona:save', (_, preset: PersonaPreset) => savePersonaPresetDirect(preset))

  ipcMain.handle('presets:persona:delete', (_, id: string) => removePersonaPresetDirect(id))

  // ── World Presets ────────────────────────────────────────
  ipcMain.handle('presets:world:list', () => fileStore.loadWorldPresets())

  ipcMain.handle('presets:world:save', (_, preset: WorldPreset) => saveWorldPresetDirect(preset))

  ipcMain.handle('presets:world:delete', (_, id: string) => removeWorldPresetDirect(id))

  // ── Scene Presets ─────────────────────────────────────────

  ipcMain.handle('scene:list', () => fileStore.loadScenePresets())

  ipcMain.handle('scene:save', (_, preset: ScenePreset) => saveScenePresetDirect(preset))

  ipcMain.handle('scene:delete', (_, id: string) => removeScenePresetDirect(id))

  // Capture current app state as a scene snapshot (create new or update existing)
  ipcMain.handle('scene:capture', (_, id: string | null, name: string) => captureSceneDirect(id, name))

  ipcMain.handle('scene:load', (_, id: string) => applySceneById(id))

  // ── 用語解說（Lorebook）CRUD ＋ ST 匯入匯出 ──────────────
  ipcMain.handle('lorebook:list', () => fileStore.loadLorebooks())
  ipcMain.handle('lorebook:get', (_, id: string) => getLorebookDirect(id))
  ipcMain.handle('lorebook:create', (_, name: string) => createLorebookDirect(name))
  ipcMain.handle('lorebook:save', (_, book: Lorebook) => {
    const r = saveLorebookDirect(book)
    return 'ok' in r
  })
  ipcMain.handle('lorebook:delete', (_, id: string) => {
    removeLorebookDirect(id)
    return true
  })

  /** 匯入 ST lorebook `.json`（或帶 `character_book` 的角色卡 JSON）。 */
  ipcMain.handle('lorebook:import-st', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: '選擇 SillyTavern 用語解說 JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile' as const]
    }
    const result = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true as const }

    const file = result.filePaths[0]
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
      // 檔案本身可能是一本 lorebook，也可能是包著 character_book 的角色卡
      const source = extractCharacterBook(raw) ?? raw
      const book = importStLorebook(source, {
        id: uuidv4(),
        fallbackName: path.basename(file, '.json'),
        makeEntryId: () => uuidv4()
      })
      fileStore.saveLorebook(book)
      broadcastToAll('lorebooks:updated', null)
      return { ok: true as const, book }
    } catch (e) {
      return { error: loreErrorMessage(e) }
    }
  })

  /** 匯出成 ST 相容 `.json`。 */
  ipcMain.handle('lorebook:export-st', async (event, id: string) => {
    const book = fileStore.loadLorebook(id)
    if (!book) return { error: '找不到這本用語解說' }
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = {
      title: '匯出用語解說',
      defaultPath: `${book.name || 'lorebook'}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const { canceled, filePath } = win && !win.isDestroyed()
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return { canceled: true as const }
    try {
      fs.writeFileSync(filePath, JSON.stringify(exportStLorebook(book), null, 2), 'utf-8')
      return { ok: true as const, path: filePath }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  })

  /**
   * 從角色卡生成一條用語解說並加進指定的書（規格 §8）。
   * 失敗一律回錯誤字串讓 UI 顯示；匯入流程另有靜默略過的呼叫點。
   * 邏輯在 `generateLoreEntryDirect`，手機 `mobileServer` 共用同一份。
   */
  ipcMain.handle('lorebook:generate-entry', async (_, payload: { characterId: string; lorebookId: string }) =>
    generateLoreEntryDirect(payload?.characterId, payload?.lorebookId))

  // 已註冊模組清單（情境模組開關 UI 用；排除遠端遙控等基礎設施由 renderer 決定）
  ipcMain.handle('modules:list', () => listRegisteredModules())

  // ── Reminders（邏輯在上面的 *Direct，桌面與手機共用）───────

  ipcMain.handle('reminder:list', () => listRemindersDirect())
  ipcMain.handle('reminder:save', (_, reminder: Reminder) => saveReminderDirect(reminder))
  ipcMain.handle('reminder:delete', (_, id: string) => deleteReminderDirect(id))
  ipcMain.handle('reminder:toggle', (_, id: string, enabled: boolean) => toggleReminderDirect(id, enabled))

  ipcMain.handle('shell:open-external', (_, url: string) => {
    return shell.openExternal(url)
  })

  /**
   * 開啟隨程式附帶的說明文件（`docs/` 底下的 .html）。
   * 走本機檔案而非線上網址，離線也能看；檔名白名單，不接受路徑。
   */
  ipcMain.handle('shell:open-doc', async (_, name: string) => {
    const ALLOWED = ['google-calendar-setup.html', 'license.html']
    if (!ALLOWED.includes(name)) return { ok: false, error: '未知的說明文件' }

    const appRoot = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
    const p = path.join(appRoot, 'docs', name)
    if (!fs.existsSync(p)) return { ok: false, error: '找不到說明文件' }

    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
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

  // ── Mobile remote chat ────────────────────────────────
  ipcMain.handle('mobile:get-status', () => {
    if (!_getMobileStatusFn) return { enabled: false, running: false, tunnelReady: false, url: null, localUrl: '', connectedCount: 0, cloudflaredAvailable: false }
    return _getMobileStatusFn()
  })

  ipcMain.handle('mobile:open-qr', () => {
    openQRCodeWindow()
    return true
  })

  ipcMain.handle('mobile:generate-qr', async (_, url: string) => {
    try {
      const qrcode = await import('qrcode')
      const dataUrl = await qrcode.toDataURL(url, {
        width: 200,
        margin: 2,
        color: { dark: '#3D5A52', light: '#FFFFFF' }
      })
      return dataUrl
    } catch {
      return null
    }
  })

  ipcMain.handle('mobile:fix-firewall', async () => {
    const { addFirewallException } = await import('./cloudflaredManager')
    return addFirewallException()
  })
}
