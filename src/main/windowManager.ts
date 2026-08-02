import { BrowserWindow, screen, nativeImage, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { Conversation, Message } from './types'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const DEVTOOLS_ENABLED = process.env['DESKTOPST_DEVTOOLS'] === '1'
const CHARACTER_ALWAYS_ON_TOP_LEVEL = 'floating' as const
const BUBBLE_ALWAYS_ON_TOP_LEVEL = 'screen-saver' as const
function getAssetsRoot(): string {
  return app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'assets')
    : path.join(app.getAppPath(), 'assets')
}

function getAppIcon(): Electron.NativeImage | undefined {
  const assetsRoot = getAssetsRoot()
  const candidates = ['icon.ico', 'icon.png'].map(f => path.join(assetsRoot, f))
  const found = candidates.find(p => fs.existsSync(p))
  return found ? nativeImage.createFromPath(found) : undefined
}

type WindowBoundsState = { x: number; y: number; width: number; height: number }
type AuxWindowKind = 'input' | 'log'
type VisibleAuxWindowKind =
  | 'input'
  | 'userBubble'
  | 'log'
  | 'settings'
  | 'characterLibrary'
  | 'preview'
  | 'pinnedNotesManager'
  | 'remindersManager'
  | 'speechBubble'
export type VisibleAuxWindowSnapshotEntry = {
  kind: VisibleAuxWindowKind
  bounds: WindowBoundsState
  characterId?: string
}
let getSavedAuxBounds: ((kind: AuxWindowKind) => WindowBoundsState | null | undefined) | null = null
let saveAuxBounds: ((kind: AuxWindowKind, bounds: WindowBoundsState) => void) | null = null

function makeURL(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  if (VITE_DEV_SERVER_URL) return `${VITE_DEV_SERVER_URL}?${query}`
  return `file://${path.join(__dirname, '../renderer/index.html')}?${query}`
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function normalizeWindowPosition(
  position: { x: number; y: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const px = Number.isFinite(position.x) ? position.x : 80
  const py = Number.isFinite(position.y) ? position.y : 80

  const display = screen.getDisplayNearestPoint({ x: px, y: py })
  const wa = display.workArea

  const maxX = wa.x + Math.max(0, wa.width - size.width)
  const maxY = wa.y + Math.max(0, wa.height - size.height)

  return {
    x: clamp(Math.round(px), wa.x, maxX),
    y: clamp(Math.round(py), wa.y, maxY)
  }
}

function bubbleBoundsNearlyEqual(a: WindowBoundsState, b: WindowBoundsState, eps = 2): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.width - b.width) <= eps &&
    Math.abs(a.height - b.height) <= eps
  )
}

/** 與上次程式 setBounds 比對時放寬：Windows／高分屏下 getBounds 常有 1～數 px 抖動，過嚴會誤觸 refresh 累積偏移 */
function getWindowBoundsState(win: BrowserWindow): WindowBoundsState | null {
  if (win.isDestroyed()) return null
  const b = win.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

const BUBBLE_PROGRAMMATIC_BOUNDS_EPS = 28
const DEFAULT_UNFOCUSED_BUBBLE_OPACITY = 0.1
let unfocusedBubbleOpacity = DEFAULT_UNFOCUSED_BUBBLE_OPACITY

export function getCharacterWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.max(280, Math.round(220 * scale)),
    height: Math.max(272, Math.round(432 * scale))
  }
}

function normalizeOpacity(opacity: number): number {
  return clamp(
    Number.isFinite(opacity) ? opacity : DEFAULT_UNFOCUSED_BUBBLE_OPACITY,
    0,
    1
  )
}

function defaultUserBubbleBounds(): WindowBoundsState {
  const input = inputWindow && !inputWindow.isDestroyed() ? inputWindow : null
  if (input) {
    const ib = input.getBounds()
    return {
      x: ib.x,
      y: ib.y - 104,
      width: ib.width,
      height: 120
    }
  }
  const fallback = defaultInputBounds()
  return {
    x: fallback.x,
    y: fallback.y - 104,
    width: fallback.width,
    height: 120
  }
}

function defaultInputBounds(): WindowBoundsState {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { x: Math.round(width / 2 - 200), y: Math.round(height - 200), width: 400, height: 160 }
}

function defaultLogBounds(): WindowBoundsState {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  return { x: Math.round(width / 2 - 280), y: 80, width: 560, height: Math.round(height * 0.7) }
}

function isWindowBoundsVisible(bounds: WindowBoundsState): boolean {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 120 ||
    bounds.height < 80
  ) return false
  const center = { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) }
  for (const display of screen.getAllDisplays()) {
    const wa = display.workArea
    if (center.x >= wa.x && center.x <= wa.x + wa.width && center.y >= wa.y && center.y <= wa.y + wa.height) {
      return true
    }
  }
  return false
}

function getInitialAuxBounds(kind: AuxWindowKind): WindowBoundsState {
  const fallback = kind === 'input' ? defaultInputBounds() : defaultLogBounds()
  const saved = getSavedAuxBounds?.(kind)
  if (saved && isWindowBoundsVisible(saved)) return saved
  return fallback
}

function rememberAuxBounds(kind: AuxWindowKind, win: BrowserWindow): void {
  const save = () => {
    if (win.isDestroyed()) return
    const b = getWindowBoundsState(win)
    if (b) saveAuxBounds?.(kind, b)
  }
  win.on('moved', save)
  win.on('resized', save)
  win.on('close', save)
}

export function configureAuxWindowPersistence(
  getBounds: (kind: AuxWindowKind) => WindowBoundsState | null | undefined,
  saveBounds: (kind: AuxWindowKind, bounds: WindowBoundsState) => void
): void {
  getSavedAuxBounds = getBounds
  saveAuxBounds = saveBounds
}

function clampCharacterScaleForDisplay(scale: number, point: { x: number; y: number }): number {
  const display = screen.getDisplayNearestPoint(point)
  const wa = display.workArea
  const maxByWidth = (wa.width - 12) / 220
  const maxByHeight = (wa.height - 12) / 380
  const maxVisibleScale = Math.max(0.25, Math.min(4, maxByWidth, maxByHeight))
  return clamp(scale, 0.25, maxVisibleScale)
}

const characterWindows = new Map<string, BrowserWindow>()
const bubbleWindows = new Map<string, BrowserWindow>()
/** 追蹤每個泡泡視窗最近一次被顯示的時間，用於淘汰最久未使用視窗（LRU）。 */
const bubbleLastActiveAt = new Map<string, number>()
/** 使用者拖曳對白視窗後，相對於「預設錨點位置」的像素偏移（跟著角色移動時保留） */
const bubbleUserOffset = new Map<string, { x: number; y: number }>()
/** 最近一次由程式 setBounds 寫入的對白視窗矩形；與 moved 比對以區分「程式同步」與「使用者拖對白」 */
const lastBubbleBoundsProgrammatic = new Map<string, WindowBoundsState>()
/** 拖曳角色收尾期間，暫時禁止 bubble moved 回寫使用者偏移，避免累積漂移。 */
const bubbleOffsetWriteSuppressedUntil = new Map<string, number>()
/** 角色拖曳前保存泡泡偏移，拖曳後恢復，避免微小誤差累積成漂移。 */
const bubbleUserOffsetSnapshotBeforeDrag = new Map<string, { x: number; y: number } | null>()
/** 避免異常 IPC 傳入無限大；一般長文仍完整顯示 */
const BUBBLE_MAX_HEIGHT_PX = 32000
/** 對白內容 max-width 420 + 最後發話實心陰影偏移 + 子像素／DPI 安全邊 */
const BUBBLE_CONTENT_MAX_WIDTH_PX = 420
const BUBBLE_LATEST_SHADOW_PAD_PX = 5
const BUBBLE_SIZE_SAFETY_PX = 8
const BUBBLE_MAX_WIDTH_PX =
  BUBBLE_CONTENT_MAX_WIDTH_PX + BUBBLE_LATEST_SHADOW_PAD_PX + BUBBLE_SIZE_SAFETY_PX
/** 顯示前先撐到這個寬度再量測，避免舊的窄視窗把 offsetWidth 卡住 */
const BUBBLE_MEASURE_FLOOR_WIDTH_PX = BUBBLE_MAX_WIDTH_PX
/** 依桌面角色數量決定可同時存在的泡泡上限（至少 1）。 */
let lowPerformanceModeEnabled = false
let lowPerformanceLogMessageLimit = 50
function getBubbleConcurrentWindowLimit(): number {
  if (lowPerformanceModeEnabled) return 1
  return Math.max(1, characterWindows.size)
}
/** 立體角色立繪頂端與對白框下緣的間距（px） */
const BUBBLE_GAP_PX = 6
/** CSS 底部偏移：CharacterWindow 的 flex container 以 bottom-[52px] 定位 */
const CHAR_WIN_BOTTOM_OFFSET_PX = 52
/** renderer 回報的角色實際 sprite 高度（CSS px，含縮放倍率）；key=characterId */
const spriteActualHeights = new Map<string, number>()
const BUBBLE_MIN_VISIBLE_DRAG_PX = 32
/** 對白相對於頭頂錨點：尚無使用者拖過對白時的初始偏移；拖對白放手後由 refreshBubbleUserOffsetFromWindow 寫入並保留，角色拖曳結束不覆寫。 */
const BUBBLE_USER_OFFSET_DEFAULT: Readonly<{ x: number; y: number }> = { x: 0, y: 0 }

type ScreenRect = { x: number; y: number; w: number; h: number }
const hitRects = new Map<string, { sprite: ScreenRect | null; buttons: ScreenRect | null }>()
/** Renderer 回報「游標是否真的在不透明區域」；取代 sprite bounding-box 判斷 */
const characterInteractableState = new Map<string, boolean>()
const draggingCharacters = new Set<string>()
let activeDraggingCharacterId: string | null = null
/** 拖曳桌面角色時暫時 hide 的其他角色對白（僅 hide 視窗，不改 renderer 狀態） */
const bubblesSuppressedForDesktopDrag = new Map<string, boolean>()
let hitTestTimer: NodeJS.Timeout | null = null
/** 事件驅動命中測試：開啟時停用主程序的常駐游標輪詢，改為「活動門控的慢輪詢」混合策略——
 *  閒置時完全不喚醒（0 輪詢），只有 renderer 偵測到游標在角色視窗範圍內活動時，才啟動一個
 *  很慢的對帳輪詢（ACTIVITY_POLL_MS），把點擊穿透狀態對齊到游標真實位置；游標離開角色一段時間
 *  沒有活動就自動停止。兼顧省電與「靠近角色時不必多點幾下」。 */
let eventDrivenHitTestEnabled = false
/** 活動門控慢輪詢的計時器與最後活動時間戳（僅事件驅動模式使用） */
let activityPollTimer: NodeJS.Timeout | null = null
let lastPointerActivityAt = 0
/** 事件驅動模式：偵測到活動後的慢輪詢間隔（ms）。比常駐輪詢的 33/120ms 省電許多。 */
const ACTIVITY_POLL_MS = 250
/** 事件驅動模式：游標離開角色後，超過此時間無活動就停止慢輪詢，回到 0 喚醒。 */
const ACTIVITY_IDLE_TIMEOUT_MS = 1500
/** setIgnoreMouseEvents 的上次狀態快取；只有變更時才呼叫 Win32 API */
const lastIgnoreMouseState = new Map<string, boolean>()
let charactersRaisedAboveAux = false
const lastBubbleSizes = new Map<string, { width: number; height: number }>()
/** 拖曳角色時曾把對白 hide()，放手後要 show 回來（避免拖曳中對白座標漂移） */
const bubbleHiddenForCharacterDrag = new Map<string, boolean>()
const activeDragOffsets = new Map<string, { x: number; y: number }>()
const activeDragCallbacks = new Map<string, ((pos: { x: number; y: number }) => void) | null>()
const activeDragLastPositions = new Map<string, { x: number; y: number }>()
let charactersAlwaysOnTop = true
const MAX_ELECTRON_WINDOW_COORD = 1_000_000

/**
 * 角色分層狀態機：追蹤每個角色目前是否處於「發話置頂」狀態。
 * - true = SPEAKING（角色和泡泡都被推到 screen-saver band）
 * - false/undefined = IDLE（角色在正常 band）
 */
const characterSpeakingPromoted = new Map<string, boolean>()

function isSafeWindowCoordinate(n: number): boolean {
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_ELECTRON_WINDOW_COORD
}

