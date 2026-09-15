import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { getDataDir } from './dataDir'
import { buildHelperBatScript, matchesUpdateAsset } from './updaterScript'

/**
 * 一鍵更新（手動觸發，不自動下載）。
 *
 * 為什麼不用 electron-updater：它只支援 nsis／dmg／AppImage，**不支援 `portable` target**，
 * 而 electron-builder.yml 用的就是 portable（免安裝是這個專案的定位，不打算改成安裝版）。
 * 所以這支自己做：抓 GitHub Release 的附件 → 下載 → 驗證 → 寫一支 helper .bat →
 * 結束自己 → .bat 覆蓋安裝目錄 → 重新啟動。
 *
 * 使用者資料在 `%APPDATA%\DesktopST\`（見 dataDir.ts），覆蓋安裝目錄不會碰到——
 * 但資料夾位置可以被使用者改（`setDataDir`），所以 `buildUpdatePlan()` 會擋掉
 * 「資料夾就在安裝目錄底下」這種情況，不然覆蓋等於拿使用者資料去冒險。
 */

export const GITHUB_OWNER = 'noritw'
export const GITHUB_REPO = 'DesktopST'
export const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
export const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

/** 將 "0.1.23" 拆成數字陣列，供版本比較用 */
function parseVersionParts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
}

/**
 * 比較遠端 latest 與本機 current（SemVer 語意：主.次.修）。
 * 回傳值 > 0 表示 latest 較新；0 相同；< 0 表示本機較新。
 *
 * 常數與這支從 `updateChecker.ts` 搬過來，是為了讓 import 只有一個方向
 * （updateChecker → updater）；兩邊互相 import 在打包後容易變成初始化順序問題。
 */
export function compareVersion(latest: string, current: string): number {
  const a = parseVersionParts(latest)
  const b = parseVersionParts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai !== bi) return ai - bi
  }
  return 0
}

export type InstallKind = 'portable-exe' | 'unpacked-dir' | 'dev'

export interface UpdatePlan {
  ok: boolean
  /** ok=false 時給使用者看的理由 */
  reason?: string
  kind: InstallKind
  currentVersion: string
  latestVersion: string
  /** Release 附件檔名；ok=false 時為空字串 */
  assetName: string
  assetUrl: string
  assetSize: number
  /** 免安裝版＝安裝資料夾；單檔版＝那個 exe 的完整路徑 */
  targetPath: string
  releaseNotes: string
}

export interface UpdateProgress {
  phase: 'download' | 'extract' | 'verify' | 'apply' | 'done' | 'error'
  /** 0–1，下載階段才有意義 */
  ratio: number
  receivedBytes: number
  totalBytes: number
  message: string
}

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  body?: string
  assets?: GithubAsset[]
}

/**
 * 判斷這份程式是怎麼被裝起來的。
 *
 * `PORTABLE_EXECUTABLE_FILE` 是 electron-builder 的 portable target 在啟動時注入的，
 * 值＝使用者實際點下去的那個 exe（程式本體是解壓縮到 %TEMP% 執行的，所以
 * `app.getPath('exe')` 在這個情況下指向暫存目錄，不能拿來當更新目標）。
 */
export function detectInstallKind(): InstallKind {
  if (!app.isPackaged) return 'dev'
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable-exe'
  return 'unpacked-dir'
}

