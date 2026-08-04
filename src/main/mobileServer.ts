/**
 * mobileServer.ts
 * 手機遠端對話功能的 HTTP + WebSocket 伺服器
 */

import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import { app, desktopCapturer } from 'electron'
import type { Message, RandomResult } from './types'
import { computeRandomResult, sanitizePendingRandomTool } from '../core/random/dice'
import { getAccessToken } from './relayService'
import { getRemoteControlClientState, getRemoteControlClientStateForDevice } from './modules/remote-control'

// ── 注入的 bridge（由 index.ts 啟動時注入）────────────────

export interface MobileBridge {
  getCharacters: () => import('./types').Character[]
  getDesktopCharacterIds: () => string[]
  getDesktopCharacters: () => { id: string; name: string; muted: boolean }[]
  getActiveConversation: () => { id: string; title: string; participantIds: string[]; messages: Message[] } | null
  sendMessage: (payload: { content: string; images?: string[]; randomResult?: RandomResult; randomResults?: RandomResult[]; skipLlm?: boolean; sourceDeviceName?: string }) => Promise<void>
  addDesktopCharacter: (characterId: string) => Promise<boolean>
  removeDesktopCharacter: (characterId: string) => boolean
  captureScreenshot: (withChars: boolean, displayIndex?: number) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  getConversationList: () => { id: string; title: string; updatedAt: number; active: boolean }[]
  loadConversation: (id: string) => boolean
  createConversation: (title?: string) => { id: string; title: string; updatedAt: number; active: boolean }
  renameConversation: (id: string, title: string) => { ok: true; conversation: { id: string; title: string; updatedAt: number; active: boolean } } | { error: string }
  deleteConversation: (id: string) => { ok: true; activeConversationId: string } | { error: string }
  forceSpeak: (characterId: string) => Promise<{ ok: true } | { error: string }>
  toggleMute: (characterId: string) => boolean
  getScenes: () => import('./types').ScenePreset[]
  applyScene: (id: string) => { ok: true } | { error: string }
  getPersonaPresets: () => import('./types').PersonaPreset[]
  getWorldPresets: () => import('./types').WorldPreset[]
  activatePersona: (id: string) => boolean
  activateWorld: (id: string) => boolean
  getActivePersonaId: () => string
  getActiveWorldId: () => string
  getColorTheme: () => string
  getRandomToolsEnabled: () => boolean
  getMaxImagesPerMessage: () => number
  shouldIncludeDeviceNameInPrompt: () => boolean
  setColorTheme: (theme: import('./types').ColorTheme) => boolean
  deleteMessage: (id: string) => boolean
  editMessage: (id: string, content: string) => boolean
  resendMessage: (id: string) => Promise<{ ok: boolean } | { error: string }>
  // ── 角色卡寫入（B3 階段 3）──
  // 手機端要能建立與編輯角色，這些是唯一的入口。實作與桌面 IPC 共用
  // 同一批 `*Direct`（`ipcHandlers.ts`），不另寫一份。
  getCharacterCard: (id: string) => import('./types').Character | null
  createCharacter: (name?: string) => import('./types').Character
  saveCharacter: (char: import('./types').Character) => void
  deleteCharacter: (id: string) => void
  saveCharacterAvatar: (id: string, buffer: ArrayBuffer, ext: string) => { path: string } | { error: string }
  importCharacterPng: (buffer: ArrayBuffer) => import('./types').Character | { error: string }
  importCharacterJson: (json: string) => import('./types').Character | { error: string }
  exportCharacterPng: (char: import('./types').Character) => { buffer: ArrayBuffer } | { error: string }
  exportCharacterJson: (char: import('./types').Character) => { json: string } | { error: string }
  buildDstPack: (payload: { characterIds: string[]; includeGlobalSettings: boolean; includeLorebooks?: boolean }) => Promise<{ buffer: ArrayBuffer } | { error: string }>
  importDstPack: (
    buffer: ArrayBuffer,
    opts: { onConflict: 'skip' | 'overwrite' | 'new'; applyGlobalSettings: boolean }
  ) => Promise<{ ok: true; imported: number; skipped: number } | { error: string }>
  listLorebooks: () => { id: string; name: string }[]
  getRemoteControlSettings: () => import('./types').RemoteControlSettings | undefined
  setRemoteControlEnabled: (enabled: boolean) => { ok: true } | { error: string }
  touchAllowedRemoteDevice?: (device: { id: string; nickname: string; label?: string }) => void
  notifyRemoteClickPending: () => void  // 點擊前廣播：讓角色視窗暫時穿透
  notifyRemoteAction: () => void        // 點擊後廣播：顯示遠端控制指示
  hideWindowsForRemote: () => void      // 遙控模式：隱藏所有 DeST 視窗
  restoreWindowsForRemote: () => void   // 遙控模式：恢復所有 DeST 視窗
}

export interface MobileRouteContext {
  req: http.IncomingMessage
  res: http.ServerResponse
  method: string
  url: string
  requestUrl: URL
  host: MobileBridge
}

export interface MobileRoute {
  method: 'GET' | 'POST'
  path: string
  requiredCapability?: string
  handler: (ctx: MobileRouteContext) => Promise<void> | void
}

export type MobileRouteRegistrar = (route: MobileRoute) => void

