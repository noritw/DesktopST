import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { app } from 'electron'

const RELAY_URL = 'https://relay.nori.tw'
const LEGACY_RELAY_URLS = new Set([
  'https://dest-relay.nori942.workers.dev',
  'https://dest-relay.nori942.workers.dev/'
])

export interface RelayConfig {
  deviceId: string
  relayUrl: string
  deviceSecret: string
  accessToken: string
}

let config: RelayConfig | null = null

function getConfigPath(): string {
  const dataDir = path.join(app.getPath('userData'), 'DesktopST')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  return path.join(dataDir, 'relay-config.json')
}

function loadConfig(): RelayConfig {
  const configPath = getConfigPath()
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (data.deviceId) {
        const storedRelayUrl = data.relayUrl ?? RELAY_URL
        const relayUrl = LEGACY_RELAY_URLS.has(storedRelayUrl) ? RELAY_URL : storedRelayUrl
        const migrated: RelayConfig = {
          deviceId: data.deviceId,
          relayUrl,
          deviceSecret: data.deviceSecret ?? randomToken(),
          accessToken: data.accessToken ?? randomToken()
        }
        if (relayUrl !== data.relayUrl || !data.relayUrl || !data.deviceSecret || !data.accessToken) {
          saveConfig(migrated)
        }
        return migrated
      }
    } catch {}
  }

  const newConfig: RelayConfig = {
    deviceId: uuidv4(),
    relayUrl: RELAY_URL,
    deviceSecret: randomToken(),
    accessToken: randomToken()
  }
  saveConfig(newConfig)
  return newConfig
}

function saveConfig(cfg: RelayConfig): void {
  const configPath = getConfigPath()
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function getConfig(): RelayConfig {
  if (!config) config = loadConfig()
  return config
}

async function postToRelay(deviceId: string, relayUrl: string, tunnelUrl: string): Promise<boolean> {
  const cfg = getConfig()
  try {
    const res = await fetch(`${relayUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        tunnelUrl,
        deviceSecret: cfg.deviceSecret,
        accessToken: cfg.accessToken
      })
    })
    return res.ok
  } catch {
    return false
  }
}

/** DeST 啟動時先佔位，讓手機看到等待頁而非 DNS 錯誤 */
export async function registerStarting(): Promise<void> {
  const cfg = getConfig()
  await postToRelay(cfg.deviceId, cfg.relayUrl, 'starting')
  console.log('[Relay] Registered starting state')
}

/** Tunnel 就緒後更新真實 URL */
export async function registerTunnel(tunnelUrl: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = getConfig()
  const ok = await postToRelay(cfg.deviceId, cfg.relayUrl, tunnelUrl)
  if (ok) console.log('[Relay] Registered tunnel:', tunnelUrl)
  else console.warn('[Relay] Registration failed')
  return ok ? { ok: true } : { ok: false, error: 'HTTP error' }
}

/** DeST 關閉時清除，讓手機看到「裝置離線」 */
export async function registerOffline(): Promise<void> {
  const cfg = getConfig()
  await postToRelay(cfg.deviceId, cfg.relayUrl, 'offline')
}

export function getRelayUrl(): string {
  const cfg = getConfig()
  return `${cfg.relayUrl}/${cfg.deviceId}?token=${encodeURIComponent(cfg.accessToken)}`
}

export function getDeviceId(): string {
  return getConfig().deviceId
}

export function getAccessToken(): string {
  return getConfig().accessToken
}
