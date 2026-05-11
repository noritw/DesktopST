import { BrowserWindow, screen, nativeImage, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const DEVTOOLS_ENABLED = process.env['DESKTOPST_DEVTOOLS'] === '1'
const CHARACTER_ALWAYS_ON_TOP_LEVEL = 'floating' as const
const BUBBLE_ALWAYS_ON_TOP_LEVEL = 'screen-saver' as const
function getAppIcon(): Electron.NativeImage | undefined {
  const appRoot = app.getAppPath()
  const candidates = ['icon.ico', 'icon.png'].map(f => path.join(appRoot, 'assets', f))
  const found = candidates.find(p => fs.existsSync(p))
  return found ? nativeImage.createFromPath(found) : undefined
}

type WindowBoundsState = { x: number; y: number; width: number; height: number }
type AuxWindowKind = 'input' | 'log'
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
const BUBBLE_PROGRAMMATIC_BOUNDS_EPS = 28
const DEFAULT_UNFOCUSED_BUBBLE_OPACITY = 0.1
let unfocusedBubbleOpacity = DEFAULT_UNFOCUSED_BUBBLE_OPACITY

export function getCharacterWindowSize(scale: number): { width: number; height: number } {
  return {
    width: Math.max(280, Math.round(220 * scale)),
    height: Math.max(220, Math.round(380 * scale))
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
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    saveAuxBounds?.(kind, { x: b.x, y: b.y, width: b.width, height: b.height })
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 250)
  }
  win.on('move', schedule)
  win.on('resize', schedule)
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
/** 使用者拖曳對白視窗後，相對於「預設錨點位置」的像素偏移（跟著角色移動時保留） */
const bubbleUserOffset = new Map<string, { x: number; y: number }>()
/** 最近一次由程式 setBounds 寫入的對白視窗矩形；與 moved 比對以區分「程式同步」與「使用者拖對白」 */
const lastBubbleBoundsProgrammatic = new Map<string, WindowBoundsState>()
/** 避免異常 IPC 傳入無限大；一般長文仍完整顯示 */
const BUBBLE_MAX_HEIGHT_PX = 32000
/** 立體角色立繪頂端（約在視窗高度 120/380 處）與對白框下緣的間距（px） */
const BUBBLE_GAP_PX = 6
const BUBBLE_SPRITE_TOP_RATIO = 120 / 380
/** 對白相對於頭頂錨點：尚無使用者拖過對白時的初始偏移；拖對白放手後由 refreshBubbleUserOffsetFromWindow 寫入並保留，角色拖曳結束不覆寫。 */
const BUBBLE_USER_OFFSET_DEFAULT: Readonly<{ x: number; y: number }> = { x: 0, y: 0 }

type ScreenRect = { x: number; y: number; w: number; h: number }
const hitRects = new Map<string, { sprite: ScreenRect | null; buttons: ScreenRect | null }>()
const draggingCharacters = new Set<string>()
let hitTestTimer: NodeJS.Timeout | null = null
let charactersRaisedAboveAux = false
const lastBubbleSizes = new Map<string, { width: number; height: number }>()
/** 拖曳角色時曾把對白 hide()，放手後要 show 回來（避免拖曳中對白座標漂移） */
const bubbleHiddenForCharacterDrag = new Map<string, boolean>()
const activeDragTimers = new Map<string, NodeJS.Timeout>()
const activeDragLastPositions = new Map<string, { x: number; y: number }>()
let suppressAuxAutoHideUntil = 0
let lastShownBubbleCharacterId: string | null = null

let characterLibraryWindow: BrowserWindow | null = null
type CharacterLibraryNavigateMode = 'home' | 'edit'
type CharacterLibraryOpenOptions = {
  mode?: CharacterLibraryNavigateMode
  characterId?: string
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
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
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
    const cursor = screen.getCursorScreenPoint()
    for (const [characterId, win] of characterWindows.entries()) {
      if (!win || win.isDestroyed()) continue
      // Never click-through while dragging: mouseup must always reach the renderer.
      const dragging = draggingCharacters.has(characterId)
      const rects = hitRects.get(characterId)
      const inside = dragging || (!!rects && (pointInRect(cursor, rects.sprite) || pointInRect(cursor, rects.buttons)))
      win.setIgnoreMouseEvents(!inside, { forward: true })
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

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: winSize.width,
    height: winSize.height,
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

  win.setIgnoreMouseEvents(false)
  win.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)

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

export function resizeCharacterWindow(characterId: string, size: number): { position: { x: number; y: number }; size: number } | null {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return null

  const oldBounds = win.getBounds()
  const scale = clampCharacterScaleForDisplay(Number.isFinite(size) ? size : 1, {
    x: oldBounds.x,
    y: oldBounds.y + oldBounds.height
  })
  const nextSize = getCharacterWindowSize(scale)
  const nextPosition = normalizeWindowPosition(
    {
      x: oldBounds.x,
      y: oldBounds.y + oldBounds.height - nextSize.height
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
  if (dragging) draggingCharacters.add(characterId)
  else draggingCharacters.delete(characterId)
}

export function beginCharacterDrag(
  characterId: string,
  onMove?: (position: { x: number; y: number }) => void
): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false

  if (bubbleHiddenForCharacterDrag.get(characterId)) {
    const b = bubbleWindows.get(characterId)
    if (b && !b.isDestroyed()) {
      b.setOpacity(1)
      b.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
      b.showInactive()
      b.moveTop()
    }
    bubbleHiddenForCharacterDrag.delete(characterId)
  }

  endCharacterDrag(characterId)
  setCharacterDragging(characterId, true)
  bringCharacterToFront(characterId)

  const startBounds = win.getBounds()
  const bwSnap = bubbleWindows.get(characterId)
  if (bwSnap && !bwSnap.isDestroyed() && bwSnap.isVisible()) {
    bwSnap.hide()
    bubbleHiddenForCharacterDrag.set(characterId, true)
  } else {
    bubbleHiddenForCharacterDrag.delete(characterId)
  }

  const startCursor = screen.getCursorScreenPoint()
  const offset = {
    x: startCursor.x - startBounds.x,
    y: startCursor.y - startBounds.y
  }

  const moveToCursor = () => {
    if (win.isDestroyed()) {
      endCharacterDrag(characterId)
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const pos = {
      x: Math.round(cursor.x - offset.x),
      y: Math.round(cursor.y - offset.y)
    }
    const last = activeDragLastPositions.get(characterId)
    if (last && last.x === pos.x && last.y === pos.y) return
    activeDragLastPositions.set(characterId, pos)
    win.setPosition(pos.x, pos.y)
    if (!bubbleHiddenForCharacterDrag.has(characterId)) {
      syncSpeechBubblePosition(characterId, pos)
    }
    onMove?.(pos)
  }

  moveToCursor()
  activeDragTimers.set(characterId, setInterval(moveToCursor, 16))
  return true
}

export function endCharacterDrag(characterId: string): { x: number; y: number } | null {
  const timer = activeDragTimers.get(characterId)
  if (timer) {
    clearInterval(timer)
    activeDragTimers.delete(characterId)
  }

  const win = getCharacterWindow(characterId)
  const pos = activeDragLastPositions.get(characterId)
    ?? (win && !win.isDestroyed()
      ? { x: win.getBounds().x, y: win.getBounds().y }
      : null)

  activeDragLastPositions.delete(characterId)
  setCharacterDragging(characterId, false)
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
  bubbleHiddenForCharacterDrag.delete(characterId)
  hideSpeechBubble(characterId)
  const win = characterWindows.get(characterId)
  if (win && !win.isDestroyed()) win.close()
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
  win.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  win.setMinimumSize(180, 78)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'bubble', id: characterId }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { w: 'bubble', id: characterId } })
  }

  bubbleWindows.set(characterId, win)
  win.on('closed', () => {
    bubbleWindows.delete(characterId)
    bubbleUserOffset.delete(characterId)
    lastBubbleBoundsProgrammatic.delete(characterId)
    bubbleHiddenForCharacterDrag.delete(characterId)
  })
  win.on('moved', () => {
    if (draggingCharacters.has(characterId)) return
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

export function showSpeechBubble(characterId: string, speakerName: string, text: string): void {
  if (lastShownBubbleCharacterId && lastShownBubbleCharacterId !== characterId) {
    const previous = bubbleWindows.get(lastShownBubbleCharacterId)
    if (previous && !previous.isDestroyed() && previous.isVisible()) {
      previous.webContents.send('bubble:persist', { characterId: lastShownBubbleCharacterId })
    }
  }

  const bw = createBubbleWindow(characterId)
  if (bw.isDestroyed()) return
  bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  const cw = characterWindows.get(characterId)
  if (cw && !cw.isDestroyed()) {
    applyBubbleBounds(bw, lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }, cw.getBounds(), characterId)
  }
  const payload = {
    characterId,
    speakerName,
    text,
    autoCloseMs: getBubbleAutoCloseMs(text),
    persistUntilClosed: shouldKeepBubbleUntilClosed(text)
  }
  const dispatchShow = () => {
    if (bw.isDestroyed()) return
    bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    bw.setOpacity(1)
    if (!bw.isVisible()) bw.showInactive()
    bw.moveTop()
    bw.webContents.send('bubble:show', payload)
  }
  if (bw.webContents.isLoadingMainFrame()) {
    bw.webContents.once('did-finish-load', dispatchShow)
  } else {
    dispatchShow()
  }
  setTimeout(dispatchShow, 80)
  setTimeout(dispatchShow, 260)
  lastShownBubbleCharacterId = characterId
}

export function hideSpeechBubble(characterId: string): boolean {
  const bw = bubbleWindows.get(characterId)
  if (!bw || bw.isDestroyed()) return false
  bw.hide()
  bubbleHiddenForCharacterDrag.delete(characterId)
  if (lastShownBubbleCharacterId === characterId) lastShownBubbleCharacterId = null
  return true
}

export function hideAllCharacterSpeechBubbles(): number {
  let hiddenCount = 0
  for (const [characterId, bw] of bubbleWindows.entries()) {
    if (bw.isDestroyed() || !bw.isVisible()) continue
    bw.hide()
    bubbleHiddenForCharacterDrag.delete(characterId)
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
function refreshBubbleUserOffsetFromWindow(characterId: string): void {
  if (draggingCharacters.has(characterId)) return
  const bw = bubbleWindows.get(characterId)
  const cw = characterWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !cw || cw.isDestroyed()) return
  const bb = bw.getBounds()
  const cb = cw.getBounds()
  const spriteTop = Math.round(cb.y + cb.height * BUBBLE_SPRITE_TOP_RATIO)
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

  const spriteTop = Math.round(cb.y + cb.height * BUBBLE_SPRITE_TOP_RATIO)

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

  // 垂直方向不為了「塞進工作區」而改 y，避免超高對白被配合 OS 裁成細條或看不到內容；蓋到畫面外由使用者拖標題列調整
  const y = idealTop

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
export function reconcileSpeechBubbleAfterCharacterDrag(characterId: string, charPos: { x: number; y: number }): void {
  const reveal = bubbleHiddenForCharacterDrag.get(characterId) === true
  bubbleHiddenForCharacterDrag.delete(characterId)

  syncSpeechBubblePosition(characterId, charPos)

  if (reveal) {
    const bw = bubbleWindows.get(characterId)
    if (bw && !bw.isDestroyed()) {
      bw.setOpacity(1)
      bw.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
      bw.showInactive()
      bw.moveTop()
    }
  }
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
    raiseAuxAboveCharacters()
    inputWindow.moveTop()
    inputWindow.focus()
    return inputWindow
  }

  const savedBounds = getInitialAuxBounds('input')
  const initialBounds = getSavedAuxBounds?.('input') ? savedBounds : { ...savedBounds, x: position.x, y: position.y }
  inputWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
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
  inputWindow.setOpacity(1)
  raiseAuxAboveCharacters()
  inputWindow.moveTop()
  inputWindow.focus()
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

export function updateUserSpeechBubbleSize(size: { width: number; height: number }): boolean {
  const bw = userBubbleWindow
  if (!bw || bw.isDestroyed()) return false
  const current = bw.getBounds()
  const width = clamp(Math.round(Number(size.width) || current.width), 220, 1200)
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

export function hideAllWindowsForScreenshot(): { displayId: number; displayWidth: number; displayHeight: number } {
  for (const w of characterWindows.values()) {
    if (!w.isDestroyed()) w.setOpacity(0)
  }
  for (const w of bubbleWindows.values()) {
    if (!w.isDestroyed()) w.setOpacity(0)
  }
  if (userBubbleWindow && !userBubbleWindow.isDestroyed()) {
    userBubbleWindow.setOpacity(0)
  }
  for (const w of getAuxWindows()) {
    w.setOpacity(0)
  }
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  return { displayId: display.id, displayWidth: display.size.width, displayHeight: display.size.height }
}

export function hideAuxWindowsForScreenshotKeepingCharacters(): { displayId: number; displayWidth: number; displayHeight: number } {
  for (const w of [inputWindow, logWindow, settingsWindow, characterLibraryWindow, previewWindow]) {
    if (w && !w.isDestroyed()) w.setOpacity(0)
  }
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  return { displayId: display.id, displayWidth: display.size.width, displayHeight: display.size.height }
}

export function restoreAllWindowsAfterScreenshot(): void {
  for (const w of characterWindows.values()) {
    if (!w.isDestroyed() && w.isVisible()) w.setOpacity(1)
  }
  for (const w of bubbleWindows.values()) {
    if (!w.isDestroyed() && w.isVisible()) w.setOpacity(1)
  }
  if (userBubbleWindow && !userBubbleWindow.isDestroyed() && userBubbleWindow.isVisible()) {
    userBubbleWindow.setOpacity(1)
  }
  for (const w of getAuxWindows()) {
    if (w.isVisible()) w.setOpacity(1)
  }
}

export function raiseAllCharactersAboveAux(): void {
  charactersRaisedAboveAux = true
  // Raise characters to pop-up-menu level and move them on top.
  // Do NOT lower aux windows — that caused them to become non-interactive.
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
  // Restore character windows to their normal level.
  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  // Keep auxiliary windows at the right level, but do not reorder all of them.
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }
}

export function raiseAuxWindowToFront(target: BrowserWindow): boolean {
  if (!target || target.isDestroyed()) return false
  charactersRaisedAboveAux = false

  for (const w of characterWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, CHARACTER_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed()) continue
    w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
  }
  for (const w of getAuxWindows()) {
    w.setAlwaysOnTop(true, 'pop-up-menu')
  }

  target.moveTop()
  target.setOpacity(1)
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed() || !w.isVisible()) continue
    w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
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
    logWindow = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
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
    logWindow.setAlwaysOnTop(true, 'pop-up-menu')
    if (VITE_DEV_SERVER_URL) {
      logWindow.loadURL(makeURL({ w: 'log' }))
    } else {
      logWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { w: 'log' }
      })
    }
    logWindow.on('closed', () => { logWindow = null })
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

// ── Broadcast to all windows ──────────────────────────────

export function broadcastToAll(channel: string, data: unknown): void {
  const wins = [
    ...characterWindows.values(),
    ...bubbleWindows.values(),
    inputWindow,
    userBubbleWindow,
    logWindow,
    settingsWindow,
    characterLibraryWindow
  ].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
  for (const w of wins) w.webContents.send(channel, data)
}
