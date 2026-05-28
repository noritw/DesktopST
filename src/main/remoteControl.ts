/**
 * remoteControl.ts
 * 遠端鍵鼠操作 / 程式啟動 / 系統動作
 * 全部透過 PowerShell + Win32 API 實作，不需要 native npm module。
 */

import { exec, spawn } from 'child_process'
import { shell } from 'electron'
import type { RegisteredProgram } from './types'

// 啟動中程式追蹤：programId → pid[]
const launchedPids = new Map<string, number[]>()

// 防止系統休眠的背景 PS 程序（關閉螢幕時啟動，喚醒時終止）
let keepAwakeProcess: ReturnType<typeof spawn> | null = null

function stopKeepAwake(): void {
  if (keepAwakeProcess) {
    try { keepAwakeProcess.kill() } catch {}
    keepAwakeProcess = null
  }
}

// ── 工具 ──────────────────────────────────────────────────

function runPS(script: string, timeout = 5000): Promise<{ ok: boolean; stdout: string; error?: string }> {
  return new Promise(resolve => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${script}"`,
      { encoding: 'utf8', timeout },
      (err, stdout, stderr) => {
        if (err) resolve({ ok: false, stdout: stdout?.trim() ?? '', error: stderr?.trim() || String(err) })
        else resolve({ ok: true, stdout: stdout?.trim() ?? '' })
      }
    )
  })
}

/** Add-Type 定義（click 用） */
const CLICK_TYPE_DEF = [
  'Add-Type -TypeDefinition \'',
  'using System;using System.Runtime.InteropServices;',
  'public class RC{',
  '[DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);',
  '[DllImport(\\"user32.dll\\")]public static extern void mouse_event(uint f,int dx,int dy,uint d,UIntPtr e);',
  '}\''
].join('')

/** Add-Type 定義（scroll 用，dwData 為 int 方便傳負值） */
const SCROLL_TYPE_DEF = [
  'Add-Type -TypeDefinition \'',
  'using System;using System.Runtime.InteropServices;',
  'public class RS{',
  '[DllImport(\\"user32.dll\\")]public static extern bool SetCursorPos(int x,int y);',
  '[DllImport(\\"user32.dll\\")]public static extern void mouse_event(uint f,int dx,int dy,int d,UIntPtr e);',
  '}\''
].join('')

// INPUT_TYPE_DEF 已移除：改用剪貼簿+貼上方式輸入文字，不再依賴 SendInput struct 尺寸

// ── 滑鼠點擊 ──────────────────────────────────────────────

type ClickButton = 'left' | 'right' | 'middle'

/**
 * 在桌面物理座標 (x, y) 執行滑鼠點擊。
 * double=true 連點兩次；button 選左/右/中鍵。
 */
export async function clickAt(
  x: number,
  y: number,
  button: ClickButton = 'left',
  double = false
): Promise<{ ok: boolean; error?: string }> {
  // MOUSEEVENTF: leftDown=2 leftUp=4 rightDown=8 rightUp=16 middleDown=32 middleUp=64
  const [downFlag, upFlag] =
    button === 'right' ? [8, 16] :
    button === 'middle' ? [32, 64] :
    [2, 4]

  const clicks = double ? 2 : 1
  const clickScript = Array.from({ length: clicks }, () =>
    `[RC]::mouse_event(${downFlag},0,0,0,[UIntPtr]::Zero);Start-Sleep -Milliseconds 50;[RC]::mouse_event(${upFlag},0,0,0,[UIntPtr]::Zero)`
  ).join(';Start-Sleep -Milliseconds 80;')

  const script = [
    CLICK_TYPE_DEF,
    `[RC]::SetCursorPos(${Math.round(x)},${Math.round(y)})`,
    'Start-Sleep -Milliseconds 80',
    clickScript
  ].join(';')

  return runPS(script)
}

// ── 鍵盤輸入 ──────────────────────────────────────────────

/**
 * 送出文字到目前 focus 的控制項。
 * 使用剪貼簿+Ctrl+V 貼上，完整支援中文／英文／符號，不依賴 SendInput struct 尺寸。
 * 注意：會覆蓋剪貼簿內容（完成後還原）。
 */
