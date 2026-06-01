import type * as http from 'http'
import type { RemoteCapability, RemoteControlSettings } from './types'
import * as rc from './actions'
import { appendRemoteLog, clearRemoteLog, getRemoteLog, parseDeviceLabel } from './logStore'
import { getRemoteControlClientState, isCapabilityAllowed, normalizeRemoteControlSettings } from './settings'

export type RemoteControlRoute =
  | '/api/remote/click'
  | '/api/remote/scroll'
  | '/api/remote/type'
  | '/api/remote/key'
  | '/api/remote/programs'
  | '/api/remote/programs/launch'
  | '/api/remote/programs/close'
  | '/api/remote/monitor-off'
  | '/api/remote/wake'
  | '/api/remote/system'
  | '/api/remote/log'
  | '/api/remote/log/clear'
  | '/api/remote/module'
  | '/api/remote/hide-windows'
  | '/api/remote/restore-windows'

export const REMOTE_CONTROL_ROUTE_CAPABILITIES: Partial<Record<RemoteControlRoute, RemoteCapability>> = {
  '/api/remote/click': 'remote.pointer.click',
  '/api/remote/scroll': 'remote.pointer.scroll',
  '/api/remote/type': 'remote.keyboard.type',
  '/api/remote/key': 'remote.keyboard.hotkey',
  '/api/remote/programs/launch': 'remote.program.launch',
  '/api/remote/programs/close': 'remote.program.close',
  '/api/remote/monitor-off': 'remote.monitor.power',
  '/api/remote/wake': 'remote.monitor.power',
  '/api/remote/system': 'remote.system.shutdown'
}

interface RemoteDeviceInfo {
  ip: string
  deviceId: string
  deviceNickname: string
  deviceLabel: string
}

interface RemoteControlHost {
  getRemoteControlSettings: () => RemoteControlSettings | undefined
  setRemoteControlEnabled: (enabled: boolean) => { ok: true } | { error: string }
  notifyRemoteClickPending: () => void
  notifyRemoteAction: () => void
  hideWindowsForRemote: () => void
  restoreWindowsForRemote: () => void
}

interface RemoteControlRequestContext {
  req: http.IncomingMessage
  res: http.ServerResponse
  method: string
  url: string
  host: RemoteControlHost
}