/** 免安裝版的安裝資料夾（單檔版沒有這個概念，回傳該 exe 所在資料夾僅供顯示） */
function getInstallDir(): string {
  const portable = process.env.PORTABLE_EXECUTABLE_FILE
  if (portable) return path.dirname(portable)
  return path.dirname(app.getPath('exe'))
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const res = await fetch(API_URL, {
    headers: { 'User-Agent': `DesktopST/${app.getVersion()}` },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json() as GithubRelease
}

/** 免安裝版要 `DesktopST-v0.5.6-full.zip`；單檔版要 `DesktopST 0.5.6.exe`（GitHub 上會變成點，見 updaterScript.ts） */
function pickAsset(kind: 'portable-exe' | 'unpacked-dir', assets: GithubAsset[]): GithubAsset | null {
  return assets.find(a => matchesUpdateAsset(kind, a.name)) ?? null
}

/**
 * 檢查能不能一鍵更新，並算出要下載哪個附件。
 * 任何一關沒過都回 `ok:false` ＋ 人看得懂的理由，畫面直接顯示，不要自己硬上。
 */
export async function buildUpdatePlan(): Promise<UpdatePlan> {
  const kind = detectInstallKind()
  const currentVersion = app.getVersion()
  const installDir = getInstallDir()
  const targetPath = kind === 'portable-exe'
    ? (process.env.PORTABLE_EXECUTABLE_FILE as string)
    : installDir
  const base: UpdatePlan = {
    ok: false, kind, currentVersion, latestVersion: '',
    assetName: '', assetUrl: '', assetSize: 0, targetPath, releaseNotes: ''
  }

  if (kind === 'dev') {
    return { ...base, reason: '開發模式（npm run dev）不支援一鍵更新，請用 git 更新原始碼。' }
  }

  // 安裝目錄長得像原始碼資料夾就整個不做——這正是「解壓縮蓋到工作資料夾」那類意外的翻版，
  // 只是這次是程式自己要去覆蓋，錯了更難救。
  if (fs.existsSync(path.join(installDir, '.git')) || fs.existsSync(path.join(installDir, 'package.json'))) {
    return {
      ...base,
      reason: `安裝目錄看起來是原始碼資料夾（${installDir}），為避免覆蓋你的專案檔案，已停止更新。`
    }
  }

  // 使用者把資料夾指到安裝目錄底下時，覆蓋會蓋到自己的角色與對話，擋掉。
  if (kind === 'unpacked-dir' && isInside(getDataDir(), installDir)) {
    return {
      ...base,
      reason: `你的資料資料夾在安裝目錄底下（${getDataDir()}），一鍵更新會覆蓋安裝目錄。請先到「設定 → 資料」把資料夾搬到別處再更新。`
    }
  }

  let release: GithubRelease
  try {
    release = await fetchLatestRelease()
  } catch (e) {
    return { ...base, reason: `無法連線到 GitHub：${e instanceof Error ? e.message : String(e)}` }
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '')
  const releaseNotes = release.body?.trim() || ''
  if (!latestVersion) return { ...base, reason: 'GitHub 回傳的版本資訊不完整。' }
  if (compareVersion(latestVersion, currentVersion) <= 0) {
    return { ...base, latestVersion, releaseNotes, reason: `已是最新版本（v${currentVersion}）。` }
  }

  const asset = pickAsset(kind === 'portable-exe' ? 'portable-exe' : 'unpacked-dir', release.assets ?? [])
  if (!asset) {
    return {
      ...base,
      latestVersion,
      releaseNotes,
      reason: kind === 'portable-exe'
        ? `v${latestVersion} 沒有附單檔 EXE，請到 Release 頁手動下載。`
        : `v${latestVersion} 沒有附免安裝版 zip，請到 Release 頁手動下載。`
    }
  }

  return {
    ok: true,
    kind,
    currentVersion,
    latestVersion,
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    assetSize: asset.size,
    targetPath,
    releaseNotes
  }
}

function emit(win: BrowserWindow | null, p: UpdateProgress): void {
  if (win && !win.isDestroyed()) win.webContents.send('updates:progress', p)
}

/** 下載附件到暫存檔，邊下邊回報進度 */
async function download(
  url: string,
  destFile: string,
  expectedSize: number,
  win: BrowserWindow | null,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': `DesktopST/${app.getVersion()}` },
    redirect: 'follow',
    signal
  })
  if (!res.ok || !res.body) throw new Error(`下載失敗：HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length')) || expectedSize || 0
  const out = fs.createWriteStream(destFile)
  let received = 0
  let lastEmit = 0

  try {
    // @ts-expect-error Node 18+ 的 ReadableStream 支援 async iteration，TS lib 尚未涵蓋
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk as Uint8Array)
      received += buf.length
      if (!out.write(buf)) await new Promise(r => out.once('drain', r))
      const now = Date.now()
      if (now - lastEmit > 200) {
        lastEmit = now
        emit(win, {
          phase: 'download',
          ratio: total > 0 ? received / total : 0,
          receivedBytes: received,
          totalBytes: total,
          message: '下載中'
        })
      }
    }
  } finally {
    await new Promise<void>(r => out.end(r))
  }

  if (total > 0 && received !== total) {
    throw new Error(`下載不完整（${received} / ${total} bytes），可能是中途斷線。`)
  }
}

/** 用 PowerShell 的 .NET API 解壓縮；比 Expand-Archive 快，也不受 PS 版本影響 */
function extractZip(zipPath: string, destDir: string): Promise<void> {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}','${destDir.replace(/'/g, "''")}')`
  ].join(' ')
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`解壓縮失敗（exit ${code}）：${stderr.slice(0, 300)}`))
    })
  })
}

