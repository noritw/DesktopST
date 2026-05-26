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
/** 依桌面角色數量決定可同時存在的泡泡上限（至少 1）。 */
function getBubbleConcurrentWindowLimit(): number {
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
const draggingCharacters = new Set<string>()
let activeDraggingCharacterId: string | null = null
/** 拖曳桌面角色時暫時 hide 的其他角色對白（僅 hide 視窗，不改 renderer 狀態） */
const bubblesSuppressedForDesktopDrag = new Map<string, boolean>()
let hitTestTimer: NodeJS.Timeout | null = null
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

function isSafeWindowCoordinate(n: number): boolean {
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_ELECTRON_WINDOW_COORD
}

export function setCharactersAlwaysOnTop(enabled: boolean): void {
  charactersAlwaysOnTop = enabled
  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    if (enabled) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    else w.setAlwaysOnTop(false)
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    if (enabled) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    else w.setAlwaysOnTop(false)
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
    if (enabled) cw.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    else cw.setAlwaysOnTop(false)
  }
  const bw = bubbleWindows.get(characterId)
  if (bw && !bw.isDestroyed()) {
    if (enabled) bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    else bw.setAlwaysOnTop(false)
  }
}

export function getCharactersAlwaysOnTop(): boolean {
  return charactersAlwaysOnTop
}
let suppressAuxAutoHideUntil = 0
let lastShownBubbleCharacterId: string | null = null

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
  return [inputWindow, userBubbleWindow, logWindow, settingsWindow, characterLibraryWindow].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
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

function ensureHitTestLoop(): void {
  if (hitTestTimer) return
  hitTestTimer = setInterval(() => {
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
        const inside = dragging || (!!rects && (pointInRect(cursor, rects.sprite) || pointInRect(cursor, rects.buttons)))
        shouldIgnore = !inside
      }
      if (lastIgnoreMouseState.get(characterId) !== shouldIgnore) {
        lastIgnoreMouseState.set(characterId, shouldIgnore)
        win.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      }
    }
  }, 33)
}

function maybeStopHitTestLoop(): void {
  if (characterWindows.size > 0) return
  if (hitTestTimer) {
    clearInterval(hitTestTimer)
    hitTestTimer = null
  }
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
    lastIgnoreMouseState.delete(characterId)
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
      if (!b.isVisible()) b.showInactive()
      b.webContents.send('bubble:outline-mode', { characterId, enabled: false })
    }
    bubbleHiddenForCharacterDrag.delete(characterId)
  }

  endCharacterDrag(characterId)
  setCharacterDragging(characterId, true)
  bringCharacterToFront(characterId)
  suppressOtherBubblesDuringDrag(characterId)

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
  if (draggingCharacters.size === 0) restoreBubblesSuppressedForDesktopDrag()
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
    lastIgnoreMouseState.delete(id)
    scaleModeAnchorFeet.delete(id)
    bubbleHiddenForCharacterDrag.delete(id)
    activeDragOffsets.delete(id)
    activeDragCallbacks.delete(id)
    activeDragLastPositions.delete(id)
    draggingCharacters.delete(id)
    if (!win.isDestroyed()) win.destroy()
  }

  // Destroy tracked bubble windows
  for (const [id, win] of [...bubbleWindows]) {
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
      nodeIntegration: false
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
}

const lastBubbleShowPayload = new Map<string, CachedBubbleShowPayload>()
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
    restoreCharacterAlwaysOnTopAfterBubbleHide(victim.id)
    victim.bw.destroy()
  }
}

function restoreCharacterAlwaysOnTopAfterBubbleHide(characterId: string): void {
  const cw = characterWindows.get(characterId)
  if (!cw || cw.isDestroyed()) return
  if (charactersAlwaysOnTop) cw.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  else cw.setAlwaysOnTop(false)
}