const registeredRoutes = new Map<string, MobileRoute>()

export function registerMobileRoute(route: MobileRoute): void {
  registeredRoutes.set(`${route.method} ${route.path}`, route)
}

function findRegisteredRoute(method: string, pathName: string): MobileRoute | undefined {
  return registeredRoutes.get(`${method} ${pathName}`)
}

// ── 裝置資訊解析工具 ──────────────────────────────────────

let bridge: MobileBridge | null = null
export function setBridge(b: MobileBridge): void {
  bridge = b
}

// ── WebSocket 客戶端管理 ────────────────────────────────

const clients = new Set<WebSocket>()

export function pushMessage(msg: Message): void {
  const payload = JSON.stringify({ type: 'message', message: sanitizeMessage(msg) })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function pushDesktopUpdate(characterIds: string[]): void {
  const payload = JSON.stringify({ type: 'desktop-updated', desktopCharacterIds: characterIds })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function pushReminder(content: string): void {
  const payload = JSON.stringify({ type: 'reminder', content })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function pushThinking(charId?: string): void {
  const payload = JSON.stringify({ type: 'thinking', characterId: charId ?? '' })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

// 回覆流程結束（含失敗）：讓手機端收掉「正在回覆…」提示。
// 成功時訊息本身就會關掉提示，這裡主要是保險失敗／無輸出的情況。
export function pushThinkingDone(charId?: string): void {
  const payload = JSON.stringify({ type: 'thinking-done', characterId: charId ?? '' })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function pushRemoteControlState(): void {
  if (!bridge) return
  const payload = JSON.stringify({
    type: 'remote-control-state',
    randomToolsEnabled: bridge.getRandomToolsEnabled(),
    remoteControl: getRemoteControlClientState(bridge.getRemoteControlSettings())
  })
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function getConnectedCount(): number {
  return clients.size
}

// 移除大型／敏感欄位（debugPrompt、圖片 base64）
// 圖片改以 imageCount 表示，實際內容由 GET /api/message-image 按需取用，避免 WS 推播塞滿 base64
function sanitizeMessage(msg: Message): Partial<Message> & { imageCount?: number } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { debugPrompt, utilityDebugPrompt, images, ...rest } = msg
  return images && images.length ? { ...rest, imageCount: images.length } : rest
}

// ── 靜態資源路徑 ──────────────────────────────────────────

function getMobileHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'assets', 'mobile.html')
  }
  return path.join(app.getAppPath(), 'assets', 'mobile.html')
}

// ── 隨機工具邏輯 ───────────────────────────────────────────

/**
 * 擲出邏輯已搬進 `core/random/dice`（2026-08-04）。
 *
 * 這裡原本有一份獨立實作，且**權重與桌面版不一致**（御神籤與擲筊的機率都不同）——
 * 見 `docs/mobile-html-feature-inventory.md` §4。現統一走 core 那份。
 *
 * 這支端點收的是任意 JSON，所以先過 `sanitizePendingRandomTool` 夾範圍，
 * 再交給 core 算 —— 防禦留在信任邊界，不塞進核心算式。
 */
function rollRandomTool(tool: string, params: Record<string, number>): RandomResult | null {
  const pending = sanitizePendingRandomTool(tool, params)
  return pending ? computeRandomResult(pending) : null
}

// ── 圖片附件驗證 ───────────────────────────────────────────

const ALLOWED_IMAGE_MIME = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i

// 單張壓縮後的 data URL 上限（base64 約比原檔大 1/3）
const MAX_IMAGE_DATAURL_LEN = 6 * 1024 * 1024

// 只收 data:image/* base64，張數以設定為準，避免手機端塞進奇怪的東西
function sanitizeIncomingImages(raw: unknown, maxImages: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (!ALLOWED_IMAGE_MIME.test(item)) continue
    if (item.length > MAX_IMAGE_DATAURL_LEN) continue
    out.push(item)
    if (out.length >= Math.max(1, maxImages)) break
  }
  return out
}

// ── 角色卡的信任邊界處理（B3 階段 3）──────────────────────

/**
 * 把手機送來的角色卡併回本機那張。
 *
 * **只接受文字欄位。** `avatar` / `emotions` / `spriteIds` 一律沿用本機既有值 ——
 * 那些是電腦上的**檔案路徑**，而 `GET /api/avatar/:id` 會照著它讀檔並回傳內容。
 * 讓遠端指定路徑等於開一個「讀取電腦上任意檔案」的洞。
 * 手機換主圖只能走 `/api/characters/avatar`（圖檔由電腦端自己落地、自己命名）。
 *
 * `id` / `createdAt` 同樣以本機為準：改 id 等於偷偷換掉另一張卡。
 */
function mergeCharacterFromRemote(
  existing: import('./types').Character,
  incoming: Partial<import('./types').Character>
): import('./types').Character {
  const str = (v: unknown, max: number, fallback = ''): string =>
    typeof v === 'string' ? v.slice(0, max) : fallback
  const strList = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50).map(s => s.slice(0, max)) : []

  return {
    ...existing,
    name: str(incoming.name, 100, existing.name),
    nicknames: strList(incoming.nicknames, 40),
    description: str(incoming.description, 20000),
    personality: str(incoming.personality, 20000),
    firstMessage: str(incoming.firstMessage, 20000),
    exampleDialogue: str(incoming.exampleDialogue, 20000),
    scenario: str(incoming.scenario, 20000),
    creatorNotes: str(incoming.creatorNotes, 20000),
    systemPromptOverride: str(incoming.systemPromptOverride, 20000),
    newsKeywords: strList(incoming.newsKeywords, 40),
    lorebookIds: strList(incoming.lorebookIds, 100)
  }
}

