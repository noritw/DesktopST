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
  sendMessage: (payload: {
    content: string
    images?: string[]
    randomResult?: RandomResult
    randomResults?: RandomResult[]
    skipLlm?: boolean
    sourceDeviceName?: string
    newsLink?: import('./types').NewsLinkInfo | null
  }) => Promise<void>
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
  getActiveSceneId: () => string | undefined
  getPersonaPreset: (id: string) => import('./types').PersonaPreset | null
  getWorldPreset: (id: string) => import('./types').WorldPreset | null
  getScenePreset: (id: string) => import('./types').ScenePreset | null
  savePersonaPreset: (preset: import('./types').PersonaPreset) => import('./types').PersonaPreset
  saveWorldPreset: (preset: import('./types').WorldPreset) => import('./types').WorldPreset
  saveScenePreset: (preset: import('./types').ScenePreset) => import('./types').ScenePreset
  /**
   * 把目前桌面／設定狀態覆寫進情境（含 colorTheme）。
   * `id` 為 null 時新建；既有 id 則覆寫並保留新聞關鍵字組／用語解說／模組覆蓋。
   */
  captureScene: (id: string | null, name: string) => import('./types').ScenePreset
  getActiveSceneDirty: () => boolean
  removePersonaPreset: (id: string) => { ok: true } | { error: string }
  removeWorldPreset: (id: string) => { ok: true } | { error: string }
  removeScenePreset: (id: string) => { ok: true } | { error: string }
  getColorTheme: () => string
  getRandomToolsEnabled: () => boolean
  /**
   * S1 初始化匯入用的明文金鑰。
   * **只能在 `isLanDirectRequest()` 為真的分支呼叫**（roadmap §4.7）。
   */
  getApiKeysForSync: () => Record<string, string>
  /**
   * 這台電腦在區網裡的位址（`http://192.168.x.x:3721`，不含權杖）。
   * 掃 QR 拿到的多半是 relay 網址，手機靠這個把連線升級成區網直連（S1）。
   */
  getLanBaseUrl: () => string
  getShowLlmBadge: () => boolean
  setShowLlmBadge: (show: boolean) => boolean
  getShowPersonaName: () => boolean
  setShowPersonaName: (show: boolean) => boolean
  /** 某則訊息保留的完整 prompt（除錯用）；太舊被剝掉就回 null。 */
  getMessageDebug: (id: string) => unknown
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
  deleteCharacter: (id: string) => { ok: true } | { error: 'last-character' | 'not-found' }
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
  getLorebook: (id: string) => import('../core/lore').Lorebook | null
  createLorebook: (name?: string) => import('../core/lore').Lorebook
  saveLorebook: (book: import('../core/lore').Lorebook) => { ok: true; book: import('../core/lore').Lorebook } | { error: string }
  removeLorebook: (id: string) => { ok: true }
  getRemoteControlSettings: () => import('./types').RemoteControlSettings | undefined
  setRemoteControlEnabled: (enabled: boolean) => { ok: true } | { error: string }
  touchAllowedRemoteDevice?: (device: { id: string; nickname: string; label?: string }) => void
  notifyRemoteClickPending: () => void  // 點擊前廣播：讓角色視窗暫時穿透
  notifyRemoteAction: () => void        // 點擊後廣播：顯示遠端控制指示
  hideWindowsForRemote: () => void      // 遙控模式：隱藏所有 DeST 視窗
  restoreWindowsForRemote: () => void   // 遙控模式：恢復所有 DeST 視窗
  // ── 設定（B3 階段 4）──
  // 邏輯全在 `ipcHandlers.ts` 的 *Direct，桌面設定視窗與手機共用同一份。
  getLlmSettings: () => {
    provider: string
    model: string
    models: Record<string, string | undefined>
    endpoint?: string
    hasApiKey: Record<string, boolean>
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
  }
  setLlmProvider: (provider: string) => { ok: true } | { error: string }
  setLlmModel: (provider: string, model: string) => { ok: true } | { error: string }
  setLlmEndpoint: (endpoint: string) => { ok: true } | { error: string }
  setLlmApiKey: (provider: string, apiKey: string) => { ok: true } | { error: string }
  setLlmChatLimits: (limits: {
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
  }) => { ok: true } | { error: string }
  getMemorySettings: () => { keepRecentN: number; autoSummarizeAfter: number; autoSummarizeEnabled: boolean }
  setMemorySettings: (m: { keepRecentN: number; autoSummarizeAfter: number; autoSummarizeEnabled: boolean }) => { ok: true } | { error: string }
  listModuleToggles: () => { id: string; label: string; enabled: boolean }[]
  setModuleToggle: (id: string, enabled: boolean) => { ok: true } | { error: string }
  getWeatherSettings: () => {
    enabled: boolean
    polish: boolean
    locationName: string
    latitude: number
    longitude: number
    locationSource: 'ip' | 'manual' | ''
    utilityEnabled: boolean
  }
  setWeatherSettings: (patch: {
    enabled?: boolean
    polish?: boolean
    locationName?: string
    latitude?: number
    longitude?: number
    locationSource?: 'ip' | 'manual' | ''
  }) => { ok: true; weather: ReturnType<MobileBridge['getWeatherSettings']> } | { error: string }
  detectWeatherLocation: () => Promise<{ ok: true; weather: ReturnType<MobileBridge['getWeatherSettings']> } | { error: string }>
  geocodeWeatherLocation: (name: string) => Promise<{ ok: true; weather: ReturnType<MobileBridge['getWeatherSettings']> } | { error: string }>
  fetchWeatherNow: () => Promise<
    { ok: true; description: string; temperatureC: number; humidity: number; windSpeed: number } | { error: string }
  >
  // ── 提醒 CRUD（B3 階段 4；排程本身是 B5）──
  listReminders: () => import('./types').Reminder[]
  createReminder: () => import('./types').Reminder
  saveReminder: (reminder: import('./types').Reminder) => import('./types').Reminder
  deleteReminder: (id: string) => void
  toggleReminder: (id: string, enabled: boolean) => void
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