export function showSpeechBubble(
  characterId: string,
  speakerName: string,
  text: string,
  emotion?: string,
  anchorFallback?: BubbleAnchorFallback | null
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
  bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)

  const anchor = resolveBubbleAnchorBounds(characterId, anchorFallback)
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) {
    cw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    cw.moveTop()
  }
  applyBubbleBounds(bw, lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }, anchor, characterId)

  const payload = {
    characterId,
    speakerName,
    text,
    emotion: emotion ?? 'neutral',
    autoCloseMs: getBubbleAutoCloseMs(text),
    persistUntilClosed: shouldKeepBubbleUntilClosed(text),
    isLatestSpeaker: true
  }
  lastBubbleShowPayload.set(characterId, {
    speakerName,
    text,
    emotion: emotion ?? 'neutral',
    anchorFallback
  })

  const dispatchShow = () => {
    if (bw.isDestroyed()) return
    bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    bw.setOpacity(1)
    bw.showInactive()
    if (cw && !cw.isDestroyed()) {
      cw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
      cw.moveTop()
    }
    bw.moveTop()
    bw.webContents.send('bubble:show', payload)
  }
  if (bw.webContents.isLoadingMainFrame()) {
    bw.webContents.once('did-finish-load', dispatchShow)
  } else {
    dispatchShow()
    if (!bubbleRepositionDone.has(characterId)) {
      bubbleRepositionDone.add(characterId)
      setTimeout(() => {
        if (bw.isDestroyed()) return
        const anchor2 = resolveBubbleAnchorBounds(characterId, anchorFallback)
        applyBubbleBounds(bw, lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }, anchor2, characterId)
        if (charactersAlwaysOnTop) {
          bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
          const cw2 = characterWindows.get(characterId)
          if (cw2 && !cw2.isDestroyed()) cw2.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
        }
        bw.moveTop()
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
  bubbleLastActiveAt.set(characterId, Date.now())
  bw.webContents.send('bubble:latest-speaker', { characterId, isLatest: false })
  bw.webContents.send('bubble:hide', { characterId })
  bw.hide()
  bubbleHiddenForCharacterDrag.delete(characterId)
  restoreCharacterAlwaysOnTopAfterBubbleHide(characterId)
  if (lastShownBubbleCharacterId === characterId) lastShownBubbleCharacterId = null
  return true
}

export function hideAllCharacterSpeechBubbles(): number {
  let hiddenCount = 0
  for (const [characterId, bw] of bubbleWindows.entries()) {
    if (bw.isDestroyed() || !bw.isVisible()) continue
    bw.webContents.send('bubble:latest-speaker', { characterId, isLatest: false })
    bw.webContents.send('bubble:hide', { characterId })
    bw.hide()
    bubbleHiddenForCharacterDrag.delete(characterId)
    restoreCharacterAlwaysOnTopAfterBubbleHide(characterId)
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
  const width = Math.max(180, Math.min(420, Number.isFinite(rw) ? rw : 280))
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
  bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
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
      bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
      bw.showInactive()
      bw.moveTop()
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
    inputWindow.hide()
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
  for (const w of bubbleWindows.values()) {
    if (w.isVisible()) w.setOpacity(unfocusedBubbleOpacity)
  }
  for (const w of getAuxWindows()) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue
    // 設定／角色庫需長時間對照他處（例如貼 API Key），失焦時勿縮到幾乎看不見
    if (w === settingsWindow || w === characterLibraryWindow) continue
    w.setOpacity(unfocusedBubbleOpacity)
  }
}

export function restoreAuxWindowsFromRememberedState(): void {
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
    pinnedNoteColorMenuWindow
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

/** Hide every DesktopST window before capturing the screen (pure desktop). */
export function hideAllWindowsForScreenshot(): { displayId: number; displayWidth: number; displayHeight: number } {
  for (const w of collectAllDesktopSTWindows()) {
    w.setOpacity(0)
  }
  return getScreenshotDisplayInfo()
}

/** Keep all DesktopST windows visible; optionally hide input window. */
export function prepareScreenshotKeepingDesktopST(hideInputWindow: boolean = false): { displayId: number; displayWidth: number; displayHeight: number } {
  if (hideInputWindow) {
    const input = getInputWindow()
    if (input && !input.isDestroyed()) {
      input.setOpacity(0)
    }
  }
  return getScreenshotDisplayInfo()
}

export function restoreAllWindowsAfterScreenshot(): void {
  for (const w of collectAllDesktopSTWindows()) {
    if (w.isVisible()) w.setOpacity(1)
  }
}

export function raiseAllCharactersAboveAux(): void {
  charactersRaisedAboveAux = true
  if (!charactersAlwaysOnTop) return
  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, 'pop-up-menu')
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
  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
    w.moveTop()
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }
}

export function raiseAuxWindowToFront(target: BrowserWindow): boolean {
  if (!target || target.isDestroyed()) return false
  charactersRaisedAboveAux = false

  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    if (charactersAlwaysOnTop) w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }

  target.moveTop()
  target.setOpacity(1)
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed() || !w.isVisible()) continue
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
    win.hide()
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
            cached.anchorFallback
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
    remindersManagerWindow
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
  return {
    ...conv,
    messages: conv.messages.map(omitHeavyMessageFields)
  }
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
