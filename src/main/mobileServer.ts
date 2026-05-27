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

// ── 注入的 bridge（由 index.ts 啟動時注入）────────────────

export interface MobileBridge {
  getCharacters: () => import('./types').Character[]
  getDesktopCharacterIds: () => string[]
  getActiveConversation: () => { id: string; participantIds: string[]; messages: Message[] } | null
  sendMessage: (payload: { content: string; randomResult?: RandomResult }) => Promise<void>
  addDesktopCharacter: (characterId: string) => Promise<boolean>
  removeDesktopCharacter: (characterId: string) => boolean
  captureScreenshot: (withChars: boolean, displayIndex?: number) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  getConversationList: () => { id: string; title: string; updatedAt: number; active: boolean }[]
  loadConversation: (id: string) => boolean
  getScenes: () => import('./types').ScenePreset[]
  applyScene: (id: string) => { ok: true } | { error: string }
  getPersonaPresets: () => import('./types').PersonaPreset[]
  getWorldPresets: () => import('./types').WorldPreset[]
  activatePersona: (id: string) => boolean
  activateWorld: (id: string) => boolean
  getActivePersonaId: () => string
  getActiveWorldId: () => string
  getColorTheme: () => string
  deleteMessage: (id: string) => boolean
  editMessage: (id: string, content: string) => boolean
  resendMessage: (id: string) => Promise<{ ok: boolean } | { error: string }>
}

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

export function getConnectedCount(): number {
  return clients.size
}

// 移除敏感欄位（debugPrompt、圖片 base64）
function sanitizeMessage(msg: Message): Partial<Message> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { debugPrompt, utilityDebugPrompt, images, ...rest } = msg
  return rest
}

// ── 靜態資源路徑 ──────────────────────────────────────────

function getMobileHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'assets', 'mobile.html')
  }
  return path.join(app.getAppPath(), 'assets', 'mobile.html')
}

// ── 隨機工具邏輯 ───────────────────────────────────────────

function rollRandomTool(tool: string, params: Record<string, number>): RandomResult | null {
  if (tool === 'coin') {
    return { tool: 'coin', result: Math.random() < 0.5 ? '正面' : '反面' }
  }
  if (tool === 'omikuji') {
    const tiers = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'] as const
    const weights = [15, 20, 15, 25, 10, 10, 5]
    const total = weights.reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    for (let i = 0; i < tiers.length; i++) {
      r -= weights[i]
      if (r <= 0) return { tool: 'omikuji', result: tiers[i] }
    }
    return { tool: 'omikuji', result: '吉' }
  }
  if (tool === 'jiao') {
    const r = Math.random()
    const result: '聖筊' | '笑筊' | '陰筊' = r < 0.5 ? '聖筊' : r < 0.75 ? '笑筊' : '陰筊'
    return { tool: 'jiao', result }
  }
  if (tool === 'dice') {
    const faces = Math.max(2, Math.floor(params.faces ?? 6))
    const count = Math.max(1, Math.min(20, Math.floor(params.count ?? 1)))
    const modifier = Math.floor(params.modifier ?? 0)
    const keepHighest = params.keepHighest != null ? Math.max(1, Math.floor(params.keepHighest)) : undefined
    const keepLowest = params.keepLowest != null ? Math.max(1, Math.floor(params.keepLowest)) : undefined

    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1)
    let kept: number[]
    if (keepHighest != null) {
      kept = [...rolls].sort((a, b) => b - a).slice(0, Math.min(keepHighest, count))
    } else if (keepLowest != null) {
      kept = [...rolls].sort((a, b) => a - b).slice(0, Math.min(keepLowest, count))
    } else {
      kept = [...rolls]
    }
    const total = kept.reduce((a, b) => a + b, 0) + modifier
    return { tool: 'dice', faces, count, rolls, kept, keepHighest, keepLowest, modifier, total }
  }
  return null
}