export function setCharactersAlwaysOnTop(enabled: boolean): void {
  charactersAlwaysOnTop = enabled
  for (const [id, w] of characterWindows.entries()) {
    if (w.isDestroyed()) continue
    // 正在發話中的角色保持在 screen-saver band
    if (characterSpeakingPromoted.get(id)) {
      w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else if (enabled) {
      w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    } else {
      w.setAlwaysOnTop(false)
    }
  }
  for (const [id, w] of bubbleWindows.entries()) {
    if (w.isDestroyed()) continue
    // 正在發話中的泡泡保持在 screen-saver band
    if (characterSpeakingPromoted.get(id)) {
      w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else if (enabled) {
      w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else {
      w.setAlwaysOnTop(false)
    }
  }
  for (const w of pinnedNoteWindows.values()) {
    if (w.isDestroyed()) continue
    if (enabled) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    else w.setAlwaysOnTop(false)
  }
}

export function setCharacterAlwaysOnTop(characterId: string, enabled: boolean): void {
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) {
    if (characterSpeakingPromoted.get(characterId)) {
      cw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else if (enabled) {
      cw.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    } else {
      cw.setAlwaysOnTop(false)
    }
  }
  const bw = bubbleWindows.get(characterId)
  if (bw && !bw.isDestroyed()) {
    if (characterSpeakingPromoted.get(characterId)) {
      bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else if (enabled) {
      bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    } else {
      bw.setAlwaysOnTop(false)
    }
  }
}

export function getCharactersAlwaysOnTop(): boolean {
  return charactersAlwaysOnTop
}
let suppressAuxAutoHideUntil = 0
let lastShownBubbleCharacterId: string | null = null

export function setLowPerformanceMode(enabled: boolean, logMessageLimit = 50): void {
  lowPerformanceModeEnabled = enabled
  lowPerformanceLogMessageLimit = clamp(Math.round(Number(logMessageLimit) || 50), 10, 500)
  if (enabled) pruneSpeechBubbleWindows(lastShownBubbleCharacterId ?? '')
}

let characterLibraryWindow: BrowserWindow | null = null
type CharacterLibraryNavigateMode = 'home' | 'edit'
type CharacterLibraryOpenOptions = {
  mode?: CharacterLibraryNavigateMode
  characterId?: string
}

/** 便利貼視窗；key = noteId，同一 characterId 目前只顯示最新的一張 */
const pinnedNoteWindows = new Map<string, BrowserWindow>()
type NotesBoundsCallback = (noteId: string, bounds: { x: number; y: number; width: number; height: number }) => void
let onPinnedNoteBoundsChanged: NotesBoundsCallback | null = null

export function configurePinnedNotePersistence(cb: NotesBoundsCallback): void {
  onPinnedNoteBoundsChanged = cb
}

function sendCharacterLibraryNavigate(win: BrowserWindow, options?: CharacterLibraryOpenOptions): void {
  const mode: CharacterLibraryNavigateMode = options?.mode === 'edit' ? 'edit' : 'home'
  win.webContents.send('character-library:navigate', {
    mode,
    characterId: mode === 'edit' ? (options?.characterId ?? '') : ''
  })
}

function getAuxWindows(): BrowserWindow[] {
  return [inputWindow, userBubbleWindow, logWindow, settingsWindow, characterLibraryWindow, newsReaderWindow].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
}

export function createCharacterLibraryWindow(options?: CharacterLibraryOpenOptions): BrowserWindow {
  if (characterLibraryWindow && !characterLibraryWindow.isDestroyed()) {
    characterLibraryWindow.show()
    characterLibraryWindow.focus()
    raiseAuxAboveCharacters()
    characterLibraryWindow.moveTop()
    sendCharacterLibraryNavigate(characterLibraryWindow, options)
    return characterLibraryWindow
  }

  characterLibraryWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  characterLibraryWindow.setAlwaysOnTop(true, 'pop-up-menu')

  const query: Record<string, string> = { w: 'library' }
  if (options?.mode === 'edit' && options.characterId) {
    query.mode = 'edit'
    query.characterId = options.characterId
  }
  if (VITE_DEV_SERVER_URL) {
    characterLibraryWindow.loadURL(makeURL(query))
  } else {
    characterLibraryWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }

  characterLibraryWindow.on('closed', () => {
    characterLibraryWindow = null
  })
  characterLibraryWindow.webContents.once('did-finish-load', () => {
    if (!characterLibraryWindow || characterLibraryWindow.isDestroyed()) return
    sendCharacterLibraryNavigate(characterLibraryWindow, options)
  })

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    characterLibraryWindow.webContents.openDevTools({ mode: 'detach' })
  }

  characterLibraryWindow.show()
  characterLibraryWindow.setOpacity(1)
  raiseAuxAboveCharacters()
  characterLibraryWindow.moveTop()
  characterLibraryWindow.focus()
  return characterLibraryWindow
}

export function getCharacterLibraryWindow(): BrowserWindow | undefined {
  return characterLibraryWindow && !characterLibraryWindow.isDestroyed() ? characterLibraryWindow : undefined
}

// ── 個人新聞報視窗 ─────────────────────────────────────────────────────────
let newsReaderWindow: BrowserWindow | null = null

/** 模組層級的新聞報視窗位置記憶（尚未接入 AuxWindowKind，task 5.2 再擴充） */
let savedNewsReaderBounds: { x: number; y: number; width: number; height: number } | null = null

function saveNewsReaderBounds(): void {
  if (!newsReaderWindow || newsReaderWindow.isDestroyed()) return
  const b = newsReaderWindow.getBounds()
  savedNewsReaderBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
}

export function createNewsReaderWindow(): BrowserWindow {
  if (newsReaderWindow && !newsReaderWindow.isDestroyed()) {
    newsReaderWindow.show()
    newsReaderWindow.focus()
    return newsReaderWindow
  }

  const defaultBounds = { x: 80, y: 60, width: 900, height: 720 }
  const bounds =
    savedNewsReaderBounds && isWindowBoundsVisible(savedNewsReaderBounds)
      ? savedNewsReaderBounds
      : defaultBounds

  newsReaderWindow = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 400,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  newsReaderWindow.setAlwaysOnTop(true, 'pop-up-menu')
  newsReaderWindow.loadURL(makeURL({ w: 'news-reader' }))

  newsReaderWindow.on('moved', saveNewsReaderBounds)
  newsReaderWindow.on('resized', saveNewsReaderBounds)
  newsReaderWindow.on('close', saveNewsReaderBounds)
  newsReaderWindow.on('closed', () => {
    newsReaderWindow = null
  })

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    newsReaderWindow.webContents.openDevTools({ mode: 'detach' })
  }

  return newsReaderWindow
}

export function getNewsReaderWindow(): BrowserWindow | null {
  return newsReaderWindow && !newsReaderWindow.isDestroyed() ? newsReaderWindow : null
}

export function suppressAuxAutoHide(ms = 700): void {
  suppressAuxAutoHideUntil = Math.max(suppressAuxAutoHideUntil, Date.now() + ms)
}

export function shouldSuppressAuxAutoHide(): boolean {
  return Date.now() < suppressAuxAutoHideUntil
}

function pointInRect(p: { x: number; y: number }, r: ScreenRect | null): boolean {
  if (!r) return false
  const pad = 12
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
}

export function isCursorOverInteractiveCharacter(): boolean {
  const cursor = screen.getCursorScreenPoint()
  for (const rects of hitRects.values()) {
    if (pointInRect(cursor, rects.sprite) || pointInRect(cursor, rects.buttons)) return true
  }
  return false
}

/** 命中測試輪詢間隔：游標在角色附近或拖曳中用 33ms（順手），否則 120ms（省 CPU） */
const HIT_TEST_ACTIVE_MS = 33
const HIT_TEST_IDLE_MS = 120
/** 判定「游標接近角色」時，在角色矩形外再放寬的喚醒邊界（px） */
const HIT_TEST_NEAR_MARGIN = 64

function rectContainsWithMargin(p: { x: number; y: number }, r: ScreenRect | null, margin: number): boolean {
  if (!r) return false
  return p.x >= r.x - margin && p.x <= r.x + r.w + margin && p.y >= r.y - margin && p.y <= r.y + r.h + margin
}

function isCursorNearAnyCharacter(cursor: { x: number; y: number }): boolean {
  for (const rects of hitRects.values()) {
    if (rectContainsWithMargin(cursor, rects.sprite, HIT_TEST_NEAR_MARGIN)) return true
    if (rectContainsWithMargin(cursor, rects.buttons, HIT_TEST_NEAR_MARGIN)) return true
  }
  return false
}

/** 集中入口：只在狀態真的改變時才呼叫 Win32 API。事件驅動模式用，拖曳中由 drag 系直接控制。 */
function applyIgnoreMouse(characterId: string, isInteractable: boolean): void {
  const win = characterWindows.get(characterId)
  if (!win || win.isDestroyed()) return
  const shouldIgnore = !isInteractable
  if (lastIgnoreMouseState.get(characterId) !== shouldIgnore) {
    lastIgnoreMouseState.set(characterId, shouldIgnore)
    win.setIgnoreMouseEvents(shouldIgnore, { forward: true })
  }
}

/** 事件驅動模式：依 renderer 最後回報的 interactable 狀態，重新套用所有角色的 click-through。
 *  用於切換模式的當下、或結束拖曳時，把狀態對齊到正確值。 */
function reapplyAllIgnoreMouseFromState(): void {
  for (const [id, isInteractable] of characterInteractableState.entries()) {
    applyIgnoreMouse(id, isInteractable ?? false)
  }
}

/** 切換事件驅動命中測試。開啟時停掉輪詢並依現況對齊一次；關閉時恢復輪詢。 */
export function setEventDrivenHitTest(enabled: boolean): void {
  if (eventDrivenHitTestEnabled === enabled) return
  eventDrivenHitTestEnabled = enabled
  if (enabled) {
    if (hitTestTimer) { clearTimeout(hitTestTimer); hitTestTimer = null }
    // 切換當下沒有 mousemove 觸發，先依 renderer 最後回報的狀態對齊一次，避免角色卡在錯誤狀態。
    reapplyAllIgnoreMouseFromState()
  } else {
    stopActivityPollLoop()
    if (characterWindows.size > 0) ensureHitTestLoop()
  }
}

/** 事件驅動模式：renderer 偵測到游標在角色視窗範圍內活動時呼叫。記下活動時間並確保慢輪詢在跑。 */
export function notifyPointerActivity(): void {
  if (!eventDrivenHitTestEnabled) return
  lastPointerActivityAt = Date.now()
  ensureActivityPollLoop()
}

/** 事件驅動模式專用的慢輪詢：用很長的間隔對帳真實游標位置，當作事件的安全網。
 *  超過 ACTIVITY_IDLE_TIMEOUT_MS 沒有新活動（且非拖曳中）就自動停止，回到 0 喚醒。 */
function ensureActivityPollLoop(): void {
  if (!eventDrivenHitTestEnabled) return
  if (activityPollTimer) return
  if (characterWindows.size === 0) return
  const tick = (): void => {
    runHitTestPass()
    if (characterWindows.size === 0) { activityPollTimer = null; return }
    const dragging = activeDraggingCharacterId !== null || draggingCharacters.size > 0
    if (!dragging && Date.now() - lastPointerActivityAt > ACTIVITY_IDLE_TIMEOUT_MS) {
      activityPollTimer = null
      return
    }
    activityPollTimer = setTimeout(tick, ACTIVITY_POLL_MS)
  }
  activityPollTimer = setTimeout(tick, ACTIVITY_POLL_MS)
}

function stopActivityPollLoop(): void {
  if (activityPollTimer) {
    clearTimeout(activityPollTimer)
    activityPollTimer = null
  }
}

function runHitTestPass(): void {
  const draggingId = activeDraggingCharacterId
  const cursor = screen.getCursorScreenPoint()
  for (const [characterId, win] of characterWindows.entries()) {
    if (!win || win.isDestroyed()) continue
    let shouldIgnore = true
    if (draggingId) {
      // Dragging mode: only active dragging character keeps interaction enabled.
      shouldIgnore = characterId !== draggingId
    } else {
      // Never click-through while dragging: mouseup must always reach the renderer.
      const dragging = draggingCharacters.has(characterId)
      const rects = hitRects.get(characterId)
      const onButtons = !!rects?.buttons && pointInRect(cursor, rects.buttons)
      const inSpriteBounds = !!rects?.sprite && pointInRect(cursor, rects.sprite)
      // Use renderer-reported pixel-level opacity instead of bounding box.
      // This allows clicks to pass through to characters behind transparent areas.
      // Fall back to allowing (true) when renderer hasn't reported yet so it can
      // receive the first mousemove and report back.
      const rendererInteractable = characterInteractableState.get(characterId)
      const inside = dragging || onButtons || (inSpriteBounds && (rendererInteractable ?? true))
      shouldIgnore = !inside
    }
    if (lastIgnoreMouseState.get(characterId) !== shouldIgnore) {
      lastIgnoreMouseState.set(characterId, shouldIgnore)
      win.setIgnoreMouseEvents(shouldIgnore, { forward: true })
    }
  }
}

function ensureHitTestLoop(): void {
  if (eventDrivenHitTestEnabled) return
  if (hitTestTimer) return
  // 用自我排程的 setTimeout 取代固定 33ms setInterval：游標遠離所有角色時自動降頻到 120ms，
  // 在無 GPU／軟體渲染的機器上明顯降低背景 CPU 喚醒次數，互動時仍維持 33ms 的手感。
  const schedule = (delay: number) => {
    hitTestTimer = setTimeout(() => {
      runHitTestPass()
      if (characterWindows.size === 0) { hitTestTimer = null; return }
      const cursor = screen.getCursorScreenPoint()
      const active = activeDraggingCharacterId !== null
        || draggingCharacters.size > 0
        || isCursorNearAnyCharacter(cursor)
      schedule(active ? HIT_TEST_ACTIVE_MS : HIT_TEST_IDLE_MS)
    }, delay)
  }
  schedule(HIT_TEST_ACTIVE_MS)
}

function maybeStopHitTestLoop(): void {
  if (characterWindows.size > 0) return
  if (hitTestTimer) {
    clearTimeout(hitTestTimer)
    hitTestTimer = null
  }
  stopActivityPollLoop()
}

export function createCharacterWindow(
  characterId: string,
  position: { x: number; y: number },
  size: number
): BrowserWindow {
  const requestedScale = Number.isFinite(size) && size > 0 ? size : 1
  const scale = clampCharacterScaleForDisplay(requestedScale, position)
  const winSize = getCharacterWindowSize(scale)
  const pos = normalizeWindowPosition(position, winSize)

  const charTargetBounds = { x: pos.x, y: pos.y, width: winSize.width, height: winSize.height }
  // Windows 混合 DPI workaround：見 createPinnedNoteWindow 同段註解
  const win = new BrowserWindow({
    ...charTargetBounds,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.show()
  win.setBounds(charTargetBounds)

  win.setIgnoreMouseEvents(false)
  if (charactersAlwaysOnTop) win.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  else win.setAlwaysOnTop(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'character', id: characterId, size: String(scale) }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'character', id: characterId, size: String(scale) }
    })
  }

  characterWindows.set(characterId, win)
  win.on('closed', () => {
    characterWindows.delete(characterId)
    hitRects.delete(characterId)
    characterInteractableState.delete(characterId)
    lastIgnoreMouseState.delete(characterId)
    characterSpeakingPromoted.delete(characterId)
    maybeStopHitTestLoop()
  })
  ensureHitTestLoop()
  // DevTools is opt-in to avoid UI overlays (inspect/rulers) interfering with the pet window.
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
  return win
}

export function getCharacterWindow(characterId: string): BrowserWindow | undefined {
  return characterWindows.get(characterId)
}

const scaleModeAnchorFeet = new Map<string, { x: number; y: number }>()