export async function handleRemoteControlRequest(ctx: RemoteControlRequestContext): Promise<void> {
  const { req, res, method, url, host } = ctx
  const rcSettings = normalizeRemoteControlSettings(host.getRemoteControlSettings())
  const devInfo = extractDeviceInfo(req)

  if (method === 'POST' && url === '/api/remote/module') {
    const payload = await readJsonBody<{ enabled?: boolean }>(req, res)
    if (!payload) return
    if (typeof payload.enabled !== 'boolean') { jsonError(res, 400, 'enabled required'); return }
    const result = host.setRemoteControlEnabled(payload.enabled)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, { ok: true, remoteControl: getRemoteControlClientState(host.getRemoteControlSettings()) })
    return
  }

  if (!rcSettings.enabled) {
    jsonError(res, 403, 'Remote control module disabled')
    return
  }

  if (method === 'POST' && url === '/api/remote/click') {
    if (!isCapabilityAllowed(rcSettings, 'remote.pointer.click')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ x?: number; y?: number; button?: 'left' | 'right' | 'middle'; double?: boolean }>(req, res)
    if (!payload) return
    if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
    host.notifyRemoteClickPending()
    const result = await rc.clickAt(payload.x, payload.y, payload.button ?? 'left', payload.double ?? false)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'click', detail: `(${payload.x}, ${payload.y})${payload.double ? ' 雙擊' : ''}${payload.button && payload.button !== 'left' ? ' ' + payload.button : ''}` })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/hide-windows') {
    host.hideWindowsForRemote()
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/remote/restore-windows') {
    host.restoreWindowsForRemote()
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/remote/type') {
    if (!isCapabilityAllowed(rcSettings, 'remote.keyboard.type')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ text?: string; pressEnter?: boolean }>(req, res)
    if (!payload) return
    const text = String(payload.text ?? '')
    if (!text) { jsonError(res, 400, 'text required'); return }
    host.notifyRemoteClickPending()
    const result = await rc.typeText(text)
    if (result.ok && payload.pressEnter) await rc.sendKey('Enter')
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'type', detail: text.length > 40 ? text.slice(0, 40) + '…' : text })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/key') {
    if (!isCapabilityAllowed(rcSettings, 'remote.keyboard.hotkey')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ keys?: string }>(req, res)
    if (!payload) return
    if (!payload.keys) { jsonError(res, 400, 'keys required'); return }
    const result = await rc.sendKey(payload.keys)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'key', detail: payload.keys })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/system') {
    const payload = await readJsonBody<{ action?: string }>(req, res)
    if (!payload) return
    if (payload.action !== 'shutdown' && payload.action !== 'restart') { jsonError(res, 400, 'action must be shutdown or restart'); return }
    const capability = payload.action === 'restart' ? 'remote.system.restart' : 'remote.system.shutdown'
    if (!isCapabilityAllowed(rcSettings, capability)) { jsonError(res, 403, 'Capability disabled'); return }
    appendRemoteLog({ ...devInfo, action: payload.action, detail: payload.action === 'shutdown' ? '關機' : '重新開機' })
    host.notifyRemoteAction()
    const result = await rc.shutdownPc(payload.action === 'restart')
    jsonOk(res, result)
    return
  }

  if (method === 'GET' && url === '/api/remote/programs') {
    const programs = rcSettings.registeredPrograms
    const withStatus = await Promise.all(programs.map(async p => ({
      id: p.id,
      name: p.name,
      iconDataUrl: p.iconDataUrl,
      running: await rc.isProgramRunning(p)
    })))
    jsonOk(res, withStatus)
    return
  }

  if (method === 'POST' && url === '/api/remote/programs/launch') {
    if (!isCapabilityAllowed(rcSettings, 'remote.program.launch')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const prog = rcSettings.registeredPrograms.find(p => p.id === payload.id)
    if (!prog) { jsonError(res, 404, 'Program not found'); return }
    const result = await rc.launchProgram(prog)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'launch', detail: prog.name })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/programs/close') {
    if (!isCapabilityAllowed(rcSettings, 'remote.program.close')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const prog = rcSettings.registeredPrograms.find(p => p.id === payload.id)
    if (!prog) { jsonError(res, 404, 'Program not found'); return }
    const result = await rc.closeProgram(prog)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'close', detail: prog.name })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'GET' && url === '/api/remote/log') {
    jsonOk(res, getRemoteLog())
    return
  }

  if (method === 'POST' && url === '/api/remote/log/clear') {
    clearRemoteLog()
    jsonOk(res, { ok: true })
    return
  }

  if (method === 'POST' && url === '/api/remote/scroll') {
    if (!isCapabilityAllowed(rcSettings, 'remote.pointer.scroll')) { jsonError(res, 403, 'Capability disabled'); return }
    const payload = await readJsonBody<{ x?: number; y?: number; deltaX?: number; deltaY?: number }>(req, res)
    if (!payload) return
    if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
    const result = await rc.scrollAt(payload.x, payload.y, payload.deltaX ?? 0, payload.deltaY ?? 0)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'scroll', detail: `(${payload.x}, ${payload.y}) dx=${payload.deltaX ?? 0} dy=${payload.deltaY ?? 0}` })
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/monitor-off') {
    if (!isCapabilityAllowed(rcSettings, 'remote.monitor.power')) { jsonError(res, 403, 'Capability disabled'); return }
    const result = await rc.monitorOff()
    if (result.ok) {
      appendRemoteLog({ ...devInfo, action: 'monitor-off', detail: '關閉螢幕' })
      host.notifyRemoteAction()
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/wake') {
    if (!isCapabilityAllowed(rcSettings, 'remote.monitor.power')) { jsonError(res, 403, 'Capability disabled'); return }
    rc.releaseMonitorOff()
    const { exec } = await import('child_process')
    const wakeScript = [
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class WK{[DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);[DllImport(\\"user32.dll\\")]public static extern bool GetCursorPos(out POINT p);[StructLayout(LayoutKind.Sequential)]public struct POINT{public int X,Y;}}\'',
      '$p=New-Object WK+POINT;[WK]::GetCursorPos([ref]$p)|Out-Null',
      '[WK]::SetCursorPos($p.X+1,$p.Y+1)|Out-Null',
      'Start-Sleep -Milliseconds 50',
      '[WK]::SetCursorPos($p.X,$p.Y)|Out-Null'
    ].join(';')
    await new Promise<void>(resolve => {
      exec(`powershell -NoProfile -NonInteractive -Command "${wakeScript}"`, { timeout: 3000 }, () => resolve())
    })
    appendRemoteLog({ ...devInfo, action: 'wake', detail: '喚醒螢幕' })
    host.notifyRemoteAction()
    jsonOk(res, { ok: true })
    return
  }

  jsonError(res, 404, 'Remote API not found')
}

function extractDeviceInfo(req: http.IncomingMessage): RemoteDeviceInfo {
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

async function readJsonBody<T>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | null> {
  const body = await readBody(req)
  try {
    return JSON.parse(body) as T
  } catch {
    jsonError(res, 400, 'Invalid JSON')
    return null
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

function jsonOk(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function jsonError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}
