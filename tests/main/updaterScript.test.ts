import { describe, it, expect } from 'vitest'
import { buildHelperBatScript } from '../../src/main/updaterScript'

/**
 * 一鍵更新的 helper .bat。
 *
 * 這是 `src/main/` 底下少數測得到的東西——`updaterScript.ts` 只 import `path`，
 * 沒有 electron，所以可以直接跑（其餘 main/ 的東西仍在測試範圍外，見 vitest.config.ts）。
 * 值得測的理由：這支腳本執行時主程式已經關掉，出錯就是「使用者的程式開不起來」，
 * 而且沒有任何畫面能回報錯誤。
 */

const dirOpts = {
  kind: 'unpacked-dir' as const,
  stagingDir: 'C:\\Temp\\DesktopST-update-1\\staged',
  downloadedFile: 'C:\\Temp\\DesktopST-update-1\\DesktopST-v0.5.6-full.zip',
  targetPath: 'D:\\My Apps\\DesktopST',
  pid: 4321
}

const exeOpts = {
  kind: 'portable-exe' as const,
  stagingDir: 'C:\\Temp\\DesktopST-update-1',
  downloadedFile: 'C:\\Temp\\DesktopST-update-1\\DesktopST 0.5.6.exe',
  targetPath: 'D:\\My Apps\\DesktopST 0.5.5.exe',
  pid: 4321
}

describe('buildHelperBatScript', () => {
  it('內容全是 ASCII（.bat 用主控台字碼頁解讀，中文會亂碼）', () => {
    for (const script of [buildHelperBatScript(dirOpts), buildHelperBatScript(exeOpts)]) {
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(script)).toBe(true)
    }
  })

  it('系統工具走絕對路徑（PATH 裡有 Git／GnuWin 時 find、timeout 會被搶走）', () => {
    const script = buildHelperBatScript(dirOpts)
    for (const tool of ['tasklist.exe', 'find.exe', 'ping.exe', 'robocopy.exe']) {
      expect(script).toContain(`%SystemRoot%\\System32\\${tool}`)
      // 不能有沒加路徑的裸呼叫
      expect(new RegExp(`(^|[^\\\\])\\b${tool.replace('.', '\\.')}`, 'm').test(script)).toBe(false)
    }
  })

  it('延遲用 ping 而不是 timeout（stdio ignore 時 timeout 會直接失敗，等於沒等）', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).not.toContain('timeout')
    expect(script).toContain('ping.exe -n 2 127.0.0.1 >nul')
  })

  it('用 CRLF 換行', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script.endsWith('\r\n')).toBe(true)
    expect(script.includes('\n\n')).toBe(false)
  })

  it('先等舊版程式的 PID 結束，再等檔案解鎖', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).toContain('tasklist.exe /FI "PID eq 4321"')
    expect(script.indexOf(':waitpid')).toBeLessThan(script.indexOf(':waitlock'))
    // 等不到就收手，不要無窮迴圈卡在那裡
    expect(script).toContain('if %RETRY% GEQ 60')
  })

  it('免安裝版用 robocopy /E，而且不能有 /MIR（會刪掉使用者放在資料夾裡的東西）', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).toContain('robocopy.exe "C:\\Temp\\DesktopST-update-1\\staged" "D:\\My Apps\\DesktopST" /E')
    expect(script).not.toContain('/MIR')
    expect(script).not.toContain('/PURGE')
    // robocopy 的 1–7 都算成功，只有 >= 8 是真的失敗
    expect(script).toContain('if errorlevel 8')
  })

  it('單檔版直接換掉那個 exe，不動別的檔案', () => {
    const script = buildHelperBatScript(exeOpts)
    expect(script).toContain('move /y "C:\\Temp\\DesktopST-update-1\\DesktopST 0.5.6.exe" "D:\\My Apps\\DesktopST 0.5.5.exe"')
    expect(script).not.toContain('robocopy')
  })

  it('含空白的路徑一律加引號', () => {
    const script = buildHelperBatScript(dirOpts)
    for (const line of script.split('\r\n')) {
      if (!line.includes('My Apps')) continue
      expect(line).toMatch(/"[^"]*My Apps[^"]*"/)
    }
  })

  it('免安裝版等的鎖定檔與重啟目標都是安裝資料夾裡的主程式', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).toContain('2>nul (>>"D:\\My Apps\\DesktopST\\DesktopST.exe" type nul)')
    expect(script).toContain('start "" "D:\\My Apps\\DesktopST\\DesktopST.exe"')
  })

  it('單檔版等的鎖定檔與重啟目標都是那個 exe 本身', () => {
    const script = buildHelperBatScript(exeOpts)
    expect(script).toContain('2>nul (>>"D:\\My Apps\\DesktopST 0.5.5.exe" type nul)')
    expect(script).toContain('start "" "D:\\My Apps\\DesktopST 0.5.5.exe"')
  })

  it('最後會清掉暫存並自刪（先跳出腳本再 del，不然刪不掉自己）', () => {
    const script = buildHelperBatScript(dirOpts)
    const tail = script.trimEnd().split('\r\n').slice(-3)
    expect(tail[0]).toContain('start "" ')
    expect(tail[1]).toContain('rmdir /s /q')
    expect(tail[2]).toBe('(goto) 2>nul & del "%~f0"')
  })
})