export function enterCharacterScaleMode(characterId: string): void {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  scaleModeAnchorFeet.set(characterId, {
    x: b.x + b.width / 2,
    y: b.y + b.height
  })
}

export function exitCharacterScaleMode(characterId: string): void {
  scaleModeAnchorFeet.delete(characterId)
}

export function enterScaleModeWindow(characterId: string): void {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return

  const oldBounds = win.getBounds()
  const feetX = oldBounds.x + oldBounds.width / 2
  const feetY = oldBounds.y + oldBounds.height
  scaleModeAnchorFeet.set(characterId, { x: feetX, y: feetY })

  const display = screen.getDisplayNearestPoint({ x: feetX, y: feetY })
  const wa = display.workArea

  const maxScale = clampCharacterScaleForDisplay(4, { x: feetX, y: feetY })
  const maxSize = getCharacterWindowSize(maxScale)

  // Only expand height upward — keep original width so the window X doesn't shift.
  // Cap height so window.y >= workArea.y, guaranteeing window.bottom == feetY.
  const expandedHeight = Math.min(maxSize.height, feetY - wa.y)
  const expandedWidth = oldBounds.width

  const pos = normalizeWindowPosition(
    { x: oldBounds.x, y: Math.round(feetY - expandedHeight) },
    { width: expandedWidth, height: expandedHeight }
  )
  win.setBounds({ x: pos.x, y: pos.y, width: expandedWidth, height: expandedHeight }, false)
  syncSpeechBubblePosition(characterId, pos)
}

export function resizeCharacterWindow(characterId: string, size: number): { position: { x: number; y: number }; size: number } | null {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return null

  const oldBounds = win.getBounds()
  const anchor = scaleModeAnchorFeet.get(characterId)
  const feetX = anchor?.x ?? (oldBounds.x + oldBounds.width / 2)
  const feetY = anchor?.y ?? (oldBounds.y + oldBounds.height)

  const scale = clampCharacterScaleForDisplay(Number.isFinite(size) ? size : 1, {
    x: feetX,
    y: feetY
  })
  const nextSize = getCharacterWindowSize(scale)
  const nextPosition = normalizeWindowPosition(
    {
      x: Math.round(feetX - nextSize.width / 2),
      y: Math.round(feetY - nextSize.height)
    },
    nextSize
  )

  win.setBounds({
    x: nextPosition.x,
    y: nextPosition.y,
    width: nextSize.width,
    height: nextSize.height
  }, false)
  syncSpeechBubblePosition(characterId, nextPosition)
  return { position: nextPosition, size: scale }
}

/** renderer 回報 sprite 的實際渲染高度（CSS 邏輯 px）；用於精確計算對白框頂端位置 */
export function updateSpriteActualHeight(characterId: string, h: number): void {
  if (Number.isFinite(h) && h > 0) {
    spriteActualHeights.set(characterId, Math.round(h))
  }
}

export function setCharacterWindowClickThrough(characterId: string, clickThrough: boolean): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false
  // forward: even when ignoring, still forward mouse move for hover effects where supported
  win.setIgnoreMouseEvents(clickThrough, { forward: true })
  return true
}

export function setCharacterInteractable(characterId: string, isInteractable: boolean): void {
  characterInteractableState.set(characterId, isInteractable)
  // 事件驅動模式：renderer 回報的瞬間直接生效，不等輪詢 tick。
  // 拖曳中由 drag 系直接控制 click-through，這裡跳過避免互相覆蓋。
  if (!eventDrivenHitTestEnabled) return
  // 狀態回報也是一種游標活動訊號，順手喚醒慢輪詢當安全網。
  notifyPointerActivity()
  if (activeDraggingCharacterId !== null || draggingCharacters.has(characterId)) return
  applyIgnoreMouse(characterId, isInteractable)
}

export function setCharacterHitRects(
  characterId: string,
  rects: { sprite: ScreenRect | null; buttons: ScreenRect | null } | null
): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false
  if (!rects) hitRects.delete(characterId)
  else hitRects.set(characterId, rects)
  ensureHitTestLoop()
  return true
}

export function setCharacterDragging(characterId: string, dragging: boolean): void {
  if (dragging) {
    draggingCharacters.add(characterId)
    activeDraggingCharacterId = characterId
    return
  }
  draggingCharacters.delete(characterId)
  if (activeDraggingCharacterId === characterId) activeDraggingCharacterId = null
}

function setBubbleOutlineMode(characterId: string, enabled: boolean): void {
  const bw = bubbleWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !bw.isVisible()) return
  bw.webContents.send('bubble:outline-mode', { characterId, enabled })
  // 外框參考模式不攔滑鼠，避免拖曳角色時被對白窗吃掉事件
  bw.setIgnoreMouseEvents(enabled, { forward: true })
}

function suppressOtherBubblesDuringDrag(activeCharacterId: string): void {
  for (const [id, bw] of bubbleWindows.entries()) {
    if (id === activeCharacterId) continue
    if (bw.isDestroyed() || !bw.isVisible()) continue
    bubblesSuppressedForDesktopDrag.set(id, true)
    setBubbleOutlineMode(id, true)
  }
}

function restoreBubblesSuppressedForDesktopDrag(): void {
  for (const [id] of bubblesSuppressedForDesktopDrag) {
    setBubbleOutlineMode(id, false)
  }
  bubblesSuppressedForDesktopDrag.clear()
}

export function beginCharacterDrag(
  characterId: string,
  startCursorX: number,
  startCursorY: number,
  onMove?: (position: { x: number; y: number }) => void
): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false

  if (bubbleHiddenForCharacterDrag.get(characterId)) {
    const b = bubbleWindows.get(characterId)
    if (b && !b.isDestroyed()) {
      b.setIgnoreMouseEvents(false)
      b.setOpacity(1)
      if (!b.isVisible()) b.showInactive()
      b.webContents.send('bubble:outline-mode', { characterId, enabled: false })
    }
    bubbleHiddenForCharacterDrag.delete(characterId)
  }

  endCharacterDrag(characterId)
  setCharacterDragging(characterId, true)
  bringCharacterToFront(characterId)
  // 使用者開始拖曳 → SPEAKING → IDLE（角色降回正常 band）
  demoteAfterSpeaking(characterId)
  suppressOtherBubblesDuringDrag(characterId)

  if (eventDrivenHitTestEnabled) {
    notifyPointerActivity()
    // 事件驅動模式沒有輪詢，拖曳開始時顯式設定：被拖角色保持互動，其他全部 click-through。
    for (const [id, cw] of characterWindows.entries()) {
      const shouldIgnore = id !== characterId
      if (lastIgnoreMouseState.get(id) !== shouldIgnore) {
        lastIgnoreMouseState.set(id, shouldIgnore)
        if (!cw.isDestroyed()) cw.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      }
    }
  }

  const startBounds = win.getBounds()
  bubbleUserOffsetSnapshotBeforeDrag.set(
    characterId,
    bubbleUserOffset.has(characterId)
      ? { ...(bubbleUserOffset.get(characterId) as { x: number; y: number }) }
      : null
  )
  const bwSnap = bubbleWindows.get(characterId)
  if (bwSnap && !bwSnap.isDestroyed() && bwSnap.isVisible()) {
    // The actively dragged character does not need a guide frame; hide its bubble
    // to reduce compositor work and avoid anchor drift accumulation.
    bwSnap.hide()
    bubbleHiddenForCharacterDrag.set(characterId, true)
  } else {
    bubbleHiddenForCharacterDrag.delete(characterId)
  }

  activeDragOffsets.set(characterId, {
    x: startCursorX - startBounds.x,
    y: startCursorY - startBounds.y
  })
  if (onMove) activeDragCallbacks.set(characterId, onMove)
  else activeDragCallbacks.delete(characterId)

  return true
}

export function moveDraggedCharacter(characterId: string, cursorScreenX: number, cursorScreenY: number): void {
  const offset = activeDragOffsets.get(characterId)
  if (!offset) return
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) { endCharacterDrag(characterId); return }
  const pos = {
    x: Math.round(cursorScreenX - offset.x),
    y: Math.round(cursorScreenY - offset.y)
  }
  if (!isSafeWindowCoordinate(pos.x) || !isSafeWindowCoordinate(pos.y)) return
  const last = activeDragLastPositions.get(characterId)
  if (last) {
    const dx = Math.abs(last.x - pos.x)
    const dy = Math.abs(last.y - pos.y)
    if (dx < 3 && dy < 3) return
  }
  try {
    win.setPosition(pos.x, pos.y)
  } catch (e) {
    console.error('[DesktopST] Failed to move dragged character window:', e)
    endCharacterDrag(characterId)
    return
  }
  activeDragLastPositions.set(characterId, pos)
  if (!bubbleHiddenForCharacterDrag.has(characterId)) {
    syncSpeechBubblePosition(characterId, pos)
  }
  activeDragCallbacks.get(characterId)?.(pos)
}

export function endCharacterDrag(characterId: string): { x: number; y: number } | null {
  activeDragOffsets.delete(characterId)
  activeDragCallbacks.delete(characterId)

  const win = getCharacterWindow(characterId)
  const pos = activeDragLastPositions.get(characterId)
    ?? (win && !win.isDestroyed()
      ? { x: win.getBounds().x, y: win.getBounds().y }
      : null)

  activeDragLastPositions.delete(characterId)
  setCharacterDragging(characterId, false)
  if (draggingCharacters.size === 0) {
    restoreBubblesSuppressedForDesktopDrag()
    // 事件驅動模式：拖曳結束後依 renderer 最後回報的 interactable 狀態復原所有角色。
    if (eventDrivenHitTestEnabled) reapplyAllIgnoreMouseFromState()
  }
  return pos
}

export function bringCharacterToFront(characterId: string): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false
  // Raise this character above other character windows only, without disturbing aux window z-order.
  win.moveTop()
  return true
}

export function getAllCharacterWindows(): BrowserWindow[] {
  return [...characterWindows.values()]
}

export function closeCharacterWindow(characterId: string): void {
  bubbleUserOffsetSnapshotBeforeDrag.delete(characterId)
  bubbleHiddenForCharacterDrag.delete(characterId)
  hideSpeechBubble(characterId)
  const win = characterWindows.get(characterId)
  if (win && !win.isDestroyed()) win.close()
}

/**
 * Destroys ALL character and bubble windows (tracked + orphans), then clears all
 * related state so the caller can recreate windows from scratch.  Used by the
 * "repair desktop" recovery flow when duplicate orphan windows exist.
 */
export function destroyAllCharacterWindows(): void {
  // Destroy tracked character windows and clear per-character state
  for (const [id, win] of [...characterWindows]) {
    characterWindows.delete(id)
    hitRects.delete(id)
    characterInteractableState.delete(id)
    lastIgnoreMouseState.delete(id)
    scaleModeAnchorFeet.delete(id)
    bubbleHiddenForCharacterDrag.delete(id)
    activeDragOffsets.delete(id)
    activeDragCallbacks.delete(id)
    activeDragLastPositions.delete(id)
    draggingCharacters.delete(id)
    characterSpeakingPromoted.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }

  // Destroy tracked bubble windows
  for (const [id, win] of [...bubbleWindows]) {
    cancelPendingBubbleReveal(id)
    bubbleWindows.delete(id)
    bubbleLastActiveAt.delete(id)
    bubbleUserOffset.delete(id)
    lastBubbleBoundsProgrammatic.delete(id)
    bubbleUserOffsetSnapshotBeforeDrag.delete(id)
    lastBubbleSizes.delete(id)
    lastBubbleShowPayload.delete(id)
    bubbleRepositionDone.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }
  lastShownBubbleCharacterId = null
  bubblesSuppressedForDesktopDrag.clear()

  // Destroy any orphan character/bubble windows not captured by our maps
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      const url = win.webContents.getURL()
      if (url.includes('w=character') || url.includes('w=bubble')) {
        win.destroy()
      }
    } catch { /* ignore destroyed / unloaded windows */ }
  }

  maybeStopHitTestLoop()
}

// ── Speech bubble windows (separate from character window) ──

export function getBubbleWindow(characterId: string): BrowserWindow | undefined {
  return bubbleWindows.get(characterId)
}

export function createBubbleWindow(characterId: string): BrowserWindow {
  const existing = bubbleWindows.get(characterId)
  if (existing && !existing.isDestroyed()) return existing

  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 280,
    height: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 隱藏期間 renderer 仍要能繪製：關閉時才畫得出「清空」幀（消除舊對白殘影），
      // 下次顯示前也能先把新對白畫好再現身
      backgroundThrottling: false
    }
  })

  // Keep the bubble clickable so its close button can work.
  win.setIgnoreMouseEvents(false)
  if (charactersAlwaysOnTop) win.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  else win.setAlwaysOnTop(false)
  win.setMinimumSize(180, 78)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'bubble', id: characterId }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { w: 'bubble', id: characterId } })
  }

  bubbleWindows.set(characterId, win)
  bubbleLastActiveAt.set(characterId, Date.now())
  win.on('closed', () => {
    cancelPendingBubbleReveal(characterId)
    // 旗標必須跟著清掉：重建的泡泡視窗 band 只看 charactersAlwaysOnTop，
    // 留著 stale 的 SPEAKING 旗標會讓其他 z-order 函式誤以為它還在 screen-saver band
    characterSpeakingPromoted.delete(characterId)
    bubbleWindows.delete(characterId)
    bubbleLastActiveAt.delete(characterId)
    bubbleUserOffset.delete(characterId)
    lastBubbleBoundsProgrammatic.delete(characterId)
    bubbleOffsetWriteSuppressedUntil.delete(characterId)
    bubbleUserOffsetSnapshotBeforeDrag.delete(characterId)
    bubbleHiddenForCharacterDrag.delete(characterId)
    lastBubbleShowPayload.delete(characterId)
    bubbleRepositionDone.delete(characterId)
    if (lastShownBubbleCharacterId === characterId) lastShownBubbleCharacterId = null
  })
  win.on('moved', () => {
    if (draggingCharacters.has(characterId)) return
    if (bubbleHiddenForCharacterDrag.get(characterId)) return
    const suppressUntil = bubbleOffsetWriteSuppressedUntil.get(characterId) ?? 0
    if (Date.now() < suppressUntil) return
    const bwMove = bubbleWindows.get(characterId)
    if (!bwMove || bwMove.isDestroyed()) return
    const br = bwMove.getBounds()
    const settled: WindowBoundsState = { x: br.x, y: br.y, width: br.width, height: br.height }
    const expected = lastBubbleBoundsProgrammatic.get(characterId)
    if (expected && bubbleBoundsNearlyEqual(settled, expected, BUBBLE_PROGRAMMATIC_BOUNDS_EPS)) return
    refreshBubbleUserOffsetFromWindow(characterId)
    lastBubbleBoundsProgrammatic.set(characterId, settled)
  })
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
  return win
}

