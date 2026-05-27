import * as child_process from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { app } from 'electron'

let tunnelProcess: child_process.ChildProcess | null = null
let currentUrl: string | null = null
let urlCallbacks: ((url: string) => void)[] = []
let statusCallbacks: ((status: 'connecting' | 'ready' | 'error') => void)[] = []

function getCloudflaredExePath(): string {
  // packaged: 放在 exe 旁邊的 cloudflared 資料夾
  // dev: 放在專案根目錄的 bin 資料夾
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'cloudflared', 'cloudflared.exe')
  }
  return path.join(app.getAppPath(), 'bin', 'cloudflared.exe')
}

export function isCloudflaredAvailable(): boolean {
  return fs.existsSync(getCloudflaredExePath())
}

/** 下載 cloudflared.exe（首次使用時） */
export async function downloadCloudflaredIfNeeded(): Promise<boolean> {
  const exePath = getCloudflaredExePath()
  if (fs.existsSync(exePath)) return true

  const dir = path.dirname(exePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  console.log('[Cloudflared] Downloading from:', downloadUrl)

  return new Promise((resolve) => {
    const doDownload = (url: string) => {
      const file = fs.createWriteStream(exePath)
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close()
          fs.unlink(exePath, () => {})
          doDownload(response.headers.location!)
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          console.log('[Cloudflared] Downloaded to:', exePath)
          resolve(true)
        })
        file.on('error', () => {
          file.close()
          fs.unlink(exePath, () => {})
          resolve(false)
        })
      }).on('error', (e) => {
        file.close()
        fs.unlink(exePath, () => {})
        console.error('[Cloudflared] Download error:', e)
        resolve(false)
      })
    }
    doDownload(downloadUrl)
  })
}

export function getUrl(): string | null {
  return currentUrl
}

export function isRunning(): boolean {
  return tunnelProcess !== null
}

export function onUrlReady(cb: (url: string) => void): void {
  if (currentUrl) {
    cb(currentUrl)
    return
  }
  urlCallbacks.push(cb)
}

export function onStatusChange(cb: (status: 'connecting' | 'ready' | 'error') => void): void {
  statusCallbacks.push(cb)
}

function notifyStatus(status: 'connecting' | 'ready' | 'error'): void {
  for (const cb of statusCallbacks) {
    try { cb(status) } catch {}
  }
}

/** 用提升權限的 PowerShell 新增防火牆規則，讓 cloudflared 不被擋 */
export async function addFirewallException(): Promise<boolean> {
  const exePath = getCloudflaredExePath()
  if (!fs.existsSync(exePath)) return false
  return new Promise((resolve) => {
    const ps = `New-NetFirewallRule -DisplayName 'DesktopST-cloudflared' -Program '${exePath}' -Direction Inbound -Action Allow -ErrorAction SilentlyContinue`
    const proc = child_process.spawn('powershell', [
      '-Command',
      `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -Command "${ps.replace(/'/g, "\\'")}"' -Wait`
    ], { shell: false })
    proc.on('exit', (code) => resolve(code === 0))
    proc.on('error', () => resolve(false))
  })
}

const TUNNEL_TIMEOUT_MS = 30_000

export async function startCloudflared(port: number): Promise<void> {
  if (tunnelProcess) return

  const exePath = getCloudflaredExePath()
  if (!fs.existsSync(exePath)) {
    console.warn('[Cloudflared] Executable not found at', exePath)
    notifyStatus('error')
    return
  }

  currentUrl = null
  notifyStatus('connecting')

  // 若超過 30 秒還沒拿到 URL，通知前端可能被防火牆擋住
  const timeoutHandle = setTimeout(() => {
    if (!currentUrl) {
      console.warn('[Cloudflared] Timeout: no URL after 30s, possibly blocked by firewall')
      notifyStatus('firewall-blocked' as 'error')
    }
  }, TUNNEL_TIMEOUT_MS)

  tunnelProcess = child_process.spawn(
    exePath,
    ['tunnel', '--url', `http://localhost:${port}`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  const onData = (data: Buffer): void => {
    const text = data.toString()
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (match && !currentUrl) {
      currentUrl = match[0]
      clearTimeout(timeoutHandle)
      console.log('[Cloudflared] Tunnel URL:', currentUrl)
      notifyStatus('ready')
      for (const cb of urlCallbacks) {
        try { cb(currentUrl) } catch {}
      }
      urlCallbacks = []
    }
  }

  tunnelProcess.stdout?.on('data', onData)
  tunnelProcess.stderr?.on('data', onData)

  tunnelProcess.on('exit', (code) => {
    console.log('[Cloudflared] Process exited with code:', code)
    tunnelProcess = null
    currentUrl = null
  })

  tunnelProcess.on('error', (e) => {
    console.error('[Cloudflared] Spawn error:', e)
    tunnelProcess = null
    currentUrl = null
    notifyStatus('error')
  })
}

export function stopCloudflared(): void {
  if (tunnelProcess) {
    tunnelProcess.kill()
    tunnelProcess = null
  }
  currentUrl = null
  urlCallbacks = []
}
