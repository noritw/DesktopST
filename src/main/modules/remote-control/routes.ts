import type * as http from 'http'
import type { RemoteCapability, RemoteControlSettings } from './types'
import * as rc from './actions'
import { appendRemoteLog, clearRemoteLog, getRemoteLog, parseDeviceLabel } from './logStore'
import { getRemoteControlClientStateForDevice, isCapabilityAllowed, isDeviceAllowed, normalizeRemoteControlSettings } from './settings'
import type { MobileRouteRegistrar } from '../../mobileServer'

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
  touchAllowedRemoteDevice?: (device: { id: string; nickname: string; label?: string }) => void
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
    if (!isDeviceAllowed(rcSettings, devInfo.deviceId)) {
      logAttempt(devInfo, 'remote.device.allowed', 'blocked-device', url, false, 'Device not allowed')
      jsonError(res, 403, 'Device not allowed')
      return
    }
    const payload = await readJsonBody<{ enabled?: boolean }>(req, res)
    if (!payload) return
    if (typeof payload.enabled !== 'boolean') { jsonError(res, 400, 'enabled required'); return }
    const result = host.setRemoteControlEnabled(payload.enabled)
    if ('error' in result) { jsonError(res, 400, result.error); return }
    jsonOk(res, { ok: true, remoteControl: getRemoteControlClientStateForDevice(host.getRemoteControlSettings(), devInfo.deviceId) })
    return
  }

  if (!rcSettings.enabled) {
    logAttempt(devInfo, 'remote.module.disabled', 'request', url, false, 'Remote control module disabled')
    jsonError(res, 403, 'Remote control module disabled')
    return
  }

  if (!isDeviceAllowed(rcSettings, devInfo.deviceId)) {
    logAttempt(devInfo, 'remote.device.allowed', 'blocked-device', url, false, 'Device not allowed')
    jsonError(res, 403, 'Device not allowed')
    return
  }
  if (devInfo.deviceId) {
    host.touchAllowedRemoteDevice?.({
      id: devInfo.deviceId,
      nickname: devInfo.deviceNickname,
      label: devInfo.deviceLabel
    })
  }

  if (method === 'POST' && url === '/api/remote/click') {
    if (!isCapabilityAllowed(rcSettings, 'remote.pointer.click')) { logAttempt(devInfo, 'remote.pointer.click', 'click', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.pointer.click', 'click')) return
    const payload = await readJsonBody<{ x?: number; y?: number; button?: 'left' | 'right' | 'middle'; double?: boolean }>(req, res)
    if (!payload) return
    if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
    host.notifyRemoteClickPending()
    const result = await rc.clickAt(payload.x, payload.y, payload.button ?? 'left', payload.double ?? false)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.pointer.click', action: 'click', detail: `(${payload.x}, ${payload.y})${payload.double ? ' 雙擊' : ''}${payload.button && payload.button !== 'left' ? ' ' + payload.button : ''}`, success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.pointer.click', 'click', result.error ?? 'failed', false, result.error)
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
    if (!isCapabilityAllowed(rcSettings, 'remote.keyboard.type')) { logAttempt(devInfo, 'remote.keyboard.type', 'type', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.keyboard.type', 'type')) return
    const payload = await readJsonBody<{ text?: string; pressEnter?: boolean }>(req, res)
    if (!payload) return
    const text = String(payload.text ?? '')
    if (!text) { jsonError(res, 400, 'text required'); return }
    host.notifyRemoteClickPending()
    const result = await rc.typeText(text)
    if (result.ok && payload.pressEnter) await rc.sendKey('Enter')
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.keyboard.type', action: 'type', detail: text.length > 40 ? text.slice(0, 40) + '…' : text, success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.keyboard.type', 'type', result.error ?? 'failed', false, result.error)
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/key') {
    if (!isCapabilityAllowed(rcSettings, 'remote.keyboard.hotkey')) { logAttempt(devInfo, 'remote.keyboard.hotkey', 'key', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.keyboard.hotkey', 'key')) return
    const payload = await readJsonBody<{ keys?: string }>(req, res)
    if (!payload) return
    if (!payload.keys) { jsonError(res, 400, 'keys required'); return }
    const result = await rc.sendKey(payload.keys)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.keyboard.hotkey', action: 'key', detail: payload.keys, success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.keyboard.hotkey', 'key', result.error ?? 'failed', false, result.error)
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/system') {
    const payload = await readJsonBody<{ action?: string }>(req, res)
    if (!payload) return
    if (payload.action !== 'shutdown' && payload.action !== 'restart') { jsonError(res, 400, 'action must be shutdown or restart'); return }
    const capability = payload.action === 'restart' ? 'remote.system.restart' : 'remote.system.shutdown'
    if (!isCapabilityAllowed(rcSettings, capability)) { logAttempt(devInfo, capability, payload.action, 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, capability, payload.action)) return
    appendRemoteLog({ ...devInfo, capability, action: payload.action, detail: payload.action === 'shutdown' ? '關機' : '重新開機', success: true })
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
    if (!isCapabilityAllowed(rcSettings, 'remote.program.launch')) { logAttempt(devInfo, 'remote.program.launch', 'launch', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.program.launch', 'launch')) return
    const payload = await readJsonBody<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const prog = rcSettings.registeredPrograms.find(p => p.id === payload.id)
    if (!prog) { jsonError(res, 404, 'Program not found'); return }
    const result = await rc.launchProgram(prog)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.program.launch', action: 'launch', detail: prog.name, success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.program.launch', 'launch', result.error ?? prog.name, false, result.error)
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/programs/close') {
    if (!isCapabilityAllowed(rcSettings, 'remote.program.close')) { logAttempt(devInfo, 'remote.program.close', 'close', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.program.close', 'close')) return
    const payload = await readJsonBody<{ id?: string }>(req, res)
    if (!payload) return
    if (!payload.id) { jsonError(res, 400, 'id required'); return }
    const prog = rcSettings.registeredPrograms.find(p => p.id === payload.id)
    if (!prog) { jsonError(res, 404, 'Program not found'); return }
    const result = await rc.closeProgram(prog)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.program.close', action: 'close', detail: prog.name, success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.program.close', 'close', result.error ?? prog.name, false, result.error)
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
    if (!isCapabilityAllowed(rcSettings, 'remote.pointer.scroll')) { logAttempt(devInfo, 'remote.pointer.scroll', 'scroll', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.pointer.scroll', 'scroll')) return
    const payload = await readJsonBody<{ x?: number; y?: number; deltaX?: number; deltaY?: number }>(req, res)
    if (!payload) return
    if (payload.x == null || payload.y == null) { jsonError(res, 400, 'x and y required'); return }
    const result = await rc.scrollAt(payload.x, payload.y, payload.deltaX ?? 0, payload.deltaY ?? 0)
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.pointer.scroll', action: 'scroll', detail: `(${payload.x}, ${payload.y}) dx=${payload.deltaX ?? 0} dy=${payload.deltaY ?? 0}`, success: true })
    } else {
      logAttempt(devInfo, 'remote.pointer.scroll', 'scroll', result.error ?? 'failed', false, result.error)
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/monitor-off') {
    if (!isCapabilityAllowed(rcSettings, 'remote.monitor.power')) { logAttempt(devInfo, 'remote.monitor.power', 'monitor-off', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.monitor.power', 'monitor-off')) return
    const result = await rc.monitorOff()
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.monitor.power', action: 'monitor-off', detail: '關閉螢幕', success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.monitor.power', 'monitor-off', result.error ?? 'failed', false, result.error)
    }
    jsonOk(res, result)
    return
  }

  if (method === 'POST' && url === '/api/remote/wake') {
    if (!isCapabilityAllowed(rcSettings, 'remote.monitor.power')) { logAttempt(devInfo, 'remote.monitor.power', 'wake', 'Capability disabled', false, 'Capability disabled'); jsonError(res, 403, 'Capability disabled'); return }
    if (!ensureRemoteConfirmation(req, res, rcSettings, devInfo, 'remote.monitor.power', 'wake')) return
    const result = await rc.wakeMonitor()
    if (result.ok) {
      appendRemoteLog({ ...devInfo, capability: 'remote.monitor.power', action: 'wake', detail: '喚醒螢幕', success: true })
      host.notifyRemoteAction()
    } else {
      logAttempt(devInfo, 'remote.monitor.power', 'wake', result.error ?? 'failed', false, result.error)
    }
    jsonOk(res, result)
    return
  }

  jsonError(res, 404, 'Remote API not found')
}

export function registerRemoteControlRoutes(registerRoute: MobileRouteRegistrar): void {
  const paths: RemoteControlRoute[] = [
    '/api/remote/click',
    '/api/remote/scroll',
    '/api/remote/type',
    '/api/remote/key',
    '/api/remote/programs',
    '/api/remote/programs/launch',
    '/api/remote/programs/close',
    '/api/remote/monitor-off',
    '/api/remote/wake',
    '/api/remote/system',
    '/api/remote/log',
    '/api/remote/log/clear',
    '/api/remote/module',
    '/api/remote/hide-windows',
    '/api/remote/restore-windows'
  ]
  for (const path of paths) {
    registerRoute({
      method: path === '/api/remote/programs' || path === '/api/remote/log' ? 'GET' : 'POST',
      path,
      requiredCapability: REMOTE_CONTROL_ROUTE_CAPABILITIES[path],
      handler: ({ req, res, method, url, host }) => handleRemoteControlRequest({ req, res, method, url, host })
    })
  }
}

function logAttempt(
  devInfo: RemoteDeviceInfo,
  capability: string,
  action: string,
  detail: string,
  success: boolean,
  error?: string
): void {
  appendRemoteLog({ ...devInfo, capability, action, detail, success, error })
}

function ensureRemoteConfirmation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  settings: RemoteControlSettings,
  devInfo: RemoteDeviceInfo,
  capability: RemoteCapability,
  action: string
): boolean {
  if (!settings.requireConfirmation.includes(capability)) return true
  if (hasRemoteConfirmation(req)) return true
  logAttempt(devInfo, capability, action, 'Confirmation required', false, 'Confirmation required')
  jsonError(res, 428, 'Confirmation required')
  return false
}

function hasRemoteConfirmation(req: http.IncomingMessage): boolean {
  const raw = req.headers['x-remote-confirmed'] ?? req.headers['x-remote-confirmation']
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '1' || value === 'true'
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
