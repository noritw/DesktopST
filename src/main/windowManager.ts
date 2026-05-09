import { BrowserWindow, screen } from 'electron'
import * as path from 'path'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const DEVTOOLS_ENABLED = process.env['DESKTOPST_DEVTOOLS'] === '1'
const CHARACTER_ALWAYS_ON_TOP_LEVEL = 'floating' as const
const BUBBLE_ALWAYS_ON_TOP_LEVEL = 'screen-saver' as const

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

// ── Character windows ─────────────────────────────────────

const characterWindows = new Map<string, BrowserWindow>()
const bubbleWindows = new Map<string, BrowserWindow>()
type ScreenRect = { x: number; y: number; w: number; h: number }
const hitRects = new Map<string, { sprite: ScreenRect | null; buttons: ScreenRect | null }>()
const draggingCharacters = new Set<string>()
let hitTestTimer: NodeJS.Timeout | null = null
let charactersRaisedAboveAux = false
const lastBubbleSizes = new Map<string, { width: number; height: number }>()
const activeDragTimers = new Map<string, NodeJS.Timeout>()
const activeDragLastPositions = new Map<string, { x: number; y: number }>()
let suppressAuxAutoHideUntil = 0
let lastShownBubbleCharacterId: string | null = null

function getAuxWindows(): BrowserWindow[] {
  return [inputWindow, logWindow, settingsWindow].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
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
  const scale = Number.isFinite(size) && size > 0 ? size : 1
  const winSize = {
    width: Math.round(220 * scale),
    height: Math.round(380 * scale)
  }
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

  endCharacterDrag(characterId)
  setCharacterDragging(characterId, true)
  bringCharacterToFront(characterId)

  const startCursor = screen.getCursorScreenPoint()
  const startBounds = win.getBounds()
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
    syncSpeechBubblePosition(characterId, pos)
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

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'bubble', id: characterId }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { w: 'bubble', id: characterId } })
  }

  bubbleWindows.set(characterId, win)
  win.on('closed', () => bubbleWindows.delete(characterId))
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
    applyBubbleBounds(bw, lastBubbleSizes.get(characterId) ?? { width: 280, height: 120 }, cw.getBounds())
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
  if (lastShownBubbleCharacterId === characterId) lastShownBubbleCharacterId = null
  return true
}

function applyBubbleBounds(
  bw: BrowserWindow,
  bubbleSize: { width: number; height: number },
  cb: { x: number; y: number; width: number; height: number }
): void {
  const display = screen.getDisplayNearestPoint({ x: cb.x + Math.round(cb.width / 2), y: cb.y + Math.round(cb.height / 2) })
  const wa = display.workArea
  const maxH = Math.max(120, Math.round(wa.height * 0.75))
  const width = Math.max(180, Math.min(420, Math.round(bubbleSize.width)))
  const height = Math.max(60, Math.min(maxH, Math.round(bubbleSize.height)))
  // Sprite occupies lower 260/380 of the character window; anchor bubble just above its top.
  const spriteTop = Math.round(cb.y + cb.height * (120 / 380))
  const target = { x: Math.round(cb.x + 12), y: spriteTop - height - 8 }
  const pos = normalizeWindowPosition(target, { width, height })
  bw.setBounds({ x: pos.x, y: pos.y, width, height }, false)
}

export function updateSpeechBubbleSize(characterId: string, size: { width: number; height: number }): boolean {
  const bw = bubbleWindows.get(characterId)
  const cw = characterWindows.get(characterId)
  if (!bw || bw.isDestroyed() || !cw || cw.isDestroyed()) return false
  lastBubbleSizes.set(characterId, size)
  applyBubbleBounds(bw, size, cw.getBounds())
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
  applyBubbleBounds(bw, size, roundedPos ? { ...cb, ...roundedPos } : cb)
  return true
}

// ── Input window ──────────────────────────────────────────

let inputWindow: BrowserWindow | null = null

export function createInputWindow(position: { x: number; y: number }): BrowserWindow {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.setOpacity(1)
    raiseAuxAboveCharacters()
    inputWindow.moveTop()
    inputWindow.focus()
    return inputWindow
  }

  inputWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: 400,
    height: 160,
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
  // Higher than character alwaysOnTop windows
  inputWindow.setAlwaysOnTop(true, 'pop-up-menu')

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
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    createInputWindow(position ?? { x: Math.round(width / 2 - 200), y: Math.round(height - 200) })
    return
  }
  if (inputWindow.isVisible()) {
    inputWindow.hide()
  } else {
    inputWindow.setOpacity(1)
    inputWindow.show()
    raiseAuxAboveCharacters()
    inputWindow.moveTop()
    inputWindow.focus()
  }
}

export function getInputWindow(): BrowserWindow | null {
  return inputWindow && !inputWindow.isDestroyed() ? inputWindow : null
}

export function hideAuxWindowsRememberingState(): void {
  for (const w of getAuxWindows()) {
    if (w.isVisible()) w.setOpacity(0.1)
  }
}

export function restoreAuxWindowsFromRememberedState(): void {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && getAuxWindows().includes(focused)) focused.setOpacity(1)
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
  if (target.isVisible()) target.focus()
  for (const w of bubbleWindows.values()) {
    if (w.isDestroyed() || !w.isVisible()) continue
    w.setAlwaysOnTop(true, BUBBLE_ALWAYS_ON_TOP_LEVEL)
    w.moveTop()
  }
  return true
}

export function areCharactersRaisedAboveAux(): boolean {
  return charactersRaisedAboveAux
}

// ── Log window ────────────────────────────────────────────

let logWindow: BrowserWindow | null = null

export function toggleLogWindow(): void {
  if (!logWindow || logWindow.isDestroyed()) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    logWindow = new BrowserWindow({
      x: Math.round(width / 2 - 280),
      y: 80,
      width: 560,
      height: Math.round(height * 0.7),
      frame: false,
      transparent: false,
      backgroundColor: '#F7FFFC',
      skipTaskbar: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
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
    logWindow.show()
    logWindow.setOpacity(1)
    raiseAuxAboveCharacters()
    logWindow.moveTop()
    logWindow.focus()
    return
  }
  if (logWindow.isVisible()) logWindow.hide()
  else {
    logWindow.setOpacity(1)
    logWindow.show()
    raiseAuxAboveCharacters()
    logWindow.moveTop()
    logWindow.focus()
    logWindow.setAlwaysOnTop(true, 'pop-up-menu')
  }
}

export function getLogWindow(): BrowserWindow | null {
  return logWindow && !logWindow.isDestroyed() ? logWindow : null
}

// ── Settings window ───────────────────────────────────────

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(tab?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isVisible()) {
      settingsWindow.hide()
    } else {
      settingsWindow.setOpacity(1)
      settingsWindow.show()
      raiseAuxAboveCharacters()
      settingsWindow.moveTop()
      settingsWindow.focus()
    }
    return
  }
  const { width } = screen.getPrimaryDisplay().workAreaSize
  settingsWindow = new BrowserWindow({
    x: Math.round(width / 2 - 340),
    y: 80,
    width: 680,
    height: 580,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    skipTaskbar: false,
    alwaysOnTop: true,
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

// ── Broadcast to all windows ──────────────────────────────

export function broadcastToAll(channel: string, data: unknown): void {
  const wins = [
    ...characterWindows.values(),
    ...bubbleWindows.values(),
    inputWindow,
    logWindow,
    settingsWindow
  ].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
  for (const w of wins) w.webContents.send(channel, data)
}
