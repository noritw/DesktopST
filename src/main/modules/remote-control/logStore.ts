/**
 * remoteControlLog.ts
 * 遙控操作記錄：ring buffer 500 筆，存於 remote-control-log.json
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

const MAX_ENTRIES = 500

export interface RemoteControlLogEntry {
  timestamp: number
  ip: string
  deviceId: string
  deviceNickname: string
  deviceLabel: string
  action: string
  detail: string
}

let logCache: RemoteControlLogEntry[] | null = null

function getLogPath(): string {
  return path.join(app.getPath('userData'), 'remote-control-log.json')
}

function loadLog(): RemoteControlLogEntry[] {
  if (logCache) return logCache
  try {
    const raw = fs.readFileSync(getLogPath(), 'utf8')
    const parsed = JSON.parse(raw)
    logCache = Array.isArray(parsed) ? parsed : []
  } catch {
    logCache = []
  }
  return logCache
}

function saveLog(entries: RemoteControlLogEntry[]): void {
  try {
    fs.writeFileSync(getLogPath(), JSON.stringify(entries), 'utf8')
  } catch {}
}

export function appendRemoteLog(entry: Omit<RemoteControlLogEntry, 'timestamp'>): void {
  const entries = loadLog()
  entries.push({ ...entry, timestamp: Date.now() })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  logCache = entries
  saveLog(entries)
}

export function getRemoteLog(): RemoteControlLogEntry[] {
  return [...loadLog()].reverse() // newest first
}

export function clearRemoteLog(): void {
  logCache = []
  saveLog([])
}

export function parseDeviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return '未知裝置'
  const ua = userAgent.toLowerCase()
  if (ua.includes('iphone')) return 'iPhone'
  if (ua.includes('ipad')) return 'iPad'
  if (ua.includes('android')) {
    if (ua.includes('tablet') || ua.includes('sm-t') || ua.includes('tab')) return 'Android 平板'
    return 'Android 手機'
  }
  if (ua.includes('windows')) return 'Windows 裝置'
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac 裝置'
  if (ua.includes('linux')) return 'Linux 裝置'
  return '未知裝置'
}