/** 匯出檔名：去掉路徑分隔與控制字元，避免使用者的角色名變成一段路徑。 */
function safeFileBase(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>| -]/g, '_').trim()
  return cleaned.slice(0, 60) || 'character'
}

/** 收 base64（可含 `data:` 前綴）→ ArrayBuffer；空的或不是字串回 null。 */
function decodeBase64Payload(data: unknown): ArrayBuffer | null {
  if (typeof data !== 'string' || !data) return null
  const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data
  const buf = Buffer.from(b64, 'base64')
  if (buf.length === 0) return null
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/** 允許的主題值。信任邊界上要夾，不能讓任意字串寫進設定。 */
const MOBILE_COLOR_THEMES: string[] = ['mint', 'butter', 'peach', 'aqua', 'sky', 'blush', 'lavender', 'white', 'dark']

// ── HTTP 路由 ─────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const rawUrl = req.url ?? '/'
  const requestUrl = new URL(rawUrl, 'http://localhost')
  const url = requestUrl.pathname
  const method = req.method ?? 'GET'

  // CORS headers（讓瀏覽器能正常存取）
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DesktopST-Token, Authorization, X-Device-Id, X-Device-Nickname, X-Remote-Confirmed, X-Remote-Confirmation')

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (!isAuthorized(req, requestUrl)) {
    jsonError(res, 401, 'Unauthorized')
    return
  }

  // ── GET / → mobile.html ──
  if (method === 'GET' && url === '/') {
    const htmlPath = getMobileHtmlPath()
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Mobile UI not found. (assets/mobile.html missing)')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(fs.readFileSync(htmlPath))
    return
  }

  // ── GET /api/state ──
  if (method === 'GET' && url === '/api/state') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const conv = bridge.getActiveConversation()
    const desktopChars = bridge.getDesktopCharacters()
    jsonOk(res, {
      desktopCharacters: desktopChars,
      conversation: conv
        ? { id: conv.id, title: conv.title, messages: conv.messages.slice(-50).map(sanitizeMessage) }
        : null,
      colorTheme: bridge.getColorTheme(),
      randomToolsEnabled: bridge.getRandomToolsEnabled(),
      maxImages: bridge.getMaxImagesPerMessage(),
      remoteControl: getRemoteControlClientStateForDevice(bridge.getRemoteControlSettings(), getDeviceIdFromRequest(req))
    })
    return
  }

  // ── GET /api/avatar/:id ──
  const avatarMatch = url.match(/^\/api\/avatar\/(.+)$/)
  if (method === 'GET' && avatarMatch) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const charId = decodeURIComponent(avatarMatch[1])
    const char = bridge.getCharacters().find(c => c.id === charId)
    if (!char?.avatar) { jsonError(res, 404, 'Not found'); return }

    const avatar = char.avatar
    if (avatar.startsWith('data:image/')) {
      const [header, b64] = avatar.split(',')
      const mime = header.replace('data:', '').replace(';base64', '')
      res.writeHead(200, { 'Content-Type': mime })
      res.end(Buffer.from(b64, 'base64'))
    } else if (fs.existsSync(avatar)) {
      const ext = path.extname(avatar).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
      res.writeHead(200, { 'Content-Type': mime })
      res.end(fs.readFileSync(avatar))
    } else {
      jsonError(res, 404, 'Avatar not found')
    }
    return
  }

  // ── GET /api/message-image/:msgId/:index ──
  // 訊息圖片不隨 state / WS 推播（base64 太肥），改由這裡按需取用
  const msgImgMatch = url.match(/^\/api\/message-image\/([^/]+)\/(\d+)$/)
  if (method === 'GET' && msgImgMatch) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const msgId = decodeURIComponent(msgImgMatch[1])
    const index = Number(msgImgMatch[2])
    const conv = bridge.getActiveConversation()
    const msg = conv?.messages.find(m => m.id === msgId)
    const dataUrl = msg?.images?.[index]
    if (!dataUrl || !dataUrl.startsWith('data:image/')) { jsonError(res, 404, 'Not found'); return }
    const [header, b64] = dataUrl.split(',')
    const mime = header.replace('data:', '').replace(';base64', '')
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=86400' })
    res.end(Buffer.from(b64, 'base64'))
    return
  }

  // ── POST /api/send ──
  if (method === 'POST' && url === '/api/send') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req, SEND_MAX_BODY)
    if (body === BODY_TOO_LARGE) { jsonError(res, 413, '圖片太大，請減少張數或降低畫質'); return }
    let payload: { content?: string; images?: unknown; randomResult?: RandomResult; randomResults?: RandomResult[]; skipLlm?: boolean }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    const content = String(payload.content ?? '').trim()
    const images = sanitizeIncomingImages(payload.images, bridge.getMaxImagesPerMessage())
    if (!content && !images.length && !payload.randomResult && !(payload.randomResults && payload.randomResults.length)) { jsonError(res, 400, 'Empty message'); return }
    try {
      const sourceDeviceName = bridge.shouldIncludeDeviceNameInPrompt()
        ? getDeviceDisplayNameFromRequest(req)
        : undefined
      await bridge.sendMessage({ content, images: images.length ? images : undefined, randomResult: payload.randomResult, randomResults: payload.randomResults, skipLlm: payload.skipLlm, sourceDeviceName })
      jsonOk(res, { ok: true })
    } catch (e) {
      jsonError(res, 500, String(e))
    }
    return
  }

  // ── GET /api/characters/library ──
  if (method === 'GET' && url === '/api/characters/library') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const desktopIds = new Set(bridge.getDesktopCharacterIds())
    const chars = bridge.getCharacters().map(c => ({
      id: c.id,
      name: c.name,
      onDesktop: desktopIds.has(c.id)
    }))
    jsonOk(res, { characters: chars })
    return
  }

  // ── GET /api/characters/desktop ──
  if (method === 'GET' && url === '/api/characters/desktop') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const desktopIds = bridge.getDesktopCharacterIds()
    const allChars = bridge.getCharacters()
    const chars = allChars
      .filter(c => desktopIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name }))
    jsonOk(res, { characters: chars })
    return
  }

  // ── POST /api/characters/desktop/add ──
  if (method === 'POST' && url === '/api/characters/desktop/add') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { characterId?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.characterId) { jsonError(res, 400, 'characterId required'); return }
    const ok = await bridge.addDesktopCharacter(payload.characterId)
    if (ok) pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/characters/desktop/remove ──
  if (method === 'POST' && url === '/api/characters/desktop/remove') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { characterId?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.characterId) { jsonError(res, 400, 'characterId required'); return }
    const ok = bridge.removeDesktopCharacter(payload.characterId)
    if (ok) pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok })
    return
  }

  // ── GET /api/conversations ──
  if (method === 'GET' && url === '/api/conversations') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { conversations: bridge.getConversationList() })
    return
  }

  // ── POST /api/conversations/load ──
  if (method === 'POST' && url === '/api/conversations/load') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const ok = bridge.loadConversation(payload.id)
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/conversations/new ──
  if (method === 'POST' && url === '/api/conversations/new') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { title?: string } = {}
    if (body.trim()) {
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    }
    jsonOk(res, { conversation: bridge.createConversation(payload.title) })
    return
  }

  // ── POST /api/conversations/rename ──
  if (method === 'POST' && url === '/api/conversations/rename') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string; title?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const result = bridge.renameConversation(payload.id, String(payload.title ?? ''))
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, result)
    return
  }

  // ── POST /api/conversations/delete ──
  if (method === 'POST' && url === '/api/conversations/delete') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const result = bridge.deleteConversation(payload.id)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, result)
    return
  }

  // ── POST /api/characters/speak ──
  if (method === 'POST' && url === '/api/characters/speak') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { characterId?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.characterId) { jsonError(res, 400, 'characterId required'); return }
    const result = await bridge.forceSpeak(payload.characterId)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, result)
    return
  }

  // ── POST /api/characters/toggle-mute ──
  if (method === 'POST' && url === '/api/characters/toggle-mute') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { characterId?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.characterId) { jsonError(res, 400, 'characterId required'); return }
    const muted = bridge.toggleMute(payload.characterId)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { muted })
    return
  }

  // ── GET /api/scenes ──
  if (method === 'GET' && url === '/api/scenes') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const scenes = bridge.getScenes().map(s => ({ id: s.id, name: s.name }))
    jsonOk(res, { scenes })
    return
  }

  // ── POST /api/scenes/apply ──
  if (method === 'POST' && url === '/api/scenes/apply') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const result = bridge.applyScene(payload.id)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    // After scene, push updated desktop
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
    return
  }

  // ── GET /api/presets ──
  if (method === 'GET' && url === '/api/presets') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const personas = bridge.getPersonaPresets().map(p => ({
      id: p.id, name: p.name, displayName: p.displayName, nickname: p.nickname
    }))
    const worlds = bridge.getWorldPresets().map(w => ({
      id: w.id, name: w.name, worldSetting: w.worldSetting.slice(0, 100)
    }))
    jsonOk(res, {
      personas,
      worlds,
      activePersonaId: bridge.getActivePersonaId(),
      activeWorldId: bridge.getActiveWorldId()
    })
    return
  }

  // ── POST /api/presets/activate-persona ──
  if (method === 'POST' && url === '/api/presets/activate-persona') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const ok = bridge.activatePersona(payload.id)
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/presets/activate-world ──
  if (method === 'POST' && url === '/api/presets/activate-world') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const ok = bridge.activateWorld(payload.id)
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/settings/color-theme ──
  // 主題是電腦端設定的一部分，手機改了要寫回來，否則重新整理就跳回舊的。
  if (method === 'POST' && url === '/api/settings/color-theme') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { theme?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    const theme = String(payload.theme ?? '')
    if (!MOBILE_COLOR_THEMES.includes(theme)) { jsonError(res, 400, 'Unknown theme'); return }
    bridge.setColorTheme(theme as import('./types').ColorTheme)
    // 讓其他已連線的裝置重抓（它們收到後會呼叫 fetchState）。
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
    return
  }

  // ── GET /api/screenshot/clean|with-chars ──
  if (method === 'GET' && (url.startsWith('/api/screenshot/clean') || url.startsWith('/api/screenshot/with-chars'))) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const displayIndex = parseInt(requestUrl.searchParams.get('displayIndex') ?? '0') || 0
    const withChars = url === '/api/screenshot/with-chars'
    const result = await bridge.captureScreenshot(withChars, displayIndex)
    if (!result.ok || !result.dataUrl) { jsonError(res, 500, result.error ?? 'Screenshot failed'); return }
    const [header, b64] = result.dataUrl.split(',')
    const mime = header.replace('data:', '').replace(';base64', '')
    // X-Display-Bounds 讓手機端知道這張截圖對應的螢幕物理座標範圍，用於遙控點擊座標換算
    const { screen: scr } = await import('electron')
    const displays = scr.getAllDisplays()
    const disp = displays[displayIndex] ?? displays[0]
    if (disp) {
      const b = disp.bounds
      res.setHeader('X-Display-Bounds', JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height }))
      res.setHeader('X-Scale-Factor', String(disp.scaleFactor ?? 1))
    }
    res.writeHead(200, { 'Content-Type': mime })
    res.end(Buffer.from(b64, 'base64'))
    return
  }

  // ── GET /api/displays ──
  if (method === 'GET' && url === '/api/displays') {
    const { screen: s } = await import('electron')
    const displays = s.getAllDisplays()
    const primary = s.getPrimaryDisplay()
    jsonOk(res, displays.map((d, i) => ({
      index: i,
      label: `螢幕 ${i + 1}${d.id === primary.id ? '（主）' : ''}`,
      isPrimary: d.id === primary.id,
      bounds: d.bounds,
      size: d.size
    })))
    return
  }

  // ── GET /api/windows ──
  if (method === 'GET' && url === '/api/windows') {
    const { exec } = await import('child_process')
    const { screen: s } = await import('electron')
    // 取得有主視窗的程序列表（含位置，用於判斷所在螢幕）
    const script = [
      '$OutputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WH{[DllImport(\\"user32.dll\\")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[DllImport(\\"user32.dll\\")]public static extern bool IsIconic(IntPtr h);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}}\'',
      '$w=Get-Process|?{$_.MainWindowHandle-ne 0-and $_.MainWindowTitle-ne \'\'}|%{$hwnd=$_.MainWindowHandle;$r=New-Object WH+RECT;[WH]::GetWindowRect($hwnd,[ref]$r)|Out-Null;[pscustomobject]@{pid=$_.Id;hwnd=$hwnd.ToInt64();title=$_.MainWindowTitle;proc=$_.ProcessName;minimized=[WH]::IsIconic($hwnd);x=$r.L;y=$r.T;w=$r.R-$r.L;h=$r.B-$r.T}}',
      'if($w){$w|ConvertTo-Json -Compress -Depth 1}else{\'[]\'}'
    ].join(';')
    const raw = await new Promise<string>((resolve) => {
      exec(`powershell -NoProfile -NonInteractive -Command "${script}"`, { encoding: 'utf8', timeout: 6000 }, (err, stdout) => {
        resolve(err ? '[]' : stdout.trim())
      })
    })
    try {
      const arr = JSON.parse(raw)
      const wins = (Array.isArray(arr) ? arr : [arr]).filter(w => w?.title)
      const displays = s.getAllDisplays()
      const result = wins.map(w => {
        const cx = (w.x ?? 0) + (w.w ?? 0) / 2
        const cy = (w.y ?? 0) + (w.h ?? 0) / 2
        const di = displays.findIndex(d =>
          cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width &&
          cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height
        )
        return { pid: w.pid, hwnd: w.hwnd, title: w.title, proc: w.proc, minimized: !!w.minimized, displayIndex: di >= 0 ? di : 0, x: w.x ?? 0, y: w.y ?? 0, w: w.w ?? 0, h: w.h ?? 0 }
      })
      jsonOk(res, result)
    } catch { jsonOk(res, []) }
    return
  }

  // ── POST /api/capture-window ──
  // 若視窗最小化先 SW_RESTORE（不搶焦點），再用 desktopCapturer 截圖回傳
  if (method === 'POST' && url === '/api/capture-window') {
    const body = await readBody(req)
    let payload: { hwnd?: number; title?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.title) { jsonError(res, 400, 'title required'); return }

    // 若最小化先還原（ShowWindow 不影響輸入焦點，安全）
    if (payload.hwnd) {
      const { exec } = await import('child_process')
      const hwnd = Number(payload.hwnd)
      const restoreScript = [
        'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WR{[DllImport(\\"user32.dll\\")]public static extern bool IsIconic(IntPtr h);[DllImport(\\"user32.dll\\")]public static extern bool ShowWindow(IntPtr h,int c);}\'',
        `$h=[IntPtr]::new(${hwnd})`,
        'if([WR]::IsIconic($h)){[WR]::ShowWindow($h,9)|Out-Null;Write-Output "restored"}else{Write-Output "ok"}'
      ].join(';')
      const restored = await new Promise<boolean>((resolve) => {
        exec(`powershell -NoProfile -NonInteractive -Command "${restoreScript}"`, { encoding: 'utf8', timeout: 3000 }, (_err, stdout) => {
          resolve(stdout.trim().includes('restored'))
        })
      })
      if (restored) await new Promise(r => setTimeout(r, 350))
    }

    // 用 desktopCapturer 截取該視窗
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 2560, height: 1600 }
      })
      const title = payload.title
      const source = sources.find(s => s.name === title)
        ?? sources.find(s => s.name.includes(title) || title.includes(s.name))
      if (!source) { jsonError(res, 404, 'Window not found in capture sources'); return }
      const dataUrl = source.thumbnail.toDataURL()
      if (!dataUrl || dataUrl.length < 200) { jsonError(res, 500, 'Empty thumbnail'); return }
      const [header, b64] = dataUrl.split(',')
      const mime = header.replace('data:', '').replace(';base64', '')
      // X-Window-Bounds：視窗的實際可視範圍（供遙控點擊座標換算）
      // 優先用 DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS=9) 取得視覺邊界（不含陰影），
      // 失敗時 fallback 到 GetWindowRect
      if (payload.hwnd) {
        const { exec: e2 } = await import('child_process')
        const boundsScript = [
          'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;',
          '[StructLayout(LayoutKind.Sequential)]public struct WRECT{public int L,T,R,B;}',
          'public class WBounds{',
          '[DllImport(\\"dwmapi.dll\\")]public static extern int DwmGetWindowAttribute(IntPtr h,int a,out WRECT r,int s);',
          '[DllImport(\\"user32.dll\\")]public static extern bool GetWindowRect(IntPtr h,out WRECT r);}\'',
          `$h=[IntPtr]::new(${Number(payload.hwnd)});$r=New-Object WRECT`,
          '$sz=[System.Runtime.InteropServices.Marshal]::SizeOf([WRECT])',
          '$hr=[WBounds]::DwmGetWindowAttribute($h,9,[ref]$r,$sz)',
          'if($hr-eq 0){Write-Output "$($r.L),$($r.T),$($r.R-$r.L),$($r.B-$r.T)"}',
          'else{[WBounds]::GetWindowRect($h,[ref]$r)|Out-Null;Write-Output "$($r.L),$($r.T),$($r.R-$r.L),$($r.B-$r.T)"}'
        ].join('')
        const boundsRaw = await new Promise<string>(r => {
          e2(`powershell -NoProfile -NonInteractive -Command "${boundsScript}"`, { encoding: 'utf8', timeout: 4000 }, (_, out) => r(out?.trim() ?? ''))
        })
        if (boundsRaw) {
          const [wx, wy, ww, wh] = boundsRaw.split(',').map(Number)
          if (!isNaN(wx) && ww > 0 && wh > 0) res.setHeader('X-Window-Bounds', JSON.stringify({ x: wx, y: wy, w: ww, h: wh }))
        }
      }
      res.writeHead(200, { 'Content-Type': mime })
      res.end(Buffer.from(b64, 'base64'))
    } catch (e) {
      jsonError(res, 500, String(e))
    }
    return
  }

  // ── POST /api/messages/delete ──
  if (method === 'POST' && url === '/api/messages/delete') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const ok = bridge.deleteMessage(payload.id)
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/messages/edit ──
  if (method === 'POST' && url === '/api/messages/edit') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string; content?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id || payload.content == null) { jsonError(res, 400, 'id and content required'); return }
    const ok = bridge.editMessage(payload.id, payload.content)
    jsonOk(res, { ok })
    return
  }

  // ── POST /api/messages/resend ──
  if (method === 'POST' && url === '/api/messages/resend') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const result = await bridge.resendMessage(payload.id)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, { ok: true })
    return
  }

  // ── POST /api/random ──
  if (method === 'POST' && url === '/api/random') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    if (!bridge.getRandomToolsEnabled()) { jsonError(res, 403, 'Random tools disabled'); return }
    const body = await readBody(req)
    let payload: { tool: string; faces?: number; count?: number; modifier?: number; keepHighest?: number; keepLowest?: number }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tool: _t, ...numParams } = payload
    const result = rollRandomTool(payload.tool, numParams as Record<string, number>)
    if (!result) { jsonError(res, 400, 'Unknown tool'); return }
    jsonOk(res, { result })
    return
  }

  // ── 角色卡讀寫（B3 階段 3）────────────────────────────────
  //
  // ⚠️ **這裡是信任邊界。** 手機送來的角色卡不可以整包直接存：
  // `avatar` / `emotions` / `spriteIds` 是**本機檔案路徑**，
  // 讓外部指定等於「叫 GET /api/avatar/:id 去讀電腦上任何一個檔案」。
  // 圖片一律只能經 `/api/characters/avatar` 落地，見 `mergeCharacterFromRemote`。

  const cardMatch = url.match(/^\/api\/characters\/card\/(.+)$/)
  if (method === 'GET' && cardMatch) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const card = bridge.getCharacterCard(decodeURIComponent(cardMatch[1]))
    if (!card) { jsonError(res, 404, 'Character not found'); return }
    jsonOk(res, { character: card })
    return
  }

  if (method === 'POST' && url === '/api/characters/create') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ name?: string }>(req, res)
    if (!payload) return
    jsonOk(res, { character: bridge.createCharacter(String(payload.name ?? '').slice(0, 100)) })
    return
  }

  if (method === 'POST' && url === '/api/characters/save') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ character?: unknown }>(req, res)
    if (!payload) return
    const incoming = payload.character as Partial<import('./types').Character> | undefined
    const id = typeof incoming?.id === 'string' ? incoming.id : ''
    const existing = id ? bridge.getCharacterCard(id) : null
    if (!existing) { jsonError(res, 404, 'Character not found'); return }
    if (!String(incoming?.name ?? '').trim()) { jsonError(res, 400, '角色名稱不可空白'); return }
    bridge.saveCharacter(mergeCharacterFromRemote(existing, incoming ?? {}))
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/characters/delete') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    if (!bridge.getCharacterCard(payload.id)) { jsonError(res, 404, 'Character not found'); return }
    bridge.deleteCharacter(payload.id)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/characters/avatar') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string; data?: string; ext?: string }>(req, res, MEDIA_MAX_BODY)
    if (!payload) return
    const bytes = decodeBase64Payload(payload.data)
    if (!payload.id || !bytes) { jsonError(res, 400, 'id and data required'); return }
    const r = bridge.saveCharacterAvatar(payload.id, bytes, String(payload.ext ?? '.png'))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { avatar: r.path })
    return
  }

  if (method === 'POST' && url === '/api/characters/import-card') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ kind?: string; data?: string }>(req, res, MEDIA_MAX_BODY)
    if (!payload) return
    const bytes = decodeBase64Payload(payload.data)
    if (!bytes) { jsonError(res, 400, 'data required'); return }
    const r = payload.kind === 'json'
      ? bridge.importCharacterJson(Buffer.from(bytes).toString('utf-8'))
      : bridge.importCharacterPng(bytes)
    if ('error' in r) { jsonError(res, 400, r.error); return }
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { character: r })
    return
  }

  if (method === 'POST' && url === '/api/characters/export-card') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string; kind?: string }>(req, res)
    if (!payload) return
    const card = payload.id ? bridge.getCharacterCard(payload.id) : null
    if (!card) { jsonError(res, 404, 'Character not found'); return }
    if (payload.kind === 'json') {
      const r = bridge.exportCharacterJson(card)
      if ('error' in r) { jsonError(res, 400, r.error); return }
      jsonOk(res, { data: Buffer.from(r.json, 'utf-8').toString('base64'), filename: `${safeFileBase(card.name)}.json` })
      return
    }
    const r = bridge.exportCharacterPng(card)
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { data: Buffer.from(r.buffer).toString('base64'), filename: `${safeFileBase(card.name)}.png` })
    return
  }

  if (method === 'POST' && url === '/api/characters/export-pack') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ ids?: unknown; includeGlobalSettings?: boolean; includeLorebooks?: boolean }>(req, res)
    if (!payload) return
    const ids = Array.isArray(payload.ids) ? payload.ids.filter((x): x is string => typeof x === 'string') : []
    const r = await bridge.buildDstPack({
      characterIds: ids,
      includeGlobalSettings: !!payload.includeGlobalSettings,
      includeLorebooks: !!payload.includeLorebooks
    })
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { data: Buffer.from(r.buffer).toString('base64'), filename: `DeST-${new Date().toISOString().slice(0, 10)}.dstpack` })
    return
  }

  if (method === 'POST' && url === '/api/characters/import-pack') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ data?: string; onConflict?: string; applyGlobalSettings?: boolean }>(req, res, MEDIA_MAX_BODY)
    if (!payload) return
    const bytes = decodeBase64Payload(payload.data)
    if (!bytes) { jsonError(res, 400, 'data required'); return }
    // 桌面版靠對話框逐一問；手機端**在送出前就選好策略**（電腦前面沒有人，
    // 彈一個對話框等於讓手機那頭卡住直到有人回家）。不認得的值一律當最保守的 skip。
    const onConflict = payload.onConflict === 'overwrite' || payload.onConflict === 'new' ? payload.onConflict : 'skip'
    const r = await bridge.importDstPack(bytes, { onConflict, applyGlobalSettings: !!payload.applyGlobalSettings })
    if ('error' in r) { jsonError(res, 400, r.error); return }
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { imported: r.imported, skipped: r.skipped })
    return
  }

  // ── GET /api/lorebooks ──
  // 角色卡編輯器要讓使用者勾「這個角色帶哪幾本」，只需要 id 與名字。
  if (method === 'GET' && url === '/api/lorebooks') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { lorebooks: bridge.listLorebooks() })
    return
  }

  // -- Module route registry ---------------------------------------------
  const moduleRoute = findRegisteredRoute(method, url)
  if (moduleRoute) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    await moduleRoute.handler({ req, res, method, url, requestUrl, host: bridge })
    return
  }
  // ── GET /api/system/lock-status ──
  // 偵測 Windows 是否鎖定（logonui.exe 以 Session 0+ 執行代表登入畫面）
  if (method === 'GET' && url === '/api/system/lock-status') {
    const { exec: e4 } = await import('child_process')
    const lockScript = `$p=Get-Process logonui -ErrorAction SilentlyContinue;if($p){'locked'}else{'unlocked'}`
    const status = await new Promise<string>(resolve => {
      e4(`powershell -NoProfile -NonInteractive -Command "${lockScript}"`, { encoding: 'utf8', timeout: 3000 }, (_, out) => {
        resolve(out?.trim() === 'locked' ? 'locked' : 'unlocked')
      })
    })
    jsonOk(res, { locked: status === 'locked' })
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
}