// ── 後續聊天主題泡泡（單例） ────────────────────────────────────────────────
let topicBubbleWindow: BrowserWindow | null = null

/** 顯示／刷新主題泡泡（內容由 renderer 透過 news:get-topic 取得） */
export function showTopicBubbleWindow(): void {
  if (topicBubbleWindow && !topicBubbleWindow.isDestroyed()) {
    topicBubbleWindow.webContents.send('topic-bubble:refresh')
    topicBubbleWindow.showInactive()
    return
  }
  const wa = screen.getPrimaryDisplay().workArea
  const width = 360
  const height = 116
  const win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + 24,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setIgnoreMouseEvents(false)
  win.setAlwaysOnTop(true, 'screen-saver')
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'topic-bubble' }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { w: 'topic-bubble' } })
  }
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => { topicBubbleWindow = null })
  topicBubbleWindow = win
}

export function closeTopicBubbleWindow(): void {
  if (topicBubbleWindow && !topicBubbleWindow.isDestroyed()) topicBubbleWindow.close()
  topicBubbleWindow = null
}

function suppressBubbleOffsetWrite(characterId: string, ms = 240): void {
  bubbleOffsetWriteSuppressedUntil.set(characterId, Date.now() + ms)
}

function getBubbleAutoCloseMs(text: string): number {
  const normalized = String(text ?? '').trim()
  const charCount = normalized.length
  const lineCount = Math.max(1, normalized.split(/\r?\n/).length)
  return clamp(4500 + charCount * 180 + lineCount * 450, 8000, 90000)
}

function shouldKeepBubbleUntilClosed(text: string): boolean {
  const normalized = String(text ?? '').trim()
  const charCount = normalized.length
  const lineCount = Math.max(1, normalized.split(/\r?\n/).length)
  return charCount >= 220 || lineCount >= 6
}

export type BubbleAnchorFallback = {
  position: { x: number; y: number }
  size?: number
}

type CachedBubbleShowPayload = {
  speakerName: string
  text: string
  emotion: string
  anchorFallback?: BubbleAnchorFallback | null
  news?: BubbleNewsMeta | null
  messageId?: string
  reaction?: string | null
}

const lastBubbleShowPayload = new Map<string, CachedBubbleShowPayload>()
/** 等 renderer 畫好新對白（bubble:reveal）才顯示的泡泡；value 為保底逾時 timer，避免 renderer 沒回應時永遠不顯示 */
const pendingBubbleReveal = new Map<string, ReturnType<typeof setTimeout>>()

function cancelPendingBubbleReveal(characterId: string): void {
  const timer = pendingBubbleReveal.get(characterId)
  if (timer) clearTimeout(timer)
  pendingBubbleReveal.delete(characterId)
}

/** renderer 畫好新對白後回呼（IPC bubble:reveal），把透明現身中的泡泡調回不透明；保底逾時也走這裡 */
export function revealSpeechBubble(characterId: string): boolean {
  if (!pendingBubbleReveal.has(characterId)) return false
  cancelPendingBubbleReveal(characterId)
  const bw = bubbleWindows.get(characterId)
  if (!bw || bw.isDestroyed()) return false
  if (!bw.isVisible()) bw.showInactive()
  bw.setOpacity(1)
  raiseBubbleAndCharacterForShow(characterId, bw)
  return true
}
/** 已完成首次定位的角色泡泡，避免每次 show 都跑 180ms 重排 */
const bubbleRepositionDone = new Set<string>()

function resolveBubbleAnchorBounds(
  characterId: string,
  anchorFallback?: BubbleAnchorFallback | null
): { x: number; y: number; width: number; height: number } {
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) return cw.getBounds()

  const pos = anchorFallback?.position
  const scale = Number.isFinite(anchorFallback?.size) && (anchorFallback!.size! > 0)
    ? anchorFallback!.size!
    : 1
  if (pos) {
    const winSize = getCharacterWindowSize(scale)
    const normalized = normalizeWindowPosition(pos, winSize)
    return { x: normalized.x, y: normalized.y, width: winSize.width, height: winSize.height }
  }

  const wa = screen.getPrimaryDisplay().workArea
  const winSize = getCharacterWindowSize(1)
  return {
    x: Math.round(wa.x + (wa.width - winSize.width) / 2),
    y: Math.round(wa.y + (wa.height - winSize.height) / 2),
    width: winSize.width,
    height: winSize.height
  }
}

function pruneSpeechBubbleWindows(activeCharacterId: string): void {
  const candidates: Array<{ id: string; at: number; bw: BrowserWindow }> = []
  for (const [id, bw] of bubbleWindows.entries()) {
    if (id === activeCharacterId) continue
    if (!bw || bw.isDestroyed()) continue
    candidates.push({ id, at: bubbleLastActiveAt.get(id) ?? 0, bw })
  }
  const overflow = bubbleWindows.size - getBubbleConcurrentWindowLimit()
  if (overflow <= 0) return

  candidates.sort((a, b) => a.at - b.at)
  for (let i = 0; i < overflow && i < candidates.length; i += 1) {
    const victim = candidates[i]
    demoteAfterSpeaking(victim.id)
    victim.bw.destroy()
  }
}

// ── 角色分層狀態機 ─────────────────────────────────────────────────────
//
// 狀態：IDLE / SPEAKING
//   IDLE     → cw = 原始 band（floating 或 false）、bw = hidden 或 false
//   SPEAKING → cw = screen-saver、bw = screen-saver（角色跟泡泡一起置頂）
//
// 轉換：
//   promoteForSpeaking()  — → SPEAKING（setAlwaysOnTop + moveTop；冪等，連續發話重複呼叫也安全）
//   demoteAfterSpeaking() — SPEAKING → IDLE（恢復原始 band）
//
// 旗標只用來決定「該不該 demote」以及讓其他 z-order 函式避開發話中的角色，
// 不可拿來當「band 一定還正確」的保證（見 raiseBubbleAndCharacterForShow 註解）。

/**
 * IDLE → SPEAKING：把角色＋泡泡推到最高 band (screen-saver)。
 * 只在泡泡從 hidden 首次出現時呼叫。
 */
function promoteForSpeaking(characterId: string, bw: BrowserWindow): void {
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) {
    cw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    cw.moveTop()
  }
  bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  bw.moveTop()
  characterSpeakingPromoted.set(characterId, true)
}

/**
 * SPEAKING → IDLE：角色降回原始 band，泡泡也恢復。
 * 在泡泡被關閉、角色被拖曳時呼叫。
 */
function demoteAfterSpeaking(characterId: string): void {
  characterSpeakingPromoted.delete(characterId)
  // 恢復角色視窗
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) {
    if (charactersAlwaysOnTop) cw.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    else cw.setAlwaysOnTop(false)
  }
  // 恢復泡泡視窗（若仍存活；hide 時會由呼叫者處理 bw.hide()）
  const bw = bubbleWindows.get(characterId)
  if (bw && !bw.isDestroyed()) {
    if (charactersAlwaysOnTop) bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    else bw.setAlwaysOnTop(false)
  }
}

/**
 * 發言時把角色＋泡泡抬到前面。
 *
 * 一律走 promoteForSpeaking()（冪等）。曾經為了避開 DWM 副作用，SPEAKING→SPEAKING 只 moveTop
 * 不碰 setAlwaysOnTop，但那等於把 characterSpeakingPromoted 當成「泡泡此刻仍在 screen-saver band」
 * 的保證，而旗標會脫鉤（泡泡視窗重建、aux 搶前景改 band…），一脫鉤泡泡就再也回不到最上層，
 * 變成「角色跳上層、音效也響了，對白卻在後面看不到」。
 * 重繪問題現在由 showSpeechBubble 的透明→reveal 路徑處理（見 dispatchShow），不需再靠這裡省事。
 */
function raiseBubbleAndCharacterForShow(characterId: string, bw: BrowserWindow): void {
  promoteForSpeaking(characterId, bw)
}

export interface BubbleNewsMeta {
  id: string
  sourceId: string
  title: string
  url: string
  summary: string
  source: string
  keyword?: string
}

export function showSpeechBubble(
  characterId: string,
  speakerName: string,
  text: string,
  emotion?: string,
  anchorFallback?: BubbleAnchorFallback | null,
  newsMeta?: BubbleNewsMeta | null,
  reactionOpts?: { messageId?: string; reaction?: string | null }
): void {
  if (lastShownBubbleCharacterId && lastShownBubbleCharacterId !== characterId) {
    const previous = bubbleWindows.get(lastShownBubbleCharacterId)
    if (previous && !previous.isDestroyed() && previous.isVisible()) {
      previous.webContents.send('bubble:persist', { characterId: lastShownBubbleCharacterId })
      previous.webContents.send('bubble:latest-speaker', {
        characterId: lastShownBubbleCharacterId,
        isLatest: false
      })
    }
  }

  const bw = createBubbleWindow(characterId)
  if (bw.isDestroyed()) return
  bubbleLastActiveAt.set(characterId, Date.now())
  pruneSpeechBubbleWindows(characterId)

  const anchor = resolveBubbleAnchorBounds(characterId, anchorFallback)
  // 先撐到量測地板寬度（opacity 0 時使用者看不見），避免沿用上一句的窄 bounds
  // 導致 renderer 在 overflow:hidden 視窗內量到偏小的寬度、右邊圓角／按鈕被裁切
  const prevSize = lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }
  applyBubbleBounds(
    bw,
    {
      width: Math.max(prevSize.width, BUBBLE_MEASURE_FLOOR_WIDTH_PX),
      height: Math.max(prevSize.height, 120)
    },
    anchor,
    characterId
  )

  const payload = {
    characterId,
    speakerName,
    text,
    emotion: emotion ?? 'neutral',
    autoCloseMs: getBubbleAutoCloseMs(text),
    // 新聞泡泡帶有「作為後續聊天主題」等按鈕，保持顯示直到使用者關閉，避免按鈕被自動關掉
    persistUntilClosed: shouldKeepBubbleUntilClosed(text) || !!newsMeta,
    isLatestSpeaker: true,
    news: newsMeta ?? null,
    messageId: reactionOpts?.messageId,
    reaction: reactionOpts?.reaction ?? null
  }
  lastBubbleShowPayload.set(characterId, {
    speakerName,
    text,
    emotion: emotion ?? 'neutral',
    anchorFallback,
    news: newsMeta ?? null,
    messageId: reactionOpts?.messageId,
    reaction: reactionOpts?.reaction ?? null
  })

  const dispatchShow = () => {
    if (bw.isDestroyed()) return
    cancelPendingBubbleReveal(characterId)
    // 一律走「透明 → 繪製新對白 → reveal」：
    // - 隱藏中：compositor 不會在 hide 狀態產新畫面，直接 show 會殘留舊對白
    // - 已顯示：狀態機 SPEAKING→SPEAKING 只 moveTop、不碰 setAlwaysOnTop；
    //   Windows 透明視窗常因此不重繪內容，變成「角色跳上層了、文字還是上一句」
    const alreadyVisible = bw.isVisible()
    pendingBubbleReveal.set(characterId, setTimeout(() => revealSpeechBubble(characterId), 500))
    bw.setOpacity(0)
    if (!alreadyVisible) bw.showInactive()
    // 已可見時立刻 raise，讓角色跳上層的回饋不需等 measure；首次現身等 reveal 再 raise
    if (alreadyVisible) raiseBubbleAndCharacterForShow(characterId, bw)
    bw.webContents.send('bubble:show', payload)
  }
  // did-finish-load 早於 React useEffect 掛上 bubble:show listener。
  // 只送一次會丟事件 → 保底 reveal 把空窗調成不透明並 raise 角色，看起來像「人跳上層、對白沒出來」。
  // 提醒常在閒置後新建泡泡，特別容易踩到；比照 user-bubble 重送內容（不重跑透明流程）。
  const resendContent = () => {
    if (bw.isDestroyed()) return
    bw.webContents.send('bubble:show', payload)
  }
  const startShow = () => {
    if (bw.isDestroyed()) return
    // 發話泡泡應可讀；短暫壓制失焦半透明，避免 show 過程觸發 blur 把對白調到幾乎看不見
    suppressAuxAutoHide(1200)
    dispatchShow()
    setTimeout(resendContent, 80)
    setTimeout(resendContent, 260)
  }
  if (bw.webContents.isLoadingMainFrame()) {
    bw.webContents.once('did-finish-load', startShow)
  } else {
    startShow()
    if (!bubbleRepositionDone.has(characterId)) {
      bubbleRepositionDone.add(characterId)
      setTimeout(() => {
        if (bw.isDestroyed()) return
        const anchor2 = resolveBubbleAnchorBounds(characterId, anchorFallback)
        applyBubbleBounds(bw, lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }, anchor2, characterId)
        raiseBubbleAndCharacterForShow(characterId, bw)
      }, 180)
    }
  }
  lastShownBubbleCharacterId = characterId
}

export function persistSpeechBubble(characterId: string): void {
  const bw = bubbleWindows.get(characterId)
  if (!bw || bw.isDestroyed()) return
  bw.webContents.send('bubble:persist', { characterId })
}

export function hideSpeechBubble(characterId: string): boolean {
  const bw = bubbleWindows.get(characterId)
  if (!bw || bw.isDestroyed()) return false
  cancelPendingBubbleReveal(characterId)
  bubbleLastActiveAt.set(characterId, Date.now())
  bw.webContents.send('bubble:latest-speaker', { characterId, isLatest: false })
  bw.webContents.send('bubble:hide', { characterId })
  bw.hide()
  bubbleHiddenForCharacterDrag.delete(characterId)
  demoteAfterSpeaking(characterId)
  if (lastShownBubbleCharacterId === characterId) lastShownBubbleCharacterId = null
  return true
}

