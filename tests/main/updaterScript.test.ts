import { describe, it, expect } from 'vitest'
import { buildHelperBatScript, matchesUpdateAsset } from '../../src/main/updaterScript'

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
  failLogPath: 'C:\\Temp\\DesktopST-update-failed.log'
}

const exeOpts = {
  kind: 'portable-exe' as const,
  stagingDir: 'C:\\Temp\\DesktopST-update-1',
  downloadedFile: 'C:\\Temp\\DesktopST-update-1\\DesktopST 0.5.6.exe',
  targetPath: 'D:\\My Apps\\DesktopST 0.5.5.exe',
  failLogPath: 'C:\\Temp\\DesktopST-update-failed.log'
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
    for (const tool of ['ping.exe', 'robocopy.exe']) {
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

  it('等到舊版放開檔案才動手，等不到就收手', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).toContain(':waitlock')
    // 等不到就收手，不要無窮迴圈卡在那裡
    expect(script).toContain('if %RETRY% GEQ 120')
  })

  it('不准出現管線與 pause（detached + stdio ignore 下，前者卡死、後者一閃而過）', () => {
    for (const script of [buildHelperBatScript(dirOpts), buildHelperBatScript(exeOpts)]) {
      expect(script).not.toContain('|')
      expect(script).not.toContain('pause')
      expect(script).not.toContain('tasklist')
    }
  })

  it('echo 行不准出現括號（會提前關掉 if 區塊，整支腳本 parse 失敗）', () => {
    for (const script of [buildHelperBatScript(dirOpts), buildHelperBatScript(exeOpts)]) {
      for (const line of script.split('\r\n')) {
        if (!line.trimStart().toLowerCase().startsWith('echo ')) continue
        expect(line).not.toContain('(')
        expect(line).not.toContain(')')
      }
    }
  })

  it('錯誤處理用標籤跳轉，不用 if 小括號區塊', () => {
    for (const script of [buildHelperBatScript(dirOpts), buildHelperBatScript(exeOpts)]) {
      expect(script).toMatch(/if errorlevel \d+ goto failapply/)
      expect(script).toContain('if %RETRY% GEQ 120 goto failwait')
      expect(script).toContain(':failwait')
      expect(script).toContain(':failapply')
      // if ... ( 這種開區塊寫法一律不要
      expect(script).not.toMatch(/^if .*\($/m)
    }
  })

  it('成功路徑在自刪那行結束，不會掉進失敗標籤', () => {
    const script = buildHelperBatScript(dirOpts)
    const lines = script.trimEnd().split('\r\n')
    const selfDelete = lines.indexOf('(goto) 2>nul & del "%~f0"')
    expect(selfDelete).toBeGreaterThan(0)
    // 自刪之後就只剩失敗處理
    expect(lines[selfDelete + 1]).toBe(':failwait')
  })

  it('失敗時把原因寫進 log 檔（程式已經關了，沒有畫面可以回報）', () => {
    const script = buildHelperBatScript(dirOpts)
    expect(script).toContain('C:\\Temp\\DesktopST-update-failed.log')
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

  it('覆蓋成功後依序重啟、清暫存、自刪（先跳出腳本再 del，不然刪不掉自己）', () => {
    const lines = buildHelperBatScript(dirOpts).trimEnd().split('\r\n')
    const i = lines.indexOf('(goto) 2>nul & del "%~f0"')
    expect(lines[i - 4]).toContain('echo Done. Restarting')
    expect(lines[i - 3]).toContain('start "" ')
    // 下載檔 400 MB 起跳，每次更新都留一份的話 %TEMP% 會爆
    expect(lines[i - 2]).toContain('del /q')
    expect(lines[i - 1]).toContain('rmdir /s /q')
  })
})

describe('matchesUpdateAsset', () => {
  // 2026-09-15 發 v0.5.6 時從 `gh release view` 抄回來的真實檔名。
  // 重點：本機是 `DesktopST 0.5.6.exe`（空白），GitHub 上變成 `DesktopST.0.5.6.exe`（點）。
  it('吃得下 GitHub 把空白換成點之後的單檔 EXE 名稱', () => {
    expect(matchesUpdateAsset('portable-exe', 'DesktopST.0.5.6.exe')).toBe(true)
    expect(matchesUpdateAsset('portable-exe', 'DesktopST 0.5.6.exe')).toBe(true)
    expect(matchesUpdateAsset('portable-exe', 'DesktopST-0.5.6.exe')).toBe(true)
    expect(matchesUpdateAsset('portable-exe', 'DesktopST0.5.6.exe')).toBe(true)
  })

  it('免安裝 zip 認得出來', () => {
    expect(matchesUpdateAsset('unpacked-dir', 'DesktopST-v0.5.6-full.zip')).toBe(true)
  })

  it('兩種型態不會互相配到，也不會配到別的附件', () => {
    expect(matchesUpdateAsset('portable-exe', 'DesktopST-v0.5.6-full.zip')).toBe(false)
    expect(matchesUpdateAsset('unpacked-dir', 'DesktopST.0.5.6.exe')).toBe(false)
    // Release 上還有這些，都不能誤配
    expect(matchesUpdateAsset('portable-exe', 'DeST-v0.5.6-release.apk')).toBe(false)
    expect(matchesUpdateAsset('unpacked-dir', 'DeST-v0.5.6-release.apk')).toBe(false)
    expect(matchesUpdateAsset('portable-exe', 'DesktopST_TRPGPack.dstpack')).toBe(false)
    expect(matchesUpdateAsset('unpacked-dir', 'DeSTNutrition-latest.apk')).toBe(false)
  })
})
