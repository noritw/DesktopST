import * as path from 'path'

/**
 * 一鍵更新用的 helper .bat 產生器（純字串，沒有 electron 依賴，所以測得到）。
 *
 * 為什麼要獨立出來：這段是整個更新流程裡最容易寫錯又最難補救的部分——
 * 它跑的時候主程式已經關掉了，錯了就是「使用者的程式開不起來」，
 * 而且沒有任何畫面可以回報。`tests/main/updaterScript.test.ts` 守住 cmd 語法。
 *
 * ⚠️ 內容一律是**純 ASCII 英文**：.bat 由主控台字碼頁解讀（繁中 Windows ＝ 950），
 * 寫中文就得處理編碼，錯了會變亂碼、甚至整行 parse 失敗。
 */

export interface HelperBatOptions {
  /** 'portable-exe' ＝換掉單一 exe；'unpacked-dir' ＝覆蓋整個安裝資料夾 */
  kind: 'portable-exe' | 'unpacked-dir'
  /** 解壓縮後的暫存資料夾（unpacked-dir 才用得到） */
  stagingDir: string
  /** 下載下來的檔案（portable-exe 時就是新版 exe） */
  downloadedFile: string
  /** 覆蓋目標：單檔版＝exe 路徑；免安裝版＝安裝資料夾 */
  targetPath: string
  /** 舊版主程式的 PID，.bat 要等它結束才能動手 */
  pid: number
}

/**
 * 系統工具一律走絕對路徑。
 *
 * 使用者的 PATH 裡如果有 Git for Windows／GnuWin（很常見），`find`、`timeout` 這些
 * 名字會被同名的 unix 工具搶走，語法對不上 → 等待迴圈直接失效，變成「主程式還沒關
 * 就開始覆蓋」。實測就踩到：`tasklist | find "PID"` 吐 `find: '999999': No such file`。
 */
const SYS = '%SystemRoot%\\System32'

/**
 * 等一秒。
 *
 * **不能用 `timeout /t 1`**：stdin 被重導向時它會直接失敗（`ERROR: Input redirection
 * is not supported`），而主程式是用 `spawn(..., { stdio: 'ignore' })` 叫起這支 .bat 的，
 * stdin 就是 NUL ＝已重導向。實測到的症狀是「等 60 秒」在 0.9 秒內跑完整個重試迴圈——
 * 等於完全沒等。`ping -n 2` 不挑 stdin，是這個場合的標準替代。
 */
const SLEEP_1S = `${SYS}\\ping.exe -n 2 127.0.0.1 >nul`

export function buildHelperBatScript(o: HelperBatOptions): string {
  // 單檔版的鎖定目標就是那個 exe 本身；免安裝版則看資料夾裡的主程式
  const lockFile = o.kind === 'portable-exe' ? o.targetPath : path.join(o.targetPath, 'DesktopST.exe')
  const launchExe = lockFile

  const lines: string[] = [
    '@echo off',
    'setlocal',
    'title DesktopST Updater',
    'echo Waiting for DesktopST to exit...',
    ':waitpid',
    `${SYS}\\tasklist.exe /FI "PID eq ${o.pid}" 2>nul | ${SYS}\\find.exe "${o.pid}" >nul`,
    'if not errorlevel 1 (',
    `  ${SLEEP_1S}`,
    '  goto waitpid',
    ')',
    // PID 不見了不代表檔案馬上就解鎖（portable 版還有外層啟動器要收尾），
    // 所以再等到檔案真的可寫為止，最多 60 秒。
    'set RETRY=0',
    ':waitlock',
    `2>nul (>>"${lockFile}" type nul) && goto ready`,
    'set /a RETRY+=1',
    'if %RETRY% GEQ 60 (',
    '  echo Timed out waiting for the old version to release the file.',
    '  echo Nothing was changed. Press any key to close.',
    '  pause >nul',
    '  exit /b 1',
    ')',
    SLEEP_1S,
    'goto waitlock',
    ':ready',
    'echo Installing update...'
  ]

  if (o.kind === 'portable-exe') {
    lines.push(
      `move /y "${o.downloadedFile}" "${o.targetPath}" >nul`,
      'if errorlevel 1 (',
      '  echo Update failed. The old version was not modified.',
      '  pause >nul',
      '  exit /b 1',
      ')'
    )
  } else {
    lines.push(
      // /E 不加 /MIR：只覆蓋與新增，不刪除使用者自己放進安裝資料夾的東西。
      // robocopy 的 exit code < 8 都算成功（1 ＝有複製、0 ＝無事可做）。
      `${SYS}\\robocopy.exe "${o.stagingDir}" "${o.targetPath}" /E /IS /IT /R:3 /W:2 /NFL /NDL /NJH /NJS >nul`,
      'if errorlevel 8 (',
      '  echo Update failed. The old version was not modified.',
      '  pause >nul',
      '  exit /b 1',
      ')'
    )
  }

  lines.push(
    'echo Done. Restarting DesktopST...',
    `start "" "${launchExe}"`,
    `rmdir /s /q "${o.stagingDir}" 2>nul`,
    // 執行中的 .bat 自刪：先跳出腳本再刪，cmd 已讀完這一行所以刪得掉
    '(goto) 2>nul & del "%~f0"'
  )

  return lines.join('\r\n') + '\r\n'
}