export function hideAllCharacterSpeechBubbles(): number {
  let hiddenCount = 0
  for (const [characterId, bw] of bubbleWindows.entries()) {
    cancelPendingBubbleReveal(characterId)
    if (bw.isDestroyed() || !bw.isVisible()) continue
    bw.webContents.send('bubble:latest-speaker', { characterId, isLatest: false })
    bw.webContents.send('bubble:hide', { characterId })
    bw.hide()
    bubbleHiddenForCharacterDrag.delete(characterId)
    demoteAfterSpeaking(characterId)
    hiddenCount += 1
  }
  lastShownBubbleCharacterId = null
  return hiddenCount
}

export function setUnfocusedBubbleOpacity(opacity: number): void {
  unfocusedBubbleOpacity = normalizeOpacity(opacity)
}

/** 使用者拖曳對白視窗（moved 與程式預期不符）時，把目前螢幕位置換算成相對錨點的偏移並寫入 bubbleUserOffset；此值之後跟隨角色移動，直到使用者再次拖對白。
 *  錨點高度必須與 applyBubbleBounds 使用的邏輯高度一致（lastBubbleSizes），不可用 bb.height 混算。 */
function getSpriteTop(cb: { y: number; height: number }, characterId: string): number {
  // sprite top = 視窗頂端 + 視窗高 - 底部偏移 - sprite高
  // spriteActualH 由 renderer 回報，已含縮放倍率（CSS 邏輯 px）
  // fallback: 以視窗高比例估算（與 getCharacterWindowSize 的 432/260 比例一致）
  const spriteH = spriteActualHeights.get(characterId) ?? Math.round((260 / 432) * cb.height)
  return Math.round(cb.y + cb.height - CHAR_WIN_BOTTOM_OFFSET_PX - spriteH)
}

function refreshBubbleUserOffsetFromWindow(characterId: string): void {
  if (draggingCharacters.has(characterId)) return
  const bw = bubbleWindows.get(characterId)
  const cw = characterWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !cw || cw.isDestroyed()) return
  const bb = bw.getBounds()
  const cb = cw.getBounds()
  const spriteTop = getSpriteTop(cb, characterId)
  const defaultX = Math.round(cb.x + 12)
  const stored = lastBubbleSizes.get(characterId)
  const anchorH = stored?.height ?? bb.height
  const defaultY = spriteTop - anchorH - BUBBLE_GAP_PX
  bubbleUserOffset.set(characterId, { x: bb.x - defaultX, y: bb.y - defaultY })
}

function applyBubbleBounds(
  bw: BrowserWindow,
  bubbleSize: { width: number; height: number },
  cb: { x: number; y: number; width: number; height: number },
  characterId: string
): void {
  const display = screen.getDisplayNearestPoint({ x: cb.x + Math.round(cb.width / 2), y: cb.y + Math.round(cb.height / 2) })
  const wa = display.workArea

  const rw = Math.round(Number(bubbleSize.width))
  const rh = Math.round(Number(bubbleSize.height))
  const width = Math.max(180, Math.min(BUBBLE_MAX_WIDTH_PX, Number.isFinite(rw) ? rw : 280))
  const height = Math.max(78, Math.min(BUBBLE_MAX_HEIGHT_PX, Number.isFinite(rh) ? rh : 120))

  const spriteTop = getSpriteTop(cb, characterId)

  const offset = bubbleUserOffset.get(characterId) ?? {
    x: BUBBLE_USER_OFFSET_DEFAULT.x,
    y: BUBBLE_USER_OFFSET_DEFAULT.y
  }
  const defaultX = Math.round(cb.x + 12)
  const defaultY = spriteTop - height - BUBBLE_GAP_PX
  const idealLeft = defaultX + offset.x
  const idealTop = Math.round(defaultY + offset.y)

  const minX = wa.x
  const maxX = wa.x + wa.width - width
  let x = Math.round(idealLeft)
  if (maxX >= minX) {
    x = clamp(x, minX, maxX)
  } else {
    x = Math.round(wa.x + Math.max(0, wa.width - width) / 2)
  }

  // Keep the top drag area on-screen so an oversized or edge-positioned bubble is always recoverable.
  const maxY = wa.y + Math.max(0, wa.height - BUBBLE_MIN_VISIBLE_DRAG_PX)
  const y = clamp(idealTop, wa.y, maxY)

  bw.setBounds({ x, y, width, height }, false)
  const settled = bw.getBounds()
  lastBubbleSizes.set(characterId, { width: settled.width, height: settled.height })
  lastBubbleBoundsProgrammatic.set(characterId, {
    x: settled.x,
    y: settled.y,
    width: settled.width,
    height: settled.height
  })
}

export function updateSpeechBubbleSize(characterId: string, size: { width: number; height: number }): boolean {
  const bw = bubbleWindows.get(characterId)
  const cw = characterWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !cw || cw.isDestroyed()) return false
  lastBubbleSizes.set(characterId, size)
  applyBubbleBounds(bw, size, cw.getBounds(), characterId)
  // 尺寸更新只維持 z-order，不重複 setAlwaysOnTop（狀態機原則；避免 DWM 副作用）
  if (bw.isVisible()) bw.moveTop()
  return true
}

// charPos: pass the position just sent to setPosition() to avoid reading stale getBounds() during drag.
export function syncSpeechBubblePosition(characterId: string, charPos?: { x: number; y: number }): boolean {
  const bw = bubbleWindows.get(characterId)
  const cw = characterWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !cw || cw.isDestroyed()) return false
  const bb = bw.getBounds()
  const cb = cw.getBounds()
  const size = lastBubbleSizes.get(characterId) ?? { width: bb.width, height: bb.height }
  const roundedPos = charPos ? { x: Math.round(charPos.x), y: Math.round(charPos.y) } : null
  applyBubbleBounds(bw, size, roundedPos ? { ...cb, ...roundedPos } : cb, characterId)
  return true
}

/** 角色拖曳結束：同步對白錨點（沿用既有 bubbleUserOffset，不重置）；拖曳中曾隱藏對白則再顯示。 */
export function reconcileSpeechBubbleAfterCharacterDrag(characterId: string): void {
  const hadHiddenBubble = bubbleHiddenForCharacterDrag.get(characterId) === true
  const offsetSnapshot = bubbleUserOffsetSnapshotBeforeDrag.get(characterId)
  bubbleUserOffsetSnapshotBeforeDrag.delete(characterId)
  suppressBubbleOffsetWrite(characterId, 280)
  if (offsetSnapshot) bubbleUserOffset.set(characterId, { ...offsetSnapshot })
  else bubbleUserOffset.delete(characterId)

  // Realign from current character window bounds instead of drag snapshot to avoid
  // gradual anchor drift after repeated drags under load.
  syncSpeechBubblePosition(characterId)

  if (hadHiddenBubble) {
    const bw = bubbleWindows.get(characterId)
    if (bw && !bw.isDestroyed()) {
      bw.setIgnoreMouseEvents(false)
      bw.webContents.send('bubble:outline-mode', { characterId, enabled: false })
      bw.setOpacity(1)
      bw.showInactive()
      // 拖曳結束、泡泡重現 → IDLE → SPEAKING
      promoteForSpeaking(characterId, bw)
    }
  }
  bubbleHiddenForCharacterDrag.delete(characterId)
}

// ── Input window ──────────────────────────────────────────

let inputWindow: BrowserWindow | null = null
let userBubbleWindow: BrowserWindow | null = null
let userBubbleSize: { width: number; height: number } = { width: 400, height: 120 }

export function createInputWindow(position: { x: number; y: number }): BrowserWindow {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.setOpacity(1)
    inputWindow.setResizable(true)
    inputWindow.setMinimumSize(280, 104)
    inputWindow.setIgnoreMouseEvents(false)
    inputWindow.setAlwaysOnTop(true, 'pop-up-menu')
    if (!inputWindow.isVisible()) inputWindow.show()
    raiseAuxAboveCharacters()
    inputWindow.moveTop()
    inputWindow.focus()
    raiseCharactersAbovePinnedNotes()
    return inputWindow
  }

  const savedBounds = getInitialAuxBounds('input')
  const initialBounds = getSavedAuxBounds?.('input') ? savedBounds : { ...savedBounds, x: position.x, y: position.y }
  const inputTargetBounds = {
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height
  }
  // Windows 混合 DPI workaround：見 createPinnedNoteWindow 同段註解
  inputWindow = new BrowserWindow({
    ...inputTargetBounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  rememberAuxBounds('input', inputWindow)
  // Higher than character alwaysOnTop windows
  inputWindow.setIgnoreMouseEvents(false)
  inputWindow.setAlwaysOnTop(true, 'pop-up-menu')
  inputWindow.setMinimumSize(280, 104)

  if (VITE_DEV_SERVER_URL) {
    inputWindow.loadURL(makeURL({ w: 'input' }))
  } else {
    inputWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'input' }
    })
  }

  inputWindow.on('closed', () => { inputWindow = null })
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    inputWindow.webContents.openDevTools({ mode: 'detach' })
  }
  inputWindow.show()
  inputWindow.setBounds(inputTargetBounds)
  inputWindow.setOpacity(1)
  raiseAuxAboveCharacters()
  inputWindow.moveTop()
  inputWindow.focus()
  raiseCharactersAbovePinnedNotes()
  return inputWindow
}

export function toggleInputWindow(position?: { x: number; y: number }): void {
  if (!inputWindow || inputWindow.isDestroyed()) {
    const fallback = defaultInputBounds()
    createInputWindow(position ?? { x: fallback.x, y: fallback.y })
    return
  }
  if (inputWindow.isVisible()) {
    if (lowPerformanceModeEnabled) inputWindow.destroy()
    else inputWindow.hide()
  } else {
    inputWindow.setOpacity(1)
    inputWindow.setResizable(true)
    inputWindow.setMinimumSize(280, 104)
    inputWindow.show()
    raiseAuxAboveCharacters()
    inputWindow.moveTop()
    inputWindow.focus()
    raiseCharactersAbovePinnedNotes()
  }
}

export function getInputWindow(): BrowserWindow | null {
  return inputWindow && !inputWindow.isDestroyed() ? inputWindow : null
}

export function createUserBubbleWindow(): BrowserWindow {
  if (userBubbleWindow && !userBubbleWindow.isDestroyed()) return userBubbleWindow

  const initial = defaultUserBubbleBounds()
  const width = clamp(Math.round(initial.width), 220, 1200)
  const height = clamp(Math.round(initial.height), 78, BUBBLE_MAX_HEIGHT_PX)
  const pos = normalizeWindowPosition({ x: initial.x, y: initial.y }, { width, height })

  userBubbleWindow = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  userBubbleWindow.setIgnoreMouseEvents(false)
  userBubbleWindow.setAlwaysOnTop(true, 'pop-up-menu')
  userBubbleWindow.setMinimumSize(220, 78)

  if (VITE_DEV_SERVER_URL) {
    userBubbleWindow.loadURL(makeURL({ w: 'user-bubble' }))
  } else {
    userBubbleWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { w: 'user-bubble' } })
  }

  userBubbleWindow.on('closed', () => {
    userBubbleWindow = null
  })

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    userBubbleWindow.webContents.openDevTools({ mode: 'detach' })
  }

  return userBubbleWindow
}

export function showUserSpeechBubble(speakerName: string, text: string): void {
  const bw = createUserBubbleWindow()
  if (bw.isDestroyed()) return

  const input = getInputWindow()
  const targetWidth = clamp(
    Math.round(input && !input.isDestroyed() ? input.getBounds().width : userBubbleSize.width),
    220,
    1200
  )
  const current = bw.getBounds()
  const pos = normalizeWindowPosition(
    { x: current.x, y: current.y },
    { width: targetWidth, height: current.height }
  )
  bw.setBounds({ x: pos.x, y: pos.y, width: targetWidth, height: current.height }, false)

  const payload = {
    speakerName,
    text,
    persistUntilClosed: true
  }
  const dispatchShow = () => {
    if (bw.isDestroyed()) return
    bw.setAlwaysOnTop(true, 'pop-up-menu')
    bw.setOpacity(1)
    if (!bw.isVisible()) bw.showInactive()
    bw.moveTop()
    bw.webContents.send('user-bubble:show', payload)
  }
  if (bw.webContents.isLoadingMainFrame()) {
    bw.webContents.once('did-finish-load', dispatchShow)
  } else {
    dispatchShow()
  }
  setTimeout(dispatchShow, 80)
  setTimeout(dispatchShow, 260)
}

export function updateUserSpeechBubbleSize(size: { width?: number; height: number }): boolean {
  const bw = userBubbleWindow
  if (!bw || bw.isDestroyed()) return false
  const current = bw.getBounds()
  const width = current.width
  const height = clamp(Math.round(Number(size.height) || current.height), 78, BUBBLE_MAX_HEIGHT_PX)
  const pos = normalizeWindowPosition({ x: current.x, y: current.y }, { width, height })
  userBubbleSize = { width, height }
  bw.setBounds({ x: pos.x, y: pos.y, width, height }, false)
  bw.setAlwaysOnTop(true, 'pop-up-menu')
  if (bw.isVisible()) bw.moveTop()
  return true
}

export function hideUserSpeechBubble(): boolean {
  const bw = userBubbleWindow
  if (!bw || bw.isDestroyed()) return false
  bw.hide()
  return true
}

export function hideAuxWindowsRememberingState(): void {
  if (lowPerformanceModeEnabled) return
  for (const [characterId, w] of bubbleWindows.entries()) {
    if (!w.isVisible()) continue
    // 發話中／正等待 reveal 的對白保持全不透明（提醒觸發時常在 App 失焦狀態）
    if (characterSpeakingPromoted.get(characterId) || pendingBubbleReveal.has(characterId)) continue
    w.setOpacity(unfocusedBubbleOpacity)
  }
  for (const w of getAuxWindows()) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue
    // 設定／角色庫需長時間對照他處（例如貼 API Key），失焦時勿縮到幾乎看不見
    if (w === settingsWindow || w === characterLibraryWindow) continue
    w.setOpacity(unfocusedBubbleOpacity)
  }
}

