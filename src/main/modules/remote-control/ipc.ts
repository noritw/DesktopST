import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { exec } from 'child_process'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { clearRemoteLog, getRemoteLog } from './logStore'
import type { ModuleIpcRegistry } from '../moduleTypes'

async function resolveProgram(filePath: string): Promise<{ path: string; defaultName: string; iconDataUrl?: string } | null> {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const defaultName = fileName.replace(/\.(?:exe|lnk)$/i, '')
  let iconDataUrl: string | undefined
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' })
    const resized = icon.resize({ width: 32, height: 32, quality: 'best' })
    iconDataUrl = resized.toDataURL()
  } catch (e) {
    console.warn('[remote] getFileIcon failed:', e)
  }
  return { path: filePath, defaultName, iconDataUrl }
}

function listStartMenuPrograms(): { name: string; path: string }[] {
  const folders = [
    join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
  ]
  const results: { name: string; path: string }[] = []

  function scan(dir: string): void {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        try {
          const stat = statSync(full)
          if (stat.isDirectory()) {
            scan(full)
          } else if (entry.toLowerCase().endsWith('.lnk')) {
            results.push({ name: entry.replace(/\.lnk$/i, ''), path: full })
          }
        } catch {}
      }
    } catch {}
  }

  for (const f of folders) scan(f)
  results.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  return results
}

async function listProcesses(): Promise<{ name: string; path: string }[]> {
  const script = [
    '$OutputEncoding=[Text.Encoding]::UTF8;[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$p=Get-Process -ErrorAction SilentlyContinue|Where-Object{$_.Path}|Sort-Object ProcessName|Select-Object ProcessName,Path',
    'if($p){$p|ConvertTo-Json -Compress -Depth 1}else{\'[]\'}'
  ].join(';')
  const raw = await new Promise<string>(resolve => {
    exec(`powershell -NoProfile -NonInteractive -Command "${script}"`, { encoding: 'utf8', timeout: 8000 }, (err, stdout) => {
      resolve(err ? '[]' : stdout.trim())
    })
  })

  try {
    const arr = JSON.parse(raw)
    const list = (Array.isArray(arr) ? arr : [arr]) as { ProcessName: string; Path: string }[]
    const systemDirs = ['\\windows\\system32\\', '\\windows\\syswow64\\', '\\windows\\systemapps\\']
    const seen = new Set<string>()
    return list
      .filter(p => {
        if (!p?.Path) return false
        const lower = p.Path.toLowerCase()
        if (systemDirs.some(d => lower.includes(d))) return false
        if (seen.has(lower)) return false
        seen.add(lower)
        return true
      })
      .map(p => ({ name: p.ProcessName, path: p.Path }))
  } catch {
    return []
  }
}

export function registerRemoteControlIpcHandlers(registry: ModuleIpcRegistry = ipcMain): void {
  registry.handle('remote:pick-program', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: '選擇要啟動的程式',
      properties: ['openFile'],
      filters: [
        { name: '程式或捷徑', extensions: ['exe', 'lnk'] },
        { name: '所有檔案', extensions: ['*'] }
      ]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return resolveProgram(result.filePaths[0])
  })

  registry.handle('remote:resolve-program', async (_, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) return null
    return resolveProgram(filePath)
  })

  registry.handle('remote:list-start-menu', () => listStartMenuPrograms())

  registry.handle('remote:list-processes', () => listProcesses())

  registry.handle('remote:get-log', () => getRemoteLog())

  registry.handle('remote:clear-log', () => {
    clearRemoteLog()
    return { ok: true }
  })
}