// ── HTTP 路由 ─────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  // CORS headers（讓瀏覽器能正常存取）
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
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
    const desktopIds = bridge.getDesktopCharacterIds()
    const allChars = bridge.getCharacters()
    const desktopChars = allChars
      .filter(c => desktopIds.includes(c.id))
      .map(c => ({ id: c.id, name: c.name }))
    jsonOk(res, {
      desktopCharacters: desktopChars,
      conversation: conv
        ? { id: conv.id, messages: conv.messages.slice(-50).map(sanitizeMessage) }
        : null,
      colorTheme: bridge.getColorTheme()
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

  // ── POST /api/send ──
  if (method === 'POST' && url === '/api/send') {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const body = await readBody(req)
    let payload: { content?: string; randomResult?: RandomResult }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    const content = String(payload.content ?? '').trim()
    if (!content && !payload.randomResult) { jsonError(res, 400, 'Empty message'); return }
    try {
      await bridge.sendMessage({ content, randomResult: payload.randomResult })
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

  // ── GET /api/screenshot/clean|with-chars ──
  if (method === 'GET' && (url.startsWith('/api/screenshot/clean') || url.startsWith('/api/screenshot/with-chars'))) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const qIdx = url.indexOf('?')
    const urlPath = qIdx >= 0 ? url.slice(0, qIdx) : url
    const qs = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams()
    const displayIndex = parseInt(qs.get('displayIndex') ?? '0') || 0
    const withChars = urlPath === '/api/screenshot/with-chars'
    const result = await bridge.captureScreenshot(withChars, displayIndex)
    if (!result.ok || !result.dataUrl) { jsonError(res, 500, result.error ?? 'Screenshot failed'); return }
    const [header, b64] = result.dataUrl.split(',')
    const mime = header.replace('data:', '').replace(';base64', '')
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
    const script = [
      '$OutputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8',
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WH{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}}\'',
      '$w=Get-Process|?{$_.MainWindowHandle-ne 0-and $_.MainWindowTitle-ne \'\'}|%{$hwnd=$_.MainWindowHandle;$r=New-Object WH+RECT;[WH]::GetWindowRect($hwnd,[ref]$r)|Out-Null;[pscustomobject]@{hwnd=$hwnd.ToInt64();title=$_.MainWindowTitle;proc=$_.ProcessName;x=$r.L;y=$r.T;w=$r.R-$r.L;h=$r.B-$r.T}}',
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
        return { hwnd: w.hwnd, title: w.title, proc: w.proc, displayIndex: di >= 0 ? di : 0 }
      })
      jsonOk(res, result)
    } catch { jsonOk(res, []) }
    return
  }

  // ── POST /api/focus-window ──
  if (method === 'POST' && url === '/api/focus-window') {
    const body = await readBody(req)
    let payload: { hwnd?: number }
    try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
    if (!payload.hwnd) { jsonError(res, 400, 'hwnd required'); return }
    const { exec } = await import('child_process')
    const { screen: s } = await import('electron')
    const hwnd = Number(payload.hwnd)
    const script = [
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WA{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,R,B;}}\'',
      `$hwnd=[IntPtr]::new(${hwnd})`,
      '[WA]::ShowWindow($hwnd,9)|Out-Null',
      '[WA]::SetForegroundWindow($hwnd)|Out-Null',
      '$r=New-Object WA+RECT;[WA]::GetWindowRect($hwnd,[ref]$r)|Out-Null',
      'Write-Output "$($r.L),$($r.T)"'
    ].join(';')
    const out = await new Promise<string>((resolve) => {
      exec(`powershell -NoProfile -NonInteractive -Command "${script}"`, { encoding: 'utf8', timeout: 4000 }, (err, stdout) => {
        resolve(err ? '' : stdout.trim())
      })
    })
    const parts = out.split(',')
    const winX = parseInt(parts[0]) || 0
    const winY = parseInt(parts[1]) || 0
    const displays = s.getAllDisplays()
    const di = displays.findIndex(d =>
      winX >= d.bounds.x && winX < d.bounds.x + d.bounds.width &&
      winY >= d.bounds.y && winY < d.bounds.y + d.bounds.height
    )
    jsonOk(res, { ok: true, displayIndex: di >= 0 ? di : 0 })
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
    wss.on('connection', (ws) => {
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
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