export function restoreAuxWindowsFromRememberedState(): void {
  if (lowPerformanceModeEnabled) return
  for (const w of bubbleWindows.values()) {
    if (w.isVisible()) w.setOpacity(1)
  }
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && getAuxWindows().includes(focused)) focused.setOpacity(1)
}

function collectAllDesktopSTWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = []
  for (const w of characterWindows.values()) {
    if (!w.isDestroyed()) wins.push(w)
  }
  for (const w of bubbleWindows.values()) {
    if (!w.isDestroyed()) wins.push(w)
  }
  for (const w of pinnedNoteWindows.values()) {
    if (!w.isDestroyed()) wins.push(w)
  }
  for (const w of [
    inputWindow,
    userBubbleWindow,
    logWindow,
    settingsWindow,
    characterLibraryWindow,
    previewWindow,
    emojiPickerWindow,
    pinnedNotesManagerWindow,
    remindersManagerWindow,
    pinnedNoteColorMenuWindow,
    newsReaderWindow
  ]) {
    if (w && !w.isDestroyed()) wins.push(w)
  }
  return wins
}

function getScreenshotDisplayInfo(): { displayId: number; displayWidth: number; displayHeight: number } {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  return { displayId: display.id, displayWidth: display.size.width, displayHeight: display.size.height }
}

function getScreenshotDisplayInfoByIndex(displayIndex: number): { displayId: number; displayWidth: number; displayHeight: number } {
  const displays = screen.getAllDisplays()
  const display = displays[displayIndex] ?? screen.getPrimaryDisplay()
  return { displayId: display.id, displayWidth: display.size.width, displayHeight: display.size.height }
}

/** Hide every DesktopST window before capturing the screen (pure desktop). */
export function hideAllWindowsForScreenshot(displayIndex?: number): { displayId: number; displayWidth: number; displayHeight: number } {
  for (const w of collectAllDesktopSTWindows()) {
    w.setOpacity(0)
  }
  return displayIndex != null ? getScreenshotDisplayInfoByIndex(displayIndex) : getScreenshotDisplayInfo()
}

/** Keep all DesktopST windows visible; optionally hide input window. */
export function prepareScreenshotKeepingDesktopST(hideInputWindow: boolean = false, displayIndex?: number): { displayId: number; displayWidth: number; displayHeight: number } {
  if (hideInputWindow) {
    const input = getInputWindow()
    if (input && !input.isDestroyed()) {
      input.setOpacity(0)
    }
  }
  return displayIndex != null ? getScreenshotDisplayInfoByIndex(displayIndex) : getScreenshotDisplayInfo()
}

export function restoreAllWindowsAfterScreenshot(): void {
  for (const w of collectAllDesktopSTWindows()) {
    if (w.isVisible()) w.setOpacity(1)
  }
}

// 遙控模式用：隱藏所有 DeST 視窗，記錄哪些是可見的以便稍後恢復
let remoteHiddenWindows: BrowserWindow[] = []

export function hideAllWindowsForRemote(): void {
  remoteHiddenWindows = []
  for (const w of collectAllDesktopSTWindows()) {
    if (!w.isDestroyed() && w.isVisible()) {
      w.hide()
      remoteHiddenWindows.push(w)
    }
  }
}

export function restoreAllWindowsAfterRemote(): void {
  for (const w of remoteHiddenWindows) {
    if (!w.isDestroyed()) w.show()
  }
  remoteHiddenWindows = []
}

export function raiseAllCharactersAboveAux(): void {
  charactersRaisedAboveAux = true
  if (!charactersAlwaysOnTop) return
  for (const [id, w] of characterWindows.entries()) {
    if (w.isDestroyed()) continue
    // 發話中的角色留在 screen-saver band，別踢回 pop-up-menu
    if (!characterSpeakingPromoted.get(id)) w.setAlwaysOnTop(true, 'pop-up-menu')
    w.moveTop()
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    w.moveTop()
  }
}

export function raiseAuxAboveCharacters(): void {
  charactersRaisedAboveAux = false
  for (const [id, w] of characterWindows.entries()) {
    if (w.isDestroyed()) continue
    if (characterSpeakingPromoted.get(id)) continue // 發話中：維持 SPEAKING band
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    w.moveTop()
  }
  for (const [id, w] of bubbleWindows.entries()) {
    if (w.isDestroyed()) continue
    if (characterSpeakingPromoted.get(id)) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }
}

export function raiseAuxWindowToFront(target: BrowserWindow): boolean {
  if (!target || target.isDestroyed()) return false
  charactersRaisedAboveAux = false

  for (const [id, w] of characterWindows.entries()) {
    if (w.isDestroyed()) continue
    if (characterSpeakingPromoted.get(id)) continue // 發話中：維持 SPEAKING band
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  }
  for (const [id, w] of bubbleWindows.entries()) {
    if (w.isDestroyed()) continue
    if (characterSpeakingPromoted.get(id)) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }

  target.moveTop()
  target.setOpacity(1)
  for (const [id, w] of bubbleWindows.entries()) {
    if (w.isDestroyed() || !w.isVisible()) continue
    if (characterSpeakingPromoted.get(id)) { w.moveTop(); continue }
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    w.moveTop()
  }
  if (target.isVisible()) {
    target.focus()
    target.webContents.focus()
  }
  return true
}

export function areCharactersRaisedAboveAux(): boolean {
  return charactersRaisedAboveAux
}

// ── Log window ────────────────────────────────────────────

let logWindow: BrowserWindow | null = null

function ensureLogWindow(): BrowserWindow {
  if (!logWindow || logWindow.isDestroyed()) {
    const initialBounds = getInitialAuxBounds('log')
    const logTargetBounds = {
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height
    }
    // Windows 混合 DPI workaround：見 createPinnedNoteWindow 同段註解
    logWindow = new BrowserWindow({
      ...logTargetBounds,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#F7FFFC',
      skipTaskbar: false,
      alwaysOnTop: true,
      icon: getAppIcon(),
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    rememberAuxBounds('log', logWindow)
    logWindow.once('show', () => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.setBounds(logTargetBounds)
    })
    logWindow.setAlwaysOnTop(true, 'pop-up-menu')
    if (VITE_DEV_SERVER_URL) {
      logWindow.loadURL(makeURL({ w: 'log' }))
    } else {
      logWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { w: 'log' }
      })
    }
    logWindow.on('closed', () => { logWindow = null })
    logWindow.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'killed') return
      console.error('[DesktopST] log window renderer gone:', details.reason)
      if (!logWindow || logWindow.isDestroyed()) return
      logWindow.webContents.reload()
    })
  }
  return logWindow
}

function focusLogTitleInput(win: BrowserWindow): void {
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('log:focus-title-input')
    })
  } else {
    win.webContents.send('log:focus-title-input')
  }
}

export function openLogWindow(options?: { focusTitleInput?: boolean }): void {
  const win = ensureLogWindow()
  win.setOpacity(1)
  if (!win.isVisible()) win.show()
  raiseAuxAboveCharacters()
  win.moveTop()
  win.focus()
  win.setAlwaysOnTop(true, 'pop-up-menu')
  if (options?.focusTitleInput) focusLogTitleInput(win)
}

export function toggleLogWindow(): void {
  const win = ensureLogWindow()
  if (win.isVisible()) {
    win.destroy()
    return
  }
  openLogWindow()
}

export function getLogWindow(): BrowserWindow | null {
  return logWindow && !logWindow.isDestroyed() ? logWindow : null
}

// ── Settings window ───────────────────────────────────────

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(tab?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setOpacity(1)
    settingsWindow.show()
    raiseAuxAboveCharacters()
    settingsWindow.moveTop()
    settingsWindow.focus()
    if (tab) settingsWindow.webContents.send('settings:navigate-tab', tab)
    return
  }
  const wa = screen.getPrimaryDisplay().workArea
  const sw = 680
  const sh = 580
  settingsWindow = new BrowserWindow({
    x: Math.round(wa.x + Math.max(0, (wa.width - sw) / 2)),
    y: Math.round(wa.y + Math.min(80, Math.max(0, (wa.height - sh) / 4))),
    width: sw,
    height: sh,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  settingsWindow.setAlwaysOnTop(true, 'pop-up-menu')
  const query: Record<string, string> = { w: 'settings' }
  if (tab) query.tab = tab
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(makeURL(query))
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }
  settingsWindow.on('closed', () => { settingsWindow = null })
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    settingsWindow.webContents.openDevTools({ mode: 'detach' })
  }
  settingsWindow.show()
  settingsWindow.setOpacity(1)
  raiseAuxAboveCharacters()
  settingsWindow.moveTop()
  settingsWindow.focus()
}

// ── Image preview window ──────────────────────────────────

let previewWindow: BrowserWindow | null = null

type PreviewPayload = { images: string[]; index: number }

function normalizePreviewPayload(payload: string | PreviewPayload): PreviewPayload {
  if (typeof payload === 'string') {
    return { images: payload ? [payload] : [], index: 0 }
  }
  const images = Array.isArray(payload.images)
    ? payload.images.filter(x => typeof x === 'string' && x.trim().length > 0)
    : []
  const maxIndex = Math.max(0, images.length - 1)
  const index = Math.min(maxIndex, Math.max(0, Math.floor(Number(payload.index) || 0)))
  return { images, index }
}

function sendImageToPreview(win: BrowserWindow, payload: PreviewPayload): void {
  if (!win.isDestroyed()) win.webContents.send('preview:set-image', payload)
}

export function showPreviewWindow(payloadInput: string | PreviewPayload): void {
  const payload = normalizePreviewPayload(payloadInput)
  if (payload.images.length === 0) return

  if (previewWindow && !previewWindow.isDestroyed()) {
    sendImageToPreview(previewWindow, payload)
    previewWindow.setOpacity(1)
    previewWindow.show()
    previewWindow.moveTop()
    previewWindow.focus()
    return
  }

  const wa = screen.getPrimaryDisplay().workArea
  const winWidth = Math.min(1200, Math.round(wa.width * 0.75))
  const winHeight = Math.min(840, Math.round(wa.height * 0.75))

  previewWindow = new BrowserWindow({
    show: false,
    width: winWidth,
    height: winHeight,
    x: Math.round(wa.x + (wa.width - winWidth) / 2),
    y: Math.round(wa.y + (wa.height - winHeight) / 2),
    frame: false,
    transparent: false,
    backgroundColor: '#2B3A35',
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: getAppIcon(),
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  previewWindow.setAlwaysOnTop(true, 'pop-up-menu')

  if (VITE_DEV_SERVER_URL) {
    previewWindow.loadURL(makeURL({ w: 'preview' }))
  } else {
    previewWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'preview' }
    })
  }

  const win = previewWindow
  // Wait for page + React to be ready, then push the image and show
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      sendImageToPreview(win, payload)
      win.show()
      win.moveTop()
      win.focus()
    }, 150)
  })

  previewWindow.on('closed', () => { previewWindow = null })
}

// ── Emoji Picker ──────────────────────────────────────────

let emojiPickerWindow: BrowserWindow | null = null

export function createEmojiPickerWindow(
  x: number,
  y: number,
  onMoved?: (offset: { x: number; y: number }) => void
): BrowserWindow {
  if (emojiPickerWindow && !emojiPickerWindow.isDestroyed()) {
    emojiPickerWindow.destroy()
    emojiPickerWindow = null
  }

  const W = 352
  const H = 460
  const display = screen.getDisplayNearestPoint({ x, y })
  const wa = display.workArea
  // Clamp into visible work area
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - W))
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - H))

  const targetBounds = { x, y, width: W, height: H }
  emojiPickerWindow = new BrowserWindow({
    ...targetBounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  emojiPickerWindow.setAlwaysOnTop(true, 'pop-up-menu')

  if (VITE_DEV_SERVER_URL) {
    emojiPickerWindow.loadURL(makeURL({ w: 'emoji-picker' }))
  } else {
    emojiPickerWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'emoji-picker' }
    })
  }

  emojiPickerWindow.once('ready-to-show', () => {
    if (emojiPickerWindow && !emojiPickerWindow.isDestroyed()) {
      emojiPickerWindow.show()
      emojiPickerWindow.setBounds(targetBounds)
    }
  })

  if (onMoved) {
    emojiPickerWindow.on('moved', () => {
      const ep = emojiPickerWindow
      const iw = inputWindow
      if (!ep || ep.isDestroyed() || !iw || iw.isDestroyed()) return
      const eb = ep.getBounds()
      const ib = iw.getBounds()
      onMoved({ x: eb.x - ib.x, y: eb.y - ib.y })
    })
  }

  emojiPickerWindow.on('closed', () => { emojiPickerWindow = null })
  return emojiPickerWindow
}

export function closeEmojiPickerWindow(): void {
  if (emojiPickerWindow && !emojiPickerWindow.isDestroyed()) {
    emojiPickerWindow.destroy()
    emojiPickerWindow = null
  }
}

export function getEmojiPickerWindow(): BrowserWindow | null {
  return emojiPickerWindow && !emojiPickerWindow.isDestroyed() ? emojiPickerWindow : null
}

// ── Random Tools ──────────────────────────────────────────

let randomToolsWindow: BrowserWindow | null = null

export function createRandomToolsWindow(anchorX: number, anchorY: number): BrowserWindow {
  if (randomToolsWindow && !randomToolsWindow.isDestroyed()) {
    randomToolsWindow.destroy()
    randomToolsWindow = null
  }

  const W = 320
  const H = 440
  const display = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY })
  const wa = display.workArea
  const x = Math.max(wa.x, Math.min(anchorX, wa.x + wa.width - W))
  const y = Math.max(wa.y, Math.min(anchorY - H, wa.y + wa.height - H))

  const targetBounds = { x, y, width: W, height: H }
  randomToolsWindow = new BrowserWindow({
    ...targetBounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  randomToolsWindow.setAlwaysOnTop(true, 'pop-up-menu')

  if (VITE_DEV_SERVER_URL) {
    randomToolsWindow.loadURL(makeURL({ w: 'random-tools' }))
  } else {
    randomToolsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'random-tools' }
    })
  }

  randomToolsWindow.once('ready-to-show', () => {
    if (randomToolsWindow && !randomToolsWindow.isDestroyed()) {
      randomToolsWindow.show()
      randomToolsWindow.setBounds(targetBounds)
    }
  })

  randomToolsWindow.on('closed', () => { randomToolsWindow = null })
  return randomToolsWindow
}

