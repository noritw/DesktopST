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
import { getAccessToken } from './relayService'
import * as rc from './remoteControl'
import { appendRemoteLog, getRemoteLog, clearRemoteLog, parseDeviceLabel } from './remoteControlLog'

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
  getRemoteControlSettings: () => import('./types').RemoteControlSettings | undefined
  notifyRemoteClickPending: () => void  // 點擊前廣播：讓角色視窗暫時穿透
  notifyRemoteAction: () => void        // 點擊後廣播：顯示遠端控制指示
  hideWindowsForRemote: () => void      // 遙控模式：隱藏所有 DeST 視窗
  restoreWindowsForRemote: () => void   // 遙控模式：恢復所有 DeST 視窗
}

// ── 裝置資訊解析工具 ──────────────────────────────────────

interface DeviceInfo {
  ip: string
  deviceId: string
  deviceNickname: string
  deviceLabel: string
}

function extractDeviceInfo(req: http.IncomingMessage): DeviceInfo {
  const forwarded = req.headers['x-forwarded-for']
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? '未知'
  const rawId = req.headers['x-device-id']
  const deviceId = (Array.isArray(rawId) ? rawId[0] : rawId) ?? ''
  const rawNick = req.headers['x-device-nickname']
  const rawNickStr = (Array.isArray(rawNick) ? rawNick[0] : rawNick) ?? ''
  let deviceNickname = '未命名裝置'
  if (rawNickStr) {
    try { deviceNickname = decodeURIComponent(rawNickStr) } catch { deviceNickname = rawNickStr }
  }
  const ua = req.headers['user-agent']
  const deviceLabel = parseDeviceLabel(Array.isArray(ua) ? ua[0] : ua)
  return { ip, deviceId, deviceNickname, deviceLabel }
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
  const rawUrl = req.url ?? '/'
  const requestUrl = new URL(rawUrl, 'http://localhost')
  const url = requestUrl.pathname
  const method = req.method ?? 'GET'

  // CORS headers（讓瀏覽器能正常存取）
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DesktopST-Token, Authorization, X-Device-Id, X-Device-Nickname')

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

  // ── 遙控 API ────────────────────────────────────────────

  if (url.startsWith('/api/remote/')) {
    if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
    const rcSettings = bridge.getRemoteControlSettings()

    const devInfo = extractDeviceInfo(req)

    // ── POST /api/remote/click ──
    if (method === 'POST' && url === '/api/remote/click') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      const body = await readBody(req)
      let payload: { x?: number; y?: number; button?: 'left' | 'right' | 'middle'; double?: boolean }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
      // 點擊前廣播：讓所有角色視窗暫時穿透，避免透明視窗擋住點擊目標
      bridge.notifyRemoteClickPending()
      const result = await rc.clickAt(payload.x, payload.y, payload.button ?? 'left', payload.double ?? false)
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'click', detail: `(${payload.x}, ${payload.y})${payload.double ? ' 雙擊' : ''}${payload.button && payload.button !== 'left' ? ' ' + payload.button : ''}` })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/hide-windows ── 遙控模式：隱藏所有 DeST 視窗
    if (method === 'POST' && url === '/api/remote/hide-windows') {
      if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
      bridge.hideWindowsForRemote()
      jsonOk(res, { ok: true })
      return
    }

    // ── POST /api/remote/restore-windows ── 遙控模式：恢復所有 DeST 視窗
    if (method === 'POST' && url === '/api/remote/restore-windows') {
      if (!bridge) { jsonError(res, 503, 'Server not ready'); return }
      bridge.restoreWindowsForRemote()
      jsonOk(res, { ok: true })
      return
    }

    // ── POST /api/remote/type ──
    if (method === 'POST' && url === '/api/remote/type') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      const body = await readBody(req)
      let payload: { text?: string; pressEnter?: boolean }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      const text = String(payload.text ?? '')
      if (!text) { jsonError(res, 400, 'text required'); return }
      // 輸入前也廣播，確保後續 Enter 等按鍵不被視窗攔截
      bridge.notifyRemoteClickPending()
      const result = await rc.typeText(text)
      if (result.ok && payload.pressEnter) await rc.sendKey('Enter')
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'type', detail: text.length > 40 ? text.slice(0, 40) + '…' : text })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/key ──
    if (method === 'POST' && url === '/api/remote/key') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      const body = await readBody(req)
      let payload: { keys?: string }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (!payload.keys) { jsonError(res, 400, 'keys required'); return }
      const result = await rc.sendKey(payload.keys)
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'key', detail: payload.keys })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/system ──
    if (method === 'POST' && url === '/api/remote/system') {
      if (!rcSettings?.enableSystemActions) { jsonError(res, 403, 'System actions disabled'); return }
      const body = await readBody(req)
      let payload: { action?: string }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (payload.action !== 'shutdown' && payload.action !== 'restart') { jsonError(res, 400, 'action must be shutdown or restart'); return }
      appendRemoteLog({ ...devInfo, action: payload.action, detail: payload.action === 'shutdown' ? '關機' : '重新開機' })
      bridge.notifyRemoteAction()
      const result = await rc.shutdownPc(payload.action === 'restart')
      jsonOk(res, result)
      return
    }

    // ── GET /api/remote/programs ──
    if (method === 'GET' && url === '/api/remote/programs') {
      const programs = rcSettings?.registeredPrograms ?? []
      const withStatus = await Promise.all(programs.map(async p => ({
        id: p.id,
        name: p.name,
        iconDataUrl: p.iconDataUrl,
        running: await rc.isProgramRunning(p)
      })))
      jsonOk(res, withStatus)
      return
    }

    // ── POST /api/remote/programs/launch ──
    if (method === 'POST' && url === '/api/remote/programs/launch') {
      const body = await readBody(req)
      let payload: { id?: string }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (!payload.id) { jsonError(res, 400, 'id required'); return }
      const prog = rcSettings?.registeredPrograms.find(p => p.id === payload.id)
      if (!prog) { jsonError(res, 404, 'Program not found'); return }
      const result = await rc.launchProgram(prog)
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'launch', detail: prog.name })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/programs/close ──
    if (method === 'POST' && url === '/api/remote/programs/close') {
      const body = await readBody(req)
      let payload: { id?: string }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (!payload.id) { jsonError(res, 400, 'id required'); return }
      const prog = rcSettings?.registeredPrograms.find(p => p.id === payload.id)
      if (!prog) { jsonError(res, 404, 'Program not found'); return }
      const result = await rc.closeProgram(prog)
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'close', detail: prog.name })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── GET /api/remote/log ──
    if (method === 'GET' && url === '/api/remote/log') {
      jsonOk(res, getRemoteLog())
      return
    }

    // ── POST /api/remote/log/clear ──
    if (method === 'POST' && url === '/api/remote/log/clear') {
      clearRemoteLog()
      jsonOk(res, { ok: true })
      return
    }

    // ── POST /api/remote/scroll ──
    if (method === 'POST' && url === '/api/remote/scroll') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      const body = await readBody(req)
      let payload: { x?: number; y?: number; deltaX?: number; deltaY?: number }
      try { payload = JSON.parse(body) } catch { jsonError(res, 400, 'Invalid JSON'); return }
      if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
      const result = await rc.scrollAt(
        payload.x, payload.y,
        payload.deltaX ?? 0, payload.deltaY ?? 0
      )
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'scroll', detail: `(${payload.x}, ${payload.y}) dx=${payload.deltaX ?? 0} dy=${payload.deltaY ?? 0}` })
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/monitor-off ──
    // 只關閉螢幕背光（不觸發 Windows 鎖定），省電用
    if (method === 'POST' && url === '/api/remote/monitor-off') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      const result = await rc.monitorOff()
      if (result.ok) {
        appendRemoteLog({ ...devInfo, action: 'monitor-off', detail: '關閉螢幕' })
        bridge.notifyRemoteAction()
      }
      jsonOk(res, result)
      return
    }

    // ── POST /api/remote/wake ──
    // 移動一下滑鼠以喚醒螢幕（從螢幕保護程式或鎖定畫面）
    if (method === 'POST' && url === '/api/remote/wake') {
      if (!rcSettings?.enableInputControl) { jsonError(res, 403, 'Input control disabled'); return }
      // 釋放防休眠狀態
      rc.releaseMonitorOff()
      const { exec: e3 } = await import('child_process')
      // 取得目前游標位置再移回，避免干擾使用者正在操作的位置
      const wakeScript = [
        'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WK{[DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);[DllImport(\\"user32.dll\\")]public static extern bool GetCursorPos(out POINT p);[StructLayout(LayoutKind.Sequential)]public struct POINT{public int X,Y;}}\'',
        '$p=New-Object WK+POINT;[WK]::GetCursorPos([ref]$p)|Out-Null',
        '[WK]::SetCursorPos($p.X+1,$p.Y+1)|Out-Null',
        'Start-Sleep -Milliseconds 50',
        '[WK]::SetCursorPos($p.X,$p.Y)|Out-Null'
      ].join(';')
      await new Promise<void>(resolve => {
        e3(`powershell -NoProfile -NonInteractive -Command "${wakeScript}"`, { timeout: 3000 }, () => resolve())
      })
      appendRemoteLog({ ...devInfo, action: 'wake', detail: '喚醒螢幕' })
      bridge.notifyRemoteAction()
      jsonOk(res, { ok: true })
      return
    }

    jsonError(res, 404, 'Remote API not found')
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
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
