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
 *
 * ⚠️ **不要用管線（`|`）也不要用 `pause`。** 這支是被
 * `spawn(..., { detached: true, stdio: 'ignore' })` 叫起來的，stdin 是 NUL：
 * `tasklist | find "PID"` 實測會讓 `find.exe` 永遠卡在等 stdin（2026-09-15 真跑一次
 * 更新才發現，cmd 掛在那裡十幾分鐘、更新完全沒進行）；`pause` 則相反，會直接跳過，
 * 錯誤訊息一閃而逝。要留訊息就寫檔（`failLogPath`）。
 *
 * ⚠️ **錯誤處理用標籤跳轉，不要用 `if ... ( ... )` 區塊，而且 `echo` 裡不准有括號。**
 * cmd 是先把整個小括號區塊 parse 完才執行的，訊息裡只要出現一個 `)` 就會提前關掉區塊，
 * 後面的字被當成指令 → 整支腳本中止。同樣是 2026-09-15 實跑抓到的：
 * `echo robocopy failed ⟨exit code 8 or higher⟩ copying into ...` 讓更新停在
 * 「檔案已經覆蓋完成、但沒重新啟動也沒清暫存」的半套狀態，
 * 而且主控台只吐一句「copying 這個時候不應該…」，看起來完全不像自己寫的訊息造成的。
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
  /** 失敗訊息要寫去哪（.bat 沒有畫面也不能用 pause，只能留檔） */
  failLogPath: string
}

/**
 * Release 附件檔名是不是這種安裝型態要的那一個。
 *
 * ⚠️ **分隔符一定要接受點**：本機產出的檔名是 `DesktopST 0.5.6.exe`（有空白），
 * 但 **GitHub 上傳附件時會把空白換成點**，Release 上真正的名字是
 * `DesktopST.0.5.6.exe`。只認空白的話單檔版永遠配不到附件，畫面會顯示
 * 「這版沒有附單檔 EXE」——而訊息是錯的，Release 明明就有。
 * 2026-09-15 實際發 v0.5.6 上傳完才發現。
 */
export function matchesUpdateAsset(kind: HelperBatOptions['kind'], name: string): boolean {
  const want = kind === 'portable-exe'
    ? /^DesktopST[ ._-]?v?\d+\.\d+\.\d+\.exe$/i
    : /^DesktopST[ ._-]?v?\d+\.\d+\.\d+-full\.zip$/i
  return want.test(name)
}

/**
 * 系統工具一律走絕對路徑。
 *
 * 使用者的 PATH 裡如果有 Git for Windows／GnuWin（很常見），`ping`、`robocopy` 這些
 * 名字會被同名的 unix 工具搶走，語法對不上 → 等待迴圈直接失效，變成「主程式還沒關
 * 就開始覆蓋」。實測踩過：`find` 被 Git 的版本接走，吐 `find: '999999': No such file`。
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

  // 覆蓋那一步。robocopy 的 exit code 小於 8 都算成功（1 ＝有複製、3 ＝有複製且目標有多餘檔案）；
  // /E 不加 /MIR：只覆蓋與新增，不刪除使用者自己放進安裝資料夾的東西。
  const applyLine = o.kind === 'portable-exe'
    ? `move /y "${o.downloadedFile}" "${o.targetPath}" >nul`
    : `${SYS}\\robocopy.exe "${o.stagingDir}" "${o.targetPath}" /E /IS /IT /R:3 /W:2 /NFL /NDL /NJH /NJS >nul`
  const failThreshold = o.kind === 'portable-exe' ? 1 : 8

  const lines: string[] = [
    '@echo off',
    'setlocal',
    'title DesktopST Updater',
    'echo Waiting for DesktopST to exit...',
    // 等到主程式真的放開檔案為止（最多 ~2 分鐘）。
    // 判斷方式是「附加零位元組」——檔案還被舊版鎖著就會失敗。
    'set RETRY=0',
    ':waitlock',
    `2>nul (>>"${lockFile}" type nul) && goto ready`,
    'set /a RETRY+=1',
    'if %RETRY% GEQ 120 goto failwait',
    SLEEP_1S,
    'goto waitlock',

    ':ready',
    'echo Installing update...',
    applyLine,
    `if errorlevel ${failThreshold} goto failapply`,
    'echo Done. Restarting DesktopST...',
    `start "" "${launchExe}"`,
    // 下載檔動輒 400 MB 以上，不刪的話每更新一次就在 %TEMP% 留一份
    // （單檔版的下載檔已經被 move 走了，這行對它是 no-op）
    `del /q "${o.downloadedFile}" 2>nul`,
    `rmdir /s /q "${o.stagingDir}" 2>nul`,
    // 執行中的 .bat 自刪：先跳出腳本再刪，cmd 已讀完這一行所以刪得掉。
    // 這行同時是成功路徑的終點，下面兩個失敗標籤不會被走到。
    '(goto) 2>nul & del "%~f0"',

    ':failwait',
    'echo Timed out waiting for the old version to release the file.',
    `echo Timed out waiting for the old version to release the file. Nothing was changed.> "${o.failLogPath}"`,
    'exit /b 1',

    ':failapply',
    'echo Update failed. The old version was not modified.',
    `echo Failed to install the update into "${o.targetPath}". The old version was not modified.> "${o.failLogPath}"`,
    'exit /b 1'
  ]

  return lines.join('\r\n') + '\r\n'
}