export function closeRandomToolsWindow(): void {
  if (randomToolsWindow && !randomToolsWindow.isDestroyed()) {
    randomToolsWindow.destroy()
    randomToolsWindow = null
  }
}

export function getRandomToolsWindow(): BrowserWindow | null {
  return randomToolsWindow && !randomToolsWindow.isDestroyed() ? randomToolsWindow : null
}

// ── Pinned Notes ──────────────────────────────────────────

export function createPinnedNoteWindow(
  noteId: string,
  position: { x: number; y: number },
  content: string,
  title = '便利貼',
  color = '#FFE8AA',
  size?: { width: number; height: number },
  fontSize?: number,
  options?: { skipActivation?: boolean }
): BrowserWindow {
  if (pinnedNoteWindows.has(noteId)) {
    const old = pinnedNoteWindows.get(noteId)
    if (old && !old.isDestroyed()) old.destroy()
    pinnedNoteWindows.delete(noteId)
  }

  const winW = clamp(size?.width ?? 280, 100, 800)
  const winH = clamp(size?.height ?? 200, 60, 800)
  const normalizedPos = normalizeWindowPosition(position, { width: winW, height: winH })
  const targetBounds = { x: normalizedPos.x, y: normalizedPos.y, width: winW, height: winH }

  // Windows 混合 DPI workaround：先用建構式定位（讓視窗在隱藏狀態就被附著到正確螢幕），
  // 等 show() 之後 DPI context 穩定，再 setBounds 強制套用正確尺寸；
  // 否則 Windows 會在 show 時依舊 DPI 比例自動放大／縮小（每次 ×1.5 累積放大）。
  const win = new BrowserWindow({
    ...targetBounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setMinimumSize(100, 60)
  win.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)

  const savePinnedBounds = () => {
    if (win.isDestroyed()) return
    const b = getWindowBoundsState(win)
    if (b) onPinnedNoteBoundsChanged?.(noteId, b)
  }
  win.on('moved', savePinnedBounds)
  win.on('resized', savePinnedBounds)

  const noteQuery: Record<string, string> = {
    w: 'pinned-note',
    noteId,
    color,
    title: title || '便利貼',
    content: content || '',
  }
  if (fontSize != null) noteQuery.fontSize = String(fontSize)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL(noteQuery))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: noteQuery })
  }

  win.on('closed', () => {
    pinnedNoteWindows.delete(noteId)
  })

  // When a pinned note receives focus, keep it above other notes but below characters.
  win.on('focus', () => {
    win.moveTop()
    raiseCharactersAbovePinnedNotes()
  })

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  pinnedNoteWindows.set(noteId, win)
  if (options?.skipActivation) {
    // 背景建立（不奪焦）：直接 showInactive → setBounds（DPI workaround）
    win.showInactive()
    win.setBounds(targetBounds)
  } else {
    // 前景建立：等 React 第一幀渲染完才顯示，避免空白視窗閃爍
    // 仍需 show → setBounds 順序以穩定 DPI context
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      win.setBounds(targetBounds)
      raiseAuxAboveCharacters()
      win.moveTop()
      raiseCharactersAbovePinnedNotes()
    })
  }
  return win
}

export function updatePinnedNoteContent(noteId: string, content: string): void {
  const win = pinnedNoteWindows.get(noteId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('pinned-note:update-content', { noteId, content })
  }
}

export function updatePinnedNoteColor(noteId: string, color: string): void {
  const win = pinnedNoteWindows.get(noteId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('pinned-note:update-color', { noteId, color })
  }
}

export function closePinnedNote(noteId: string): void {
  const win = pinnedNoteWindows.get(noteId)
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
  pinnedNoteWindows.delete(noteId)
}

export function focusPinnedNoteWindow(noteId: string): boolean {
  const win = pinnedNoteWindows.get(noteId)
  if (!win || win.isDestroyed()) return false
  win.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  if (!win.isVisible()) win.showInactive()
  win.moveTop()
  if (win.isFocusable()) win.focus()
  raiseCharactersAbovePinnedNotes()
  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.moveTop()
      raiseCharactersAbovePinnedNotes()
    }
  }, 40)
  return true
}

export function getPinnedNoteWindow(noteId: string): BrowserWindow | undefined {
  const win = pinnedNoteWindows.get(noteId)
  return win && !win.isDestroyed() ? win : undefined
}

export function getVisiblePinnedNoteWindowIds(): string[] {
  return [...pinnedNoteWindows.entries()]
    .filter(([, win]) => win && !win.isDestroyed() && win.isVisible())
    .map(([noteId]) => noteId)
}

// ── Pinned Notes Manager ──────────────────────────────────

export async function getPinnedNoteWindowState(noteId: string): Promise<WindowBoundsState | null> {
  const win = getPinnedNoteWindow(noteId)
  if (!win) return null
  return getWindowBoundsState(win)
}

let pinnedNotesManagerWindow: BrowserWindow | null = null
let remindersManagerWindow: BrowserWindow | null = null
let remoteControlLogWindow: BrowserWindow | null = null
let pinnedNoteColorMenuWindow: BrowserWindow | null = null

type ScreenBounds = { x: number; y: number; width: number; height: number }

export function showPinnedNoteColorMenu(noteId: string, currentColor: string, anchor?: ScreenBounds): boolean {
  const noteWin = getPinnedNoteWindow(noteId)
  if (!noteWin || noteWin.isDestroyed()) return false

  const nb = noteWin.getBounds()
  const menuSize = { width: 168, height: 330 }
  const anchorRect = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
    ? anchor
    : { x: nb.x, y: nb.y, width: nb.width, height: 24 }
  const display = screen.getDisplayNearestPoint({ x: anchorRect.x, y: anchorRect.y })
  const wa = display.workArea
  const gap = 8
  const anchorLeftX = anchorRect.x - menuSize.width - gap
  const anchorRightX = anchorRect.x + anchorRect.width + gap
  const noteLeftX = nb.x - menuSize.width - gap
  const noteRightX = nb.x + nb.width + gap
  const maxX = wa.x + Math.max(0, wa.width - menuSize.width)
  const x = anchorLeftX >= wa.x
    ? anchorLeftX
    : anchorRightX <= maxX
      ? anchorRightX
      : noteLeftX >= wa.x
        ? noteLeftX
        : noteRightX <= maxX
          ? noteRightX
          : clamp(anchorLeftX, wa.x, maxX)
  const idealY = anchorRect.y + Math.round((anchorRect.height - menuSize.height) / 2)
  const y = clamp(idealY, wa.y, wa.y + Math.max(0, wa.height - menuSize.height))
  const bounds = { x, y, width: menuSize.width, height: menuSize.height }

  if (!pinnedNoteColorMenuWindow || pinnedNoteColorMenuWindow.isDestroyed()) {
    pinnedNoteColorMenuWindow = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    pinnedNoteColorMenuWindow.setAlwaysOnTop(true, 'pop-up-menu')
    pinnedNoteColorMenuWindow.loadURL(makeURL({ w: 'pinned-note-color-menu', noteId, color: currentColor }))
    pinnedNoteColorMenuWindow.on('blur', () => {
      if (pinnedNoteColorMenuWindow && !pinnedNoteColorMenuWindow.isDestroyed()) {
        pinnedNoteColorMenuWindow.hide()
      }
    })
    pinnedNoteColorMenuWindow.on('close', (event) => {
      if (pinnedNoteColorMenuWindow && !pinnedNoteColorMenuWindow.isDestroyed()) {
        event.preventDefault()
        pinnedNoteColorMenuWindow.hide()
      }
    })
    pinnedNoteColorMenuWindow.on('closed', () => {
      pinnedNoteColorMenuWindow = null
    })
    // 等 React 渲染完才顯示，避免出現空白透明視窗的閃爍 lag
    pinnedNoteColorMenuWindow.once('ready-to-show', () => {
      if (!pinnedNoteColorMenuWindow || pinnedNoteColorMenuWindow.isDestroyed()) return
      pinnedNoteColorMenuWindow.setBounds(bounds)
      pinnedNoteColorMenuWindow.show()
      pinnedNoteColorMenuWindow.moveTop()
    })
    return true
  }

  // 已存在的視窗：更新座標 + 內容後直接顯示（內容已載入，無需等待）
  pinnedNoteColorMenuWindow.setBounds(bounds)
  pinnedNoteColorMenuWindow.webContents.send('pinned-note-color-menu:init', { noteId, color: currentColor })
  pinnedNoteColorMenuWindow.show()
  pinnedNoteColorMenuWindow.moveTop()
  return true
}

export function openPinnedNotesManager(): BrowserWindow {
  if (pinnedNotesManagerWindow && !pinnedNotesManagerWindow.isDestroyed()) {
    pinnedNotesManagerWindow.show()
    pinnedNotesManagerWindow.focus()
    pinnedNotesManagerWindow.moveTop()
    return pinnedNotesManagerWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 380, h = 520
  pinnedNotesManagerWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  pinnedNotesManagerWindow.setAlwaysOnTop(true, 'pop-up-menu')
  pinnedNotesManagerWindow.setMinimumSize(300, 300)

  if (VITE_DEV_SERVER_URL) {
    pinnedNotesManagerWindow.loadURL(makeURL({ w: 'pinned-notes-manager' }))
  } else {
    pinnedNotesManagerWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'pinned-notes-manager' }
    })
  }

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    pinnedNotesManagerWindow.webContents.openDevTools({ mode: 'detach' })
  }

  pinnedNotesManagerWindow.on('closed', () => { pinnedNotesManagerWindow = null })
  pinnedNotesManagerWindow.show()
  raiseAuxAboveCharacters()
  pinnedNotesManagerWindow.moveTop()
  pinnedNotesManagerWindow.focus()
  return pinnedNotesManagerWindow
}

export function openRemindersManager(): BrowserWindow {
  if (remindersManagerWindow && !remindersManagerWindow.isDestroyed()) {
    remindersManagerWindow.show()
    remindersManagerWindow.focus()
    remindersManagerWindow.moveTop()
    return remindersManagerWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 420, h = 580
  remindersManagerWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  remindersManagerWindow.setAlwaysOnTop(true, 'pop-up-menu')
  remindersManagerWindow.setMinimumSize(360, 400)

  if (VITE_DEV_SERVER_URL) {
    remindersManagerWindow.loadURL(makeURL({ w: 'reminders-manager' }))
  } else {
    remindersManagerWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'reminders-manager' }
    })
  }

  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    remindersManagerWindow.webContents.openDevTools({ mode: 'detach' })
  }

  remindersManagerWindow.on('closed', () => { remindersManagerWindow = null })
  remindersManagerWindow.show()
  raiseAuxAboveCharacters()
  remindersManagerWindow.moveTop()
  remindersManagerWindow.focus()
  return remindersManagerWindow
}

export function closePinnedNotesManager(): void {
  if (pinnedNotesManagerWindow && !pinnedNotesManagerWindow.isDestroyed()) {
    pinnedNotesManagerWindow.close()
  }
}

export function closeRemindersManager(): void {
  if (remindersManagerWindow && !remindersManagerWindow.isDestroyed()) {
    remindersManagerWindow.close()
  }
}

export function openRemoteControlLog(): BrowserWindow {
  if (remoteControlLogWindow && !remoteControlLogWindow.isDestroyed()) {
    remoteControlLogWindow.show()
    remoteControlLogWindow.focus()
    remoteControlLogWindow.moveTop()
    return remoteControlLogWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 500, h = 560
  remoteControlLogWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  remoteControlLogWindow.setAlwaysOnTop(true, 'pop-up-menu')
  remoteControlLogWindow.setMinimumSize(380, 300)

  if (VITE_DEV_SERVER_URL) {
    remoteControlLogWindow.loadURL(makeURL({ w: 'remote-control-log' }))
  } else {
    remoteControlLogWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'remote-control-log' }
    })
  }

  remoteControlLogWindow.on('closed', () => { remoteControlLogWindow = null })
  remoteControlLogWindow.show()
  raiseAuxAboveCharacters()
  remoteControlLogWindow.moveTop()
  remoteControlLogWindow.focus()
  return remoteControlLogWindow
}

export function closeRemoteControlLog(): void {
  if (remoteControlLogWindow && !remoteControlLogWindow.isDestroyed()) {
    remoteControlLogWindow.close()
  }
}

// ── Hide all auxiliary windows (non-pinned-note, used by dismissAllAuxWindows) ──

function pushVisibleAuxSnapshot(
  entries: VisibleAuxWindowSnapshotEntry[],
  kind: Exclude<VisibleAuxWindowKind, 'speechBubble'>,
  win: BrowserWindow | null | undefined
): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const bounds = getWindowBoundsState(win)
  if (bounds) entries.push({ kind, bounds })
}

export function getVisibleAuxWindowSnapshot(): VisibleAuxWindowSnapshotEntry[] {
  const entries: VisibleAuxWindowSnapshotEntry[] = []
  pushVisibleAuxSnapshot(entries, 'input', inputWindow)
  pushVisibleAuxSnapshot(entries, 'userBubble', userBubbleWindow)
  pushVisibleAuxSnapshot(entries, 'log', logWindow)
  pushVisibleAuxSnapshot(entries, 'settings', settingsWindow)
  pushVisibleAuxSnapshot(entries, 'characterLibrary', characterLibraryWindow)
  pushVisibleAuxSnapshot(entries, 'preview', previewWindow)
  pushVisibleAuxSnapshot(entries, 'pinnedNotesManager', pinnedNotesManagerWindow)
  pushVisibleAuxSnapshot(entries, 'remindersManager', remindersManagerWindow)
  for (const [characterId, win] of bubbleWindows.entries()) {
    if (!win || win.isDestroyed() || !win.isVisible()) continue
    const bounds = getWindowBoundsState(win)
    if (bounds) entries.push({ kind: 'speechBubble', characterId, bounds })
  }
  return entries
}