let updating = false
let currentAbort: AbortController | null = null

/**
 * 取消進行中的更新（使用者關掉視窗或按取消）。
 *
 * 有這個才不會出現「下載卡住 → 視窗關掉 → 使用者以為沒事 → 十分鐘後程式自己關掉重開」
 * 這種嚇人的行為：中止後 `runUpdate` 會走 catch，helper .bat 根本不會被產生。
 */
export function cancelUpdate(): void {
  currentAbort?.abort(new Error('使用者取消更新'))
}

/**
 * 執行更新：下載 →（zip 版）解壓縮 → 驗證 → 交棒給 helper .bat → 結束自己。
 * 成功時本函式不會回傳（程式會關掉）。
 */
export async function runUpdate(win: BrowserWindow | null): Promise<{ ok: boolean; error?: string }> {
  if (updating) return { ok: false, error: '更新已在進行中。' }
  updating = true

  const workDir = path.join(app.getPath('temp'), `DesktopST-update-${Date.now()}`)
  const abort = new AbortController()
  currentAbort = abort
  try {
    const plan = await buildUpdatePlan()
    if (!plan.ok) throw new Error(plan.reason || '無法更新')
    // `ok:true` 時不可能是 dev（buildUpdatePlan 第一關就擋掉），這行是給型別看的
    if (plan.kind === 'dev') throw new Error('開發模式不支援一鍵更新。')

    fs.mkdirSync(workDir, { recursive: true })
    const downloadedFile = path.join(workDir, plan.assetName)

    emit(win, { phase: 'download', ratio: 0, receivedBytes: 0, totalBytes: plan.assetSize, message: '下載中' })
    await download(plan.assetUrl, downloadedFile, plan.assetSize, win, abort.signal)

    if (abort.signal.aborted) throw new Error('已取消更新')

    let stagingDir = workDir
    if (plan.kind === 'unpacked-dir') {
      emit(win, { phase: 'extract', ratio: 1, receivedBytes: plan.assetSize, totalBytes: plan.assetSize, message: '解壓縮中' })
      stagingDir = path.join(workDir, 'staged')
      await extractZip(downloadedFile, stagingDir)

      // 驗證：解出來要真的有主程式，否則就是下載壞了／附件內容不對，這時還沒動到安裝目錄
      emit(win, { phase: 'verify', ratio: 1, receivedBytes: plan.assetSize, totalBytes: plan.assetSize, message: '驗證檔案' })
      if (!fs.existsSync(path.join(stagingDir, 'DesktopST.exe'))) {
        throw new Error('下載的壓縮檔裡找不到 DesktopST.exe，已中止（安裝目錄未被修改）。')
      }
    } else {
      emit(win, { phase: 'verify', ratio: 1, receivedBytes: plan.assetSize, totalBytes: plan.assetSize, message: '驗證檔案' })
      const size = fs.statSync(downloadedFile).size
      if (plan.assetSize > 0 && size !== plan.assetSize) {
        throw new Error('下載的檔案大小與 Release 記載不符，已中止（原程式未被修改）。')
      }
    }

    const batPath = path.join(workDir, 'apply-update.bat')
    fs.writeFileSync(batPath, buildHelperBatScript({
      kind: plan.kind,
      stagingDir,
      downloadedFile,
      targetPath: plan.targetPath,
      // 更新失敗時程式已經關了，沒有畫面能回報；留一份 log 在暫存區供事後追查
      failLogPath: path.join(app.getPath('temp'), 'DesktopST-update-failed.log')
    }), 'ascii')

    if (abort.signal.aborted) throw new Error('已取消更新')

    emit(win, { phase: 'apply', ratio: 1, receivedBytes: plan.assetSize, totalBytes: plan.assetSize, message: '即將關閉並安裝新版' })

    // detached ＋ 不接管 stdio：主程式關掉後 .bat 仍會活著把事情做完
    const child = spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    child.unref()

    setTimeout(() => { app.exit(0) }, 800)
    return { ok: true }
  } catch (e) {
    updating = false
    currentAbort = null
    const error = e instanceof Error ? e.message : String(e)
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* 清不掉就算了，反正在 %TEMP% */ }
    emit(win, { phase: 'error', ratio: 0, receivedBytes: 0, totalBytes: 0, message: error })
    return { ok: false, error }
  }
}