/**
 * 手機 UI（B3 React）的建置產物目錄。
 *
 * `out/**` 已在 `electron-builder.yml` 的 `files` 裡，打包後在 asar 內，
 * 而 `fs` 讀得到 asar，所以 dev 與打包都能用 `app.getAppPath()` 解析。
 */
function getMobileAppDir(): string {
  return path.join(app.getAppPath(), 'out', 'mobile')
}

/** 有沒有跑過 `npm run build:mobile`。沒有的話 QR 視窗要顯示提示而不是給一個壞掉的碼。 */
export function isMobileAppBuilt(): boolean {
  try {
    return fs.existsSync(path.join(getMobileAppDir(), 'index.html'))
  } catch {
    return false
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

/**
 * 供應 `out/mobile/` 底下的靜態檔。
 *
 * ⚠️ **一定要擋路徑穿越。** 這台伺服器對區網（甚至經 relay 對外）開著，
 * `/app/../../settings.json` 這種請求若照單全收就等於把整台電腦的檔案交出去。
 * 作法是解析成絕對路徑後確認仍在 `out/mobile` 之內，不在就 404。
 */
function serveMobileAppFile(res: http.ServerResponse, relativePath: string): void {
  const root = getMobileAppDir()
  const target = path.resolve(root, relativePath || 'index.html')
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (target !== root && !target.startsWith(rootWithSep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }
  const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream'
  // 帶雜湊的檔名（assets/index-XXXX.js）可以長快取；index.html 一定要不快取，
  // 否則重新建置後手機還是拿到舊的那份，會以為改動沒生效。
  const cache = /^assets[\\/]/.test(relativePath) ? 'public, max-age=31536000, immutable' : 'no-cache'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
  res.end(fs.readFileSync(target))
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
const MOBILE_COLOR_THEMES: string[] = [
  'mint', 'butter', 'peach', 'aqua', 'sky', 'blush', 'lavender', 'forest', 'white',
  'dark', 'sepia', 'cyber'
]

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
  // ⚠️ 瀏覽器預設只讓 JS 讀到少數幾個「安全」回應標頭，跨來源時其餘一律讀不到——
  // 即使伺服器有送。手機 UI 開發模式（Vite 埠 ≠ mobileServer 埠）正是跨來源，
  // 少了這行會讓 `X-Display-Bounds` / `X-Window-Bounds` 在 `res.headers.get()`
  // 永遠是 null，遙控點擊座標換算全部落空但不會有任何錯誤訊息（B6 開發時踩到）。
  res.setHeader('Access-Control-Expose-Headers', 'X-Display-Bounds, X-Window-Bounds, X-Scale-Factor')

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // ── 手機 UI 的靜態 bundle：**刻意不要求 token** ────────
  //
  // React 版的 index.html 會再去要 `./assets/index-xxx.js`，
  // 而那些請求是**瀏覽器自己發的，不會帶 query string** —— 照 token 擋就是 401、
  // 畫面全白且看不出原因。
  //
  // 曾考慮用 cookie 補（進入頁面時種下、資源請求自動帶上），但經 relay 會失效，
  // 要繞過得放寬成 `Path=/`，等於讓 cookie 也能驗 `/api/*`，防線反而更鬆。
  //
  // 最後選擇：**只放行這批帶雜湊檔名的靜態產物**。它們是開源程式碼的建置結果，
  // 不含任何使用者資料與金鑰（API Key 從來不下發到手機，見 `LlmSettingsSnapshot`）。
  // 入口頁本身與所有 `/api/*` 資料端點，一律仍需 token。
  //
  // （打包後產物會再經 `inline-mobile-build.mjs` 內嵌成單一 HTML，relay 路徑
  // 實際上不太會再打到 `/assets/*`；這條仍保留給開發／未 inline 的建置。）
  if (method === 'GET' && url.startsWith('/assets/')) {
    if (!isMobileAppBuilt()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    serveMobileAppFile(res, decodeURIComponent(url.slice(1).split('?')[0].split('#')[0]))
    return
  }

  if (!isAuthorized(req, requestUrl)) {
    jsonError(res, 401, 'Unauthorized')
    return
  }

  // ── GET / → 手機 UI（B3 React，單一入口）──
  //
  // 入口停在 `/`（不是 `/app` 路徑）：relay 對路徑前綴的轉發行為不可靠
  // （實測掃了全白，見 `b3-mobile-ui-plan.md` §4.20），query 參數則已知會被保留。
  // `./assets/x.js` 在 `/` 下剛好解析成 `/assets/x.js`，區網／tunnel／relay 行為一致。
  // 舊的 `?ui=app` 旗標已廢棄；帶了也不影響，一律送同一份 UI。
  if (method === 'GET' && requestUrl.pathname === '/') {
    if (!isMobileAppBuilt()) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('手機 UI 尚未建置。請先執行：npm run build:mobile')
      return
    }
    serveMobileAppFile(res, 'index.html')
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
      showLlmBadge: bridge.getShowLlmBadge(),
      showPersonaName: bridge.getShowPersonaName(),
      maxImages: bridge.getMaxImagesPerMessage(),
      activeSceneId: bridge.getActiveSceneId(),
      activePersonaId: bridge.getActivePersonaId(),
      activeWorldId: bridge.getActiveWorldId(),
      activeSceneDirty: bridge.getActiveSceneDirty(),
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
    let payload: {
      content?: string
      images?: unknown
      randomResult?: RandomResult
      randomResults?: RandomResult[]
      skipLlm?: boolean
      newsLink?: import('./types').NewsLinkInfo | null
    }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    const content = String(payload.content ?? '').trim()
    const images = sanitizeIncomingImages(payload.images, bridge.getMaxImagesPerMessage())
    if (!content && !images.length && !payload.randomResult && !(payload.randomResults && payload.randomResults.length)) { jsonError(res, 400, 'Empty message'); return }
    try {
      const sourceDeviceName = bridge.shouldIncludeDeviceNameInPrompt()
        ? getDeviceDisplayNameFromRequest(req)
        : undefined
      await bridge.sendMessage({
        content,
        images: images.length ? images : undefined,
        randomResult: payload.randomResult,
        randomResults: payload.randomResults,
        skipLlm: payload.skipLlm,
        sourceDeviceName,
        newsLink: payload.newsLink ?? undefined
      })
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

  // ── POST /api/scenes/capture ──
  // 對應桌面「覆寫為目前狀態」：把目前配色／Persona／世界觀／對話／在場角色寫回情境。
  if (method === 'POST' && url === '/api/scenes/capture') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string; name?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const existing = bridge.getScenePreset(payload.id)
    if (!existing) { jsonError(res, 404, 'Scene not found'); return }
    const name = (payload.name?.trim() || existing.name)
    const scene = bridge.captureScene(payload.id, name)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { scene })
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
      ,activeSceneId: bridge.getActiveSceneId()
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

  // ── 預設組完整讀寫（B3 階段 5）──
  // list 端點只帶摘要；編輯器必須逐筆讀完整資料，避免截斷的 worldSetting 被存回去。
  const presetGet = url.match(/^\/api\/presets\/(persona|world|scene)\/([^/]+)$/)
  if (method === 'GET' && presetGet) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const id = decodeURIComponent(presetGet[2])
    const kind = presetGet[1]
    const preset = kind === 'persona' ? bridge.getPersonaPreset(id)
      : kind === 'world' ? bridge.getWorldPreset(id) : bridge.getScenePreset(id)
    if (!preset) { jsonError(res, 404, 'Preset not found'); return }
    jsonOk(res, { preset })
    return
  }

  const presetSave = url.match(/^\/api\/presets\/(persona|world|scene)\/save$/)
  if (method === 'POST' && presetSave) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ preset?: unknown }>(req, res)
    if (!payload || !payload.preset || typeof payload.preset !== 'object') { if (payload) jsonError(res, 400, 'preset required'); return }
    const kind = presetSave[1]
    const preset = kind === 'persona'
      ? bridge.savePersonaPreset(payload.preset as import('./types').PersonaPreset)
      : kind === 'world'
        ? bridge.saveWorldPreset(payload.preset as import('./types').WorldPreset)
        : bridge.saveScenePreset(payload.preset as import('./types').ScenePreset)
    // 這支自己的呼叫端會另外呼叫 refresh() 拿到最新結果，這裡是讓「其他」已連線的
    // 裝置（另一支手機、或日後桌面也走這個管道時）知道要重抓——不然改名／新增
    // 只有動手的那台看得到，別台永遠不知道發生過（owner 2026-08-05 實機回報）。
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { preset })
    return
  }

  const presetDelete = url.match(/^\/api\/presets\/(persona|world|scene)\/delete$/)
  if (method === 'POST' && presetDelete) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const kind = presetDelete[1]
    const result = kind === 'persona' ? bridge.removePersonaPreset(payload.id)
      : kind === 'world' ? bridge.removeWorldPreset(payload.id) : bridge.removeScenePreset(payload.id)
    if ('error' in result) { jsonError(res, result.error === 'not-found' ? 404 : 409, result.error); return }
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, result)
    return
  }

  // ── POST /api/settings/show-llm-badge ──
  // 訊息旁的模型小圖示開關。與配色同樣是電腦端設定的一部分，要寫回去。
  if (method === 'POST' && url === '/api/settings/show-llm-badge') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { show?: unknown }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (typeof payload.show !== 'boolean') { jsonError(res, 400, 'show must be boolean'); return }
    bridge.setShowLlmBadge(payload.show)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
    return
  }

  // ── POST /api/settings/show-persona-name ──
  // 使用者訊息旁的發話身分名字開關。同上，是電腦端設定的一部分。
  if (method === 'POST' && url === '/api/settings/show-persona-name') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { show?: unknown }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (typeof payload.show !== 'boolean') { jsonError(res, 400, 'show must be boolean'); return }
    bridge.setShowPersonaName(payload.show)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
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

  // ── POST /api/messages/debug ──
  // 除錯用：取這則訊息保留的完整 prompt。太舊的訊息 prompt 已被 prune 剝掉，
  // 那不是錯誤 —— 回 `{ debug: null }` 讓手機顯示「已經沒有保留」。
  if (method === 'POST' && url === '/api/messages/debug') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { id?: string }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    jsonOk(res, { debug: bridge.getMessageDebug(payload.id) ?? null })
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
    const result = bridge.deleteCharacter(payload.id)
    if ('error' in result) { jsonError(res, result.error === 'not-found' ? 404 : 409, result.error); return }
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, result)
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

  // ── 用語解說完整讀寫（B3 階段 9）── list 只帶 {id, name}，編輯器要逐本讀完整資料
  const lorebookGet = url.match(/^\/api\/lorebooks\/([^/]+)$/)
  if (method === 'GET' && lorebookGet) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const book = bridge.getLorebook(decodeURIComponent(lorebookGet[1]))
    if (!book) { jsonError(res, 404, 'Lorebook not found'); return }
    jsonOk(res, { book })
    return
  }

  if (method === 'POST' && url === '/api/lorebooks/create') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ name?: string }>(req, res)
    if (!payload) return
    const book = bridge.createLorebook(payload.name)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { book })
    return
  }

  if (method === 'POST' && url === '/api/lorebooks/save') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ book?: unknown }>(req, res)
    if (!payload || !payload.book || typeof payload.book !== 'object') { if (payload) jsonError(res, 400, 'book required'); return }
    const result = bridge.saveLorebook(payload.book as import('../core/lore').Lorebook)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    // 讓其他已連線的裝置（另一支手機、桌面）知道要重抓，比照預設組編輯器的既有慣例
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { book: result.book })
    return
  }

  if (method === 'POST' && url === '/api/lorebooks/delete') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    bridge.removeLorebook(payload.id)
    pushDesktopUpdate(bridge.getDesktopCharacterIds())
    jsonOk(res, { ok: true })
    return
  }

  /*
   * ── GET /api/sync-init ── S1 初始化匯入：設定與預設組（roadmap §4.7）
   *
   * 角色不走這裡 —— 角色帶圖檔，改用 `/api/sync-pack` 的 .dstpack（見下）。
   *
   * ⚠️ **API Key 的判定必須在這一端做，不可信任手機端自稱。**
   * 私有位址直連才給金鑰；經 relay／tunnel 一律剝除並標明原因，
   * 手機端只負責顯示狀態、不提供「我知道風險仍要傳」的覆寫（§2 目標④）。
   */
  if (method === 'GET' && url === '/api/sync-init') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const lanDirect = isLanDirectRequest(req)
    const llm = bridge.getLlmSettings()
    jsonOk(res, {
      lanDirect,
      /*
       * 掃 QR 拿到的網址優先是 relay（`QRCodeWindow` 的選址順序），所以
       * **即使兩台就在同一個區網，第一次請求也是從外面繞回來的** —— 判定會是
       * 非直連、金鑰被剝掉。這裡附上區網位址讓手機自己改走那條再問一次，
       * 使用者不必知道 relay 是什麼、也不必手動選（§2 目標④）。
       *
       * 附位址不等於放寬判定：手機改連之後，這支仍會用該連線的 remoteAddress
       * 重新判斷一次，權威還是在電腦端。
       */
      lanUrl: lanDirect ? '' : bridge.getLanBaseUrl(),
      colorTheme: bridge.getColorTheme(),
      showLlmBadge: bridge.getShowLlmBadge(),
      showPersonaName: bridge.getShowPersonaName(),
      randomToolsEnabled: bridge.getRandomToolsEnabled(),
      maxImagesPerMessage: bridge.getMaxImagesPerMessage(),
      llm: {
        provider: llm.provider,
        model: llm.model,
        models: llm.models,
        endpoint: llm.endpoint,
        maxResponseTokens: llm.maxResponseTokens,
        maxGroupRounds: llm.maxGroupRounds,
        maxImagesPerMessage: llm.maxImagesPerMessage,
        // 只有區網直連才附金鑰；否則連欄位都不出現（不是空字串，避免手機誤判成「已清空」）
        ...(lanDirect ? { apiKeys: bridge.getApiKeysForSync() } : {})
      },
      memory: bridge.getMemorySettings(),
      modules: bridge.listModuleToggles(),
      personas: bridge.getPersonaPresets(),
      worlds: bridge.getWorldPresets(),
      scenes: bridge.getScenes(),
      activePersonaId: bridge.getActivePersonaId(),
      activeWorldId: bridge.getActiveWorldId(),
      characters: bridge.getCharacters().map((c) => ({ id: c.id, name: c.name }))
    })
    return
  }

  /*
   * ── GET /api/sync-pack ── S1 的角色本體（.dstpack）
   *
   * 沿用桌面匯出的同一份打包程式，手機端也已經有解包邏輯 ——
   * 不要為了同步另發明一種傳輸格式，圖檔與 Lorebook 都在裡面。
   * `includeGlobalSettings` 固定 false：設定走 `/api/sync-init`，那邊才有金鑰判定。
   */
  if (method === 'GET' && url === '/api/sync-pack') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    /*
     * **一隻角色一包，不要整庫一次送。**
     * owner 的資料庫有 10 隻角色、含表情圖，整包是 54 MB；手機端是
     * `await res.arrayBuffer()` 一次吃下，而 CapacitorHttp 會把二進位
     * 用 base64 穿過 JS bridge（再脹 1/3），實測直接失敗。
     * 分開拿還讓 UI 有進度、單隻失敗不會整批白做。
     */
    // ⚠️ 要用 `requestUrl`，不是 `url` —— `url` 是已經去掉 query 的 pathname（見檔頭
    // handleRequest），在它上面再解析一次 query 永遠拿不到 id，會退化成整庫一起送。
    const wanted = requestUrl.searchParams.get('id')?.trim()
    const all = bridge.getCharacters().map((c) => c.id)
    const ids = wanted ? all.filter((id) => id === wanted) : all
    if (ids.length === 0) { jsonError(res, 404, 'No characters'); return }
    const r = await bridge.buildDstPack({
      characterIds: ids,
      includeGlobalSettings: false,
      includeLorebooks: true
    })
    if ('error' in r) { jsonError(res, 500, r.error); return }
    const buf = Buffer.from(r.buffer)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length)
    })
    res.end(buf)
    return
  }

  // ── GET /api/connection-info ──
  // 手機端在建立 `RemoteDataSource` 前先問一次，決定 `Capabilities.apiKeyAccess`
  // （roadmap §4.7）。不需要 `bridge` ready，純粹是傳輸層的判斷。
  if (method === 'GET' && url === '/api/connection-info') {
    jsonOk(res, { lanDirect: isLanDirectRequest(req) })
    return
  }

  // ── 設定（B3 階段 4）────────────────────────────────────
  if (method === 'GET' && url === '/api/settings/llm') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { llm: bridge.getLlmSettings() })
    return
  }

  if (method === 'POST' && url === '/api/settings/llm-provider') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ provider?: string }>(req, res)
    if (!payload) return
    const r = bridge.setLlmProvider(String(payload.provider ?? ''))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/settings/llm-model') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ provider?: string; model?: string }>(req, res)
    if (!payload) return
    const r = bridge.setLlmModel(String(payload.provider ?? ''), String(payload.model ?? ''))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/settings/llm-endpoint') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ endpoint?: string }>(req, res)
    if (!payload) return
    const r = bridge.setLlmEndpoint(String(payload.endpoint ?? ''))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/settings/llm-apikey') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    // ⚠️ **金鑰只在區網直連時可寫**（roadmap §4.7）。由電腦端檢查來源 IP，
    // 不可信任手機端自稱；手機 UI 應該已經靠 `Capabilities.apiKeyAccess` 隱藏
    // 這個欄位，走到這裡代表連線方式在畫面顯示之後才變成經 relay，屬邊緣情況。
    // 用 409 而非 401/403：那兩個會被翻成「連線權杖失效」，與這裡的真正原因無關。
    if (!isLanDirectRequest(req)) { jsonError(res, 409, 'API key can only be set over a direct LAN connection'); return }
    const payload = await readJson<{ provider?: string; apiKey?: string }>(req, res)
    if (!payload) return
    const r = bridge.setLlmApiKey(String(payload.provider ?? ''), String(payload.apiKey ?? ''))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/settings/llm-chat-limits') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{
      maxResponseTokens?: number
      maxGroupRounds?: number
      maxImagesPerMessage?: number
    }>(req, res)
    if (!payload) return
    const r = bridge.setLlmChatLimits({
      maxResponseTokens: Number(payload.maxResponseTokens),
      maxGroupRounds: Number(payload.maxGroupRounds),
      maxImagesPerMessage: Number(payload.maxImagesPerMessage)
    })
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'GET' && url === '/api/settings/memory') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { memory: bridge.getMemorySettings() })
    return
  }

  if (method === 'POST' && url === '/api/settings/memory') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ keepRecentN?: number; autoSummarizeAfter?: number; autoSummarizeEnabled?: boolean }>(req, res)
    if (!payload) return
    const r = bridge.setMemorySettings({
      keepRecentN: Number(payload.keepRecentN),
      autoSummarizeAfter: Number(payload.autoSummarizeAfter),
      autoSummarizeEnabled: !!payload.autoSummarizeEnabled
    })
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'GET' && url === '/api/settings/modules') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { modules: bridge.listModuleToggles() })
    return
  }

  if (method === 'POST' && url === '/api/settings/modules/toggle') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string; enabled?: boolean }>(req, res)
    if (!payload) return
    const r = bridge.setModuleToggle(String(payload.id ?? ''), !!payload.enabled)
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { ok: true })
    return
  }

  // ── 天氣基本設定（位置／開關／潤飾；CWA 進階仍桌面）──
  if (method === 'GET' && url === '/api/settings/weather') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { weather: bridge.getWeatherSettings() })
    return
  }

  if (method === 'POST' && url === '/api/settings/weather') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{
      enabled?: boolean
      polish?: boolean
      locationName?: string
      latitude?: number
      longitude?: number
      locationSource?: 'ip' | 'manual' | ''
    }>(req, res)
    if (!payload) return
    const r = bridge.setWeatherSettings(payload)
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { weather: r.weather })
    return
  }

  if (method === 'POST' && url === '/api/settings/weather/detect-ip') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const r = await bridge.detectWeatherLocation()
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { weather: r.weather })
    return
  }

  if (method === 'POST' && url === '/api/settings/weather/geocode') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ name?: string }>(req, res)
    if (!payload) return
    const r = await bridge.geocodeWeatherLocation(String(payload.name ?? ''))
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, { weather: r.weather })
    return
  }

  if (method === 'POST' && url === '/api/settings/weather/fetch-now') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const r = await bridge.fetchWeatherNow()
    if ('error' in r) { jsonError(res, 400, r.error); return }
    jsonOk(res, r)
    return
  }

  // ── 提醒 CRUD（B3 階段 4）───────────────────────────────
  if (method === 'GET' && url === '/api/reminders') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { reminders: bridge.listReminders() })
    return
  }

  if (method === 'POST' && url === '/api/reminders/create') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    jsonOk(res, { reminder: bridge.createReminder() })
    return
  }

  if (method === 'POST' && url === '/api/reminders/save') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ reminder?: import('./types').Reminder }>(req, res)
    if (!payload?.reminder?.id) { jsonError(res, 400, 'reminder required'); return }
    jsonOk(res, { reminder: bridge.saveReminder(payload.reminder) })
    return
  }

  if (method === 'POST' && url === '/api/reminders/delete') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string }>(req, res)
    if (!payload?.id) { jsonError(res, 400, 'id required'); return }
    bridge.deleteReminder(payload.id)
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/reminders/toggle') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const payload = await readJson<{ id?: string; enabled?: boolean }>(req, res)
    if (!payload?.id) { jsonError(res, 400, 'id required'); return }
    bridge.toggleReminder(payload.id, !!payload.enabled)
    jsonOk(res, { ok: true })
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

/**
 * 是不是「區網直連」（roadmap §4.7，`Capabilities.apiKeyAccess` 的判定依據）。
 *
 * ⚠️ **不是單純「私有位址」判斷** —— relay／cloudflared tunnel 轉發進來的請求，
 * 從 `req.socket.remoteAddress` 看也是 `127.0.0.1`（cloudflared 在本機把流量
 * 轉給 mobileServer），跟手機直接連區網 IP 是同一種表面特徵，唯一分得出來的
 * 差異就是「是不是 loopback」：真正的手機在區網會顯示成它自己的私有位址
 * （192.168.x 等），不會是 127.0.0.1。
 *
 * 這是 roadmap §4.7 描述的「同網段」判斷的簡化版：不比對子網路遮罩，
 * 只分「私有位址但非 loopback」vs 其他。差異只在「同一個路由器下的不同網段」
 * 這種邊緣案例，不影響「區網直連 vs 經 relay」這條真正要守的界線。
 */
function isLanDirectRequest(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress
  if (!addr) return false
  const ip = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return false
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map(p => Number(p))
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = nums
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
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