function showExistingWindowFromSnapshot(
  win: BrowserWindow | null | undefined,
  entry: VisibleAuxWindowSnapshotEntry,
  focus = false
): boolean {
  if (!win || win.isDestroyed()) return false
  win.setOpacity(1)
  win.setBounds(entry.bounds)
  if (focus) win.show()
  else win.showInactive()
  win.moveTop()
  if (focus && win.isFocusable()) win.focus()
  return true
}

export function restoreAuxWindowsFromSnapshot(entries: VisibleAuxWindowSnapshotEntry[]): void {
  let lastFocusable: BrowserWindow | null = null
  let restoredInputWindow: BrowserWindow | null = null

  for (const entry of entries) {
    switch (entry.kind) {
      case 'input': {
        const win = createInputWindow({ x: entry.bounds.x, y: entry.bounds.y })
        win.setBounds(entry.bounds)
        restoredInputWindow = win
        lastFocusable = win
        break
      }
      case 'userBubble': {
        showExistingWindowFromSnapshot(userBubbleWindow, entry)
        break
      }
      case 'log': {
        openLogWindow()
        if (logWindow && !logWindow.isDestroyed()) {
          logWindow.setBounds(entry.bounds)
          lastFocusable = logWindow
        }
        break
      }
      case 'settings': {
        openSettingsWindow()
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.setBounds(entry.bounds)
          lastFocusable = settingsWindow
        }
        break
      }
      case 'characterLibrary': {
        const win = createCharacterLibraryWindow()
        win.setBounds(entry.bounds)
        lastFocusable = win
        break
      }
      case 'preview': {
        if (showExistingWindowFromSnapshot(previewWindow, entry, true) && previewWindow) {
          lastFocusable = previewWindow
        }
        break
      }
      case 'pinnedNotesManager': {
        const win = openPinnedNotesManager()
        win.setBounds(entry.bounds)
        lastFocusable = win
        break
      }
      case 'remindersManager': {
        const win = openRemindersManager()
        win.setBounds(entry.bounds)
        lastFocusable = win
        break
      }
      case 'speechBubble': {
        if (!entry.characterId) break
        const cached = lastBubbleShowPayload.get(entry.characterId)
        if (cached) {
          showSpeechBubble(
            entry.characterId,
            cached.speakerName,
            cached.text,
            cached.emotion,
            cached.anchorFallback,
            cached.news,
            { messageId: cached.messageId, reaction: cached.reaction }
          )
        } else {
          const win = bubbleWindows.get(entry.characterId)
          showExistingWindowFromSnapshot(win, entry)
        }
        break
      }
    }
  }

  raiseAuxAboveCharacters()
  raiseCharactersAbovePinnedNotes()
  if (restoredInputWindow && !restoredInputWindow.isDestroyed()) {
    restoredInputWindow.setIgnoreMouseEvents(false)
    restoredInputWindow.setAlwaysOnTop(true, 'pop-up-menu')
    restoredInputWindow.setOpacity(1)
    restoredInputWindow.show()
    restoredInputWindow.moveTop()
    restoredInputWindow.focus()
    lastFocusable = restoredInputWindow
  }
  if (lastFocusable && !lastFocusable.isDestroyed()) {
    lastFocusable.moveTop()
    if (lastFocusable.isFocusable()) lastFocusable.focus()
  }
}

// ── Spotify settings window ───────────────────────────────

let spotifySettingsWindow: BrowserWindow | null = null

export function openSpotifySettingsWindow(): BrowserWindow {
  if (spotifySettingsWindow && !spotifySettingsWindow.isDestroyed()) {
    spotifySettingsWindow.show()
    spotifySettingsWindow.focus()
    spotifySettingsWindow.moveTop()
    return spotifySettingsWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 400, h = 460
  spotifySettingsWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  spotifySettingsWindow.setAlwaysOnTop(true, 'pop-up-menu')
  if (VITE_DEV_SERVER_URL) {
    spotifySettingsWindow.loadURL(makeURL({ w: 'spotify-settings' }))
  } else {
    spotifySettingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'spotify-settings' }
    })
  }
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    spotifySettingsWindow.webContents.openDevTools({ mode: 'detach' })
  }
  spotifySettingsWindow.on('closed', () => { spotifySettingsWindow = null })
  spotifySettingsWindow.show()
  raiseAuxAboveCharacters()
  spotifySettingsWindow.moveTop()
  spotifySettingsWindow.focus()
  return spotifySettingsWindow
}

export function closeSpotifySettingsWindow(): void {
  if (spotifySettingsWindow && !spotifySettingsWindow.isDestroyed()) {
    spotifySettingsWindow.close()
  }
}

// ── Google Calendar settings window ───────────────────────

let calendarSettingsWindow: BrowserWindow | null = null

export function openCalendarSettingsWindow(): BrowserWindow {
  if (calendarSettingsWindow && !calendarSettingsWindow.isDestroyed()) {
    calendarSettingsWindow.show()
    calendarSettingsWindow.focus()
    calendarSettingsWindow.moveTop()
    return calendarSettingsWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 420, h = 660
  calendarSettingsWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  calendarSettingsWindow.setAlwaysOnTop(true, 'pop-up-menu')
  if (VITE_DEV_SERVER_URL) {
    calendarSettingsWindow.loadURL(makeURL({ w: 'calendar-settings' }))
  } else {
    calendarSettingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'calendar-settings' }
    })
  }
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    calendarSettingsWindow.webContents.openDevTools({ mode: 'detach' })
  }
  calendarSettingsWindow.on('closed', () => { calendarSettingsWindow = null })
  calendarSettingsWindow.show()
  raiseAuxAboveCharacters()
  calendarSettingsWindow.moveTop()
  calendarSettingsWindow.focus()
  return calendarSettingsWindow
}

export function closeCalendarSettingsWindow(): void {
  if (calendarSettingsWindow && !calendarSettingsWindow.isDestroyed()) {
    calendarSettingsWindow.close()
  }
}

// ── QR Code window ────────────────────────────────────────

let qrCodeWindow: BrowserWindow | null = null

export function openQRCodeWindow(): BrowserWindow {
  if (qrCodeWindow && !qrCodeWindow.isDestroyed()) {
    qrCodeWindow.show()
    qrCodeWindow.focus()
    qrCodeWindow.moveTop()
    return qrCodeWindow
  }

  const wa = screen.getPrimaryDisplay().workArea
  const w = 320, h = 440
  qrCodeWindow = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + (wa.height - h) / 2),
    width: w,
    height: h,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    title: '到手機上繼續對話',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  qrCodeWindow.setAlwaysOnTop(true, 'pop-up-menu')
  if (VITE_DEV_SERVER_URL) {
    qrCodeWindow.loadURL(makeURL({ w: 'qrcode' }))
  } else {
    qrCodeWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'qrcode' }
    })
  }
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    qrCodeWindow.webContents.openDevTools({ mode: 'detach' })
  }
  qrCodeWindow.on('closed', () => { qrCodeWindow = null })
  qrCodeWindow.show()
  raiseAuxAboveCharacters()
  qrCodeWindow.moveTop()
  qrCodeWindow.focus()
  return qrCodeWindow
}

export function getQRCodeWindow(): BrowserWindow | null {
  return qrCodeWindow && !qrCodeWindow.isDestroyed() ? qrCodeWindow : null
}

export function broadcastMobileStatus(status: unknown): void {
  const win = getQRCodeWindow()
  if (win) win.webContents.send('mobile:status-updated', status)
}

export function hideAllAuxWindowsExceptPinnedNotes(): void {
  for (const w of [inputWindow, userBubbleWindow, logWindow, settingsWindow, characterLibraryWindow, previewWindow, pinnedNotesManagerWindow, remindersManagerWindow, emojiPickerWindow, pinnedNoteColorMenuWindow]) {
    if (w && !w.isDestroyed() && w.isVisible()) w.hide()
  }
  for (const w of bubbleWindows.values()) {
    if (!w.isDestroyed() && w.isVisible()) w.hide()
  }
  lastShownBubbleCharacterId = null
}

// ── Raise character windows above pinned notes ────────────

export function raiseCharactersAbovePinnedNotes(): void {
  for (const w of characterWindows.values()) {
    if (!w.isDestroyed()) w.moveTop()
  }
}

/** Raise only one character (and its speech bubble) above pinned notes. */
export function raiseCharacterAbovePinnedNotes(characterId: string): void {
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) cw.moveTop()
  const bw = bubbleWindows.get(characterId)
  if (bw && !bw.isDestroyed()) bw.moveTop()
}

export type CharacterContextPayload = {
  characterId: string
  lastMessage?: { id: string; emotion?: string; content?: string }
}

export function sendToCharacterWindow(characterId: string, channel: string, data: unknown): boolean {
  const win = characterWindows.get(characterId)
  if (!win || win.isDestroyed()) return false
  win.webContents.send(channel, data)
  return true
}

export function setCharacterThinking(characterId: string, thinking: boolean): boolean {
  return sendToCharacterWindow(characterId, 'character:thinking', { characterId, thinking })
}

export function sendCharacterContextUpdate(
  characterId: string,
  payload: Omit<CharacterContextPayload, 'characterId'>
): boolean {
  return sendToCharacterWindow(characterId, 'character:context-update', { characterId, ...payload })
}

// ── Broadcast to all windows ──────────────────────────────

/** 僅通知角色視窗桌面狀態變更，避免拖曳結束時驚動全部泡泡 / 輔助視窗。 */
export function broadcastDesktopCharactersToCharacterWindows(desktopCharacters: unknown): void {
  for (const win of characterWindows.values()) {
    if (!win.isDestroyed()) win.webContents.send('desktop:updated', desktopCharacters)
  }
}

export function broadcastToAll(channel: string, data: unknown): void {
  const wins = [
    ...characterWindows.values(),
    ...bubbleWindows.values(),
    // pinnedNoteWindows excluded: they only listen to direct sends (update-content, update-color)
    inputWindow,
    userBubbleWindow,
    logWindow,
    settingsWindow,
    characterLibraryWindow,
    pinnedNotesManagerWindow,
    remindersManagerWindow,
    newsReaderWindow,
    // OAuth 設定視窗要收 settings:updated / *:auth-error，
    // 否則授權完成或失敗時畫面會一直停在「等待授權中」
    spotifySettingsWindow,
    calendarSettingsWindow
  ].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
  for (const w of wins) w.webContents.send(channel, data)
}

function omitHeavyMessageFields(m: Message): Message {
  const {
    debugPrompt: _d,
    utilityDebugPrompt: _u,
    ...rest
  } = m
  return rest
}

function logImagePlaceholder(messageId: string, index: number): string {
  return `desktopst-log-image:${encodeURIComponent(messageId)}:${index}`
}

function stripConversationForInput(conv: Conversation): Conversation {
  const hasImages = conv.messages.some(m => m.images && m.images.length > 0)
  if (!hasImages) {
    return { ...conv, messages: conv.messages.map(omitHeavyMessageFields) }
  }
  return {
    ...conv,
    messages: conv.messages.map(m =>
      m.images?.length
        ? { ...omitHeavyMessageFields(m), images: [] as string[] }
        : omitHeavyMessageFields(m)
    )
  }
}

/** Log 視窗用：保留圖片縮圖，但省略 debug prompt 避免 IPC 過大導致 renderer 崩潰。 */
export function stripConversationForLog(conv: Conversation): Conversation {
  const messages = lowPerformanceModeEnabled
    ? conv.messages.slice(-lowPerformanceLogMessageLimit)
    : conv.messages
  return {
    ...conv,
    messages: messages.map(m => {
      const stripped = omitHeavyMessageFields(m)
      if (!lowPerformanceModeEnabled || !m.images || m.images.length === 0) return stripped
      return {
        ...stripped,
        images: m.images.map((_, index) => logImagePlaceholder(m.id, index))
      }
    })
  }
}

/** Mobile server conversation hook — fires on every broadcastConversationUpdate */
let mobileConversationHook: ((conv: Conversation) => void) | null = null
export function setMobileConversationHook(fn: ((conv: Conversation) => void) | null): void {
  mobileConversationHook = fn
}

/** Targeted broadcast for conversation updates.
 *  - Log window gets a stripped copy (no debug prompts; keeps image thumbnails).
 *  - Input window gets a stripped copy (no images, no debug prompts).
 *  - Character windows use character:context-update instead (see sendCharacterContextUpdate).
 */
export function broadcastConversationUpdate(conv: Conversation): void {
  const strippedInput = stripConversationForInput(conv)
  const strippedLog = stripConversationForLog(conv)

  if (logWindow && !logWindow.isDestroyed())
    logWindow.webContents.send('conversation:updated', strippedLog)
  if (inputWindow && !inputWindow.isDestroyed())
    inputWindow.webContents.send('conversation:updated', strippedInput)

  // Notify mobile server
  mobileConversationHook?.(conv)
}

/** 延後一個 event loop 再推送，避免與 thinking / 泡泡顯示搶同一個主程序 tick。 */
export function deferBroadcastConversationUpdate(conv: Conversation): void {
  setImmediate(() => broadcastConversationUpdate(conv))
}

let pendingConvBroadcast: Conversation | null = null
let convBroadcastTimer: ReturnType<typeof setTimeout> | null = null

/** Coalesce rapid conversation updates (e.g. group replies) into fewer IPC pushes. */
export function scheduleConversationBroadcast(conv: Conversation): void {
  pendingConvBroadcast = conv
  if (convBroadcastTimer) return
  convBroadcastTimer = setTimeout(() => {
    convBroadcastTimer = null
    flushConversationBroadcast()
  }, 50)
}

export function flushConversationBroadcast(): void {
  if (convBroadcastTimer) {
    clearTimeout(convBroadcastTimer)
    convBroadcastTimer = null
  }
  if (!pendingConvBroadcast) return
  const conv = pendingConvBroadcast
  pendingConvBroadcast = null
  broadcastConversationUpdate(conv)
}
