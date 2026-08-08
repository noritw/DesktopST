/**
 * 產生手機 UI 即時預覽的 QR Code（由 `scripts/mobile-tool.mjs` 的 [3] 呼叫）。
 * `MOBILE_REAL=1` 走真的 DeST，否則接 stub 假伺服器。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const interfaces = os.networkInterfaces()
const ip = Object.values(interfaces).flat().find(x => x && x.family === 'IPv4' && !x.internal)?.address ?? '127.0.0.1'
const uiPort = Number(process.env.MOBILE_UI_PORT || 5180)
const stubPort = Number(process.env.MOBILE_STUB_PORT || 5999)
function appDataRoots() {
  const appData = process.env.APPDATA
  return appData ? [path.join(appData, 'DesktopST'), path.join(appData, 'DesktopST', 'DesktopST'), path.join(appData, 'desktop-st', 'DesktopST')] : []
}

function readRealConnection() {
  const candidates = appDataRoots().map(root => path.join(root, 'relay-config.json'))
  for (const configPath of candidates) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (typeof config.accessToken === 'string' && config.accessToken) return config.accessToken
    } catch { /* 試下一個既有資料目錄 */ }
  }
  throw new Error('找不到 DeST 的 relay-config.json，請先啟動一次 DeST。')
}

function readMobilePort() {
  const candidates = appDataRoots().flatMap(root => [path.join(root, 'settings.json'), path.join(root, 'Data', 'settings.json')])
  for (const settingsPath of candidates) {
    try {
      const port = Number(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))?.mobile?.port)
      if (Number.isInteger(port) && port > 0 && port < 65536) return port
    } catch { /* 使用預設埠 */ }
  }
  return 3721
}

const realMode = process.env.MOBILE_REAL === '1'
const serverUrl = process.env.MOBILE_SERVER_URL || `http://${ip}:${realMode ? readMobilePort() : stubPort}`
const token = process.env.MOBILE_TOKEN || (realMode ? readRealConnection() : 'x')
if (realMode) {
  try {
    const response = await fetch(`${serverUrl}/api/connection-info`, { headers: { 'X-DesktopST-Token': token } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new Error(`連不上真正的 DeST mobileServer（${serverUrl}）。請先開啟 DeST 並啟用手機遠端對話。${error instanceof Error ? ` ${error.message}` : ''}`)
  }
}
const url = `http://${ip}:${uiPort}/?server=${encodeURIComponent(serverUrl)}&token=${encodeURIComponent(token)}`
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mobile-test-qr.png')
await QRCode.toFile(output, url, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
console.log(`手機測試網址：${url}`)
console.log(`QR Code：${output}`)