// ── 伺服器生命週期 ─────────────────────────────────────────

let server: http.Server | null = null
let wss: WebSocketServer | null = null
let currentPort = 3721

export function getPort(): number { return currentPort }

export function isServerRunning(): boolean { return server !== null }

export function startMobileServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(); return }

    currentPort = port
    server = http.createServer((req, res) => {
      handleRequest(req, res).catch(e => {
        console.error('[MobileServer] Request error:', e)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('Internal server error')
        }
      })
    })

    wss = new WebSocketServer({ server })
    wss.on('connection', (ws, req) => {
      const requestUrl = new URL(req.url ?? '/', 'http://localhost')
      if (!isAuthorized(req, requestUrl)) {
        ws.close(1008, 'Unauthorized')
        return
      }
      clients.add(ws)
      console.log(`[MobileServer] Client connected (total: ${clients.size})`)
      ws.on('close', () => {
        clients.delete(ws)
        console.log(`[MobileServer] Client disconnected (total: ${clients.size})`)
      })
      ws.on('error', () => clients.delete(ws))
    })

    server.listen(port, '0.0.0.0', () => {
      console.log(`[MobileServer] Listening on port ${port}`)
      resolve()
    })

    server.on('error', (e) => {
      console.error('[MobileServer] Server error:', e)
      server = null
      wss = null
      reject(e)
    })
  })
}