export async function typeText(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!text) return { ok: true }

  // 逸出單引號（PowerShell here-string 不能用，改用字串拼接）
  // 使用 [System.Windows.Forms.Clipboard]::SetText 支援 Unicode
  const escaped = text.replace(/'/g, "''")
  const script = [
    'Add-Type -Assembly System.Windows.Forms',
    `$prev=[System.Windows.Forms.Clipboard]::GetText()`,
    `[System.Windows.Forms.Clipboard]::SetText('${escaped}')`,
    'Start-Sleep -Milliseconds 80',
    `(New-Object -COM WScript.Shell).SendKeys('^v')`,
    'Start-Sleep -Milliseconds 200',
    // 還原剪貼簿：若原本有文字就還原，否則清空
    `if($prev){[System.Windows.Forms.Clipboard]::SetText($prev)}else{[System.Windows.Forms.Clipboard]::Clear()}`
  ].join(';')

  return runPS(script, 10000)
}

/**
 * 送出快捷鍵組合，例如 "Enter" / "Escape" / "ctrl+c" / "alt+tab"。
 * 使用 WScript.Shell SendKeys（虛擬鍵名稱）。
 */
export async function sendKey(combo: string): Promise<{ ok: boolean; error?: string }> {
  // 把常見格式轉成 SendKeys 格式
  const normalized = combo
    .toLowerCase()
    .replace(/ctrl\+/g, '^')
    .replace(/alt\+/g, '%')
    .replace(/shift\+/g, '+')
    .replace(/win\+/g, '^{ESC}') // 近似，不完全等價
    .replace(/enter/g, '{ENTER}')
    .replace(/escape|esc/g, '{ESC}')
    .replace(/tab/g, '{TAB}')
    .replace(/backspace/g, '{BACKSPACE}')
    .replace(/delete|del/g, '{DELETE}')
    .replace(/space/g, ' ')
    .replace(/home/g, '{HOME}')
    .replace(/end/g, '{END}')
    .replace(/pageup/g, '{PGUP}')
    .replace(/pagedown/g, '{PGDN}')
    .replace(/up/g, '{UP}')
    .replace(/down/g, '{DOWN}')
    .replace(/left/g, '{LEFT}')
    .replace(/right/g, '{RIGHT}')
    .replace(/f(\d+)/g, '{F$1}')

  // 逸出單引號
  const safe = normalized.replace(/'/g, "''")
  const script = `(New-Object -COM WScript.Shell).SendKeys('${safe}')`
  return runPS(script)
}

// ── 程式啟動 / 關閉 ──────────────────────────────────────

/**
 * 啟動白名單程式，回傳 PID（用於之後關閉）。
 * 使用 shell.openPath 讓 Windows 處理 .lnk / UWP 全部相容。
 */
export async function launchProgram(program: RegisteredProgram): Promise<{ ok: boolean; pid?: number; error?: string }> {
  try {
    const err = await shell.openPath(program.path)
    if (err) return { ok: false, error: err }

    // shell.openPath 不回傳 PID，改用 PS 查詢剛啟動的同名程序
    await new Promise(r => setTimeout(r, 800))
    const exeName = program.path.split(/[\\/]/).pop()?.replace(/\.(?:exe|lnk)$/i, '') ?? ''
    if (exeName) {
      const result = await runPS(`(Get-Process -Name '${exeName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1).Id`)
      const pid = parseInt(result.stdout)
      if (!isNaN(pid)) {
        const pids = launchedPids.get(program.id) ?? []
        pids.push(pid)
        launchedPids.set(program.id, pids)
        return { ok: true, pid }
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * 關閉 DeST 啟動的程式（先用記錄的 PID，否則用執行檔名 taskkill）。
 */
export async function closeProgram(program: RegisteredProgram): Promise<{ ok: boolean; error?: string }> {
  const pids = launchedPids.get(program.id)
  if (pids?.length) {
    // 嘗試 graceful close (CloseMainWindow 等價)
    for (const pid of pids) {
      await runPS(`Stop-Process -Id ${pid} -ErrorAction SilentlyContinue`)
    }
    launchedPids.delete(program.id)
    return { ok: true }
  }

  // fallback：用執行檔名 taskkill（gentle，讓程式自己結束）
  const exeName = program.path.split(/[\\/]/).pop()
  if (!exeName) return { ok: false, error: 'Cannot determine exe name' }
  const result = await runPS(
    `Stop-Process -Name '${exeName.replace(/\.exe$/i, '').replace(/'/g, "''")}' -ErrorAction SilentlyContinue`
  )
  return result
}

/** 查詢某個程式是否還在執行中（優先用 PID，否則找名稱） */
export async function isProgramRunning(program: RegisteredProgram): Promise<boolean> {
  const pids = launchedPids.get(program.id)
  if (pids?.length) {
    const result = await runPS(
      `$p=Get-Process -Id ${pids[pids.length - 1]} -ErrorAction SilentlyContinue;if($p){'1'}else{'0'}`
    )
    if (result.stdout === '1') return true
    // PID 已消失，清掉紀錄
    launchedPids.delete(program.id)
  }
  // 再用名稱兜底查
  const exeName = program.path.split(/[\\/]/).pop()?.replace(/\.(?:exe|lnk)$/i, '')
  if (!exeName) return false
  const result = await runPS(
    `$p=Get-Process -Name '${exeName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue;if($p){'1'}else{'0'}`
  )
  return result.stdout === '1'
}

// ── 滑鼠滾輪 ──────────────────────────────────────────────

/**
 * 在桌面物理座標 (x, y) 執行滾輪事件。
 * deltaY > 0 = 向上滾（同 TouchEvent.deltaY 方向相反，這裡遵循 WheelEvent 慣例）
 * deltaX > 0 = 向右滾
 * 每單位約等於一格滾輪（WHEEL_DELTA=120）。
 */
export async function scrollAt(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number
): Promise<{ ok: boolean; error?: string }> {
  const steps: string[] = []
  // MOUSEEVENTF_WHEEL=0x0800, MOUSEEVENTF_HWHEEL=0x01000
  // Windows: 正 delta = 向上，負 delta = 向下
  if (deltaY !== 0) {
    const d = Math.round(deltaY * 120)
    steps.push(`[RS]::mouse_event(0x0800,0,0,${d},[UIntPtr]::Zero)`)
  }
  if (deltaX !== 0) {
    const d = Math.round(deltaX * 120)
    steps.push(`[RS]::mouse_event(0x01000,0,0,${d},[UIntPtr]::Zero)`)
  }
  if (!steps.length) return { ok: true }

  const script = [
    SCROLL_TYPE_DEF,
    `[RS]::SetCursorPos(${Math.round(x)},${Math.round(y)})`,
    'Start-Sleep -Milliseconds 30',
    ...steps
  ].join(';')

  return runPS(script)
}

// ── 系統動作 ─────────────────────────────────────────────

/**
 * 只關閉螢幕背光（不觸發 Windows 鎖定），省電用。
 * 同時啟動背景 PS 程序設定 ES_SYSTEM_REQUIRED，防止系統休眠（保持伺服器在線）。
 * 需要建議使用者將 Windows「需要登入」改為「從不」，這樣喚醒後不需密碼。
 */
export async function monitorOff(): Promise<{ ok: boolean; error?: string }> {
  stopKeepAwake()

  // 啟動持續執行的 PS 程序：防止系統休眠 + 關閉螢幕背光
  const keepScript = [
    `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;`,
    `public class MPC{`,
    `[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr h,int m,int w,int l);`,
    `[DllImport("kernel32.dll")]public static extern uint SetThreadExecutionState(uint s);}'`,
    `[MPC]::SetThreadExecutionState(0x80000001)|Out-Null`,
    `[MPC]::SendMessage([IntPtr](-1),0x0112,0xF170,2)|Out-Null`,
    `while($true){Start-Sleep -Seconds 30;[MPC]::SetThreadExecutionState(0x80000001)|Out-Null}`
  ].join(';')

  keepAwakeProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', keepScript], {
    detached: false,
    stdio: 'ignore'
  })
  keepAwakeProcess.on('error', () => { keepAwakeProcess = null })
  keepAwakeProcess.on('exit', () => { keepAwakeProcess = null })

  return { ok: true }
}

/** 喚醒螢幕後釋放防休眠狀態（由 wake 端點呼叫） */
export function releaseMonitorOff(): void {
  stopKeepAwake()
}

export async function shutdownPc(restart: boolean): Promise<{ ok: boolean; error?: string }> {
  const flag = restart ? '/r' : '/s'
  return new Promise(resolve => {
    exec(`shutdown ${flag} /t 0`, (err) => {
      if (err) resolve({ ok: false, error: String(err) })
      else resolve({ ok: true })
    })
  })
}