export function stopMobileServer(): void {
  for (const ws of clients) {
    try { ws.close() } catch {}
  }
  clients.clear()
  wss?.close()
  server?.close()
  server = null
  wss = null
}

// ── 工具函式 ──────────────────────────────────────────────

function jsonOk(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function jsonError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

// 超過上限時回傳這個哨符字串（不可能出現在正常 JSON body 裡）
const BODY_TOO_LARGE = '\u0000__BODY_TOO_LARGE__'

const DEFAULT_MAX_BODY = 1024 * 1024          // 一般路由：1 MB 綽綽有餘
const SEND_MAX_BODY = 24 * 1024 * 1024        // /api/send 帶壓縮後圖片，放寬到 24 MB
const MEDIA_MAX_BODY = 24 * 1024 * 1024       // 主圖／角色卡／DST Pack 匯入（base64 比原檔大 1/3）

/**
 * 讀 body 並解析成 JSON；失敗時自己回錯誤並回傳 `null`（呼叫端直接 `return`）。
 *
 * 純粹是為了讓上面那批新端點不必每支都重寫五行同樣的 try/catch —— 既有端點
 * 蓄意不動，改它們只會製造與行為無關的 diff。
 */
async function readJson<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number = DEFAULT_MAX_BODY
): Promise<T | null> {
  const body = await readBody(req, maxBytes)
  if (body === BODY_TOO_LARGE) { jsonError(res, 413, '檔案太大'); return null }
  if (!body.trim()) return {} as T
  try {
    return JSON.parse(body) as T
  } catch {
    jsonError(res, 400, 'Invalid JSON')
    return null
  }
}

function readBody(req: http.IncomingMessage, maxBytes: number = DEFAULT_MAX_BODY): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    let size = 0
    let aborted = false
    req.on('data', chunk => {
      if (aborted) return
      size += chunk.length
      if (size > maxBytes) {
        aborted = true
        resolve(BODY_TOO_LARGE)
        req.destroy()
        return
      }
      body += chunk.toString()
    })
    req.on('end', () => { if (!aborted) resolve(body) })
    req.on('error', () => { if (!aborted) resolve('') })
  })
}

function getDeviceIdFromRequest(req: http.IncomingMessage): string {
  const rawId = req.headers['x-device-id']
  return (Array.isArray(rawId) ? rawId[0] : rawId) ?? ''
}

function getDeviceDisplayNameFromRequest(req: http.IncomingMessage): string {
  const rawNickname = req.headers['x-device-nickname']
  const nicknameHeader = (Array.isArray(rawNickname) ? rawNickname[0] : rawNickname) ?? ''
  let nickname = nicknameHeader.trim()
  try { nickname = decodeURIComponent(nicknameHeader).trim() } catch {}
  const deviceId = getDeviceIdFromRequest(req).trim()
  return nickname && nickname !== 'unnamed' ? nickname : deviceId
}

function isAuthorized(req: http.IncomingMessage, url: URL): boolean {
  const expected = getAccessToken()
  const header = req.headers['x-desktopst-token']
  const headerToken = Array.isArray(header) ? header[0] : header
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : ''
  const queryToken = url.searchParams.get('token') ?? ''
  return headerToken === expected || bearer === expected || queryToken === expected
}

// 讓 screenshot 能用 desktopCapturer（需從 electron import）
export async function captureScreen(withChars: boolean): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  void withChars // 由 bridge 控制隱藏邏輯，這裡只負責截圖
  try {
    const { screen } = await import('electron')
    const display = screen.getPrimaryDisplay()
    const { width, height } = display.size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    })
    const source = sources[0]
    if (!source) return { ok: false, error: 'No screen source' }
    const dataUrl = source.thumbnail.toDataURL()
    return { ok: true, dataUrl }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
