import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

/**
 * 資料根目錄的單一真相（B3 階段 0）。
 *
 * 原本這份狀態住在 `fileStore.ts`，於是 `storageAdapter` 得反過來 import `fileStore`
 * ——方向錯了，而且逼得 `fileStore` 只能繞路 import `adapters/` 底下的實作檔以避開循環。
 * 抽成獨立模組後方向變成：
 *
 *   fileStore ─→ adapters/storageAdapter ─→ dataDir
 *
 * 這支是**桌面平台專屬**的（`%APPDATA%`、資料夾搬遷都是桌面概念），
 * 不會有手機版對應物：手機端的 `StorageAdapter` 直接解析到 app 沙箱，沒有根目錄可換。
 */

const DEFAULT_DATA_DIR = path.join(app.getPath('userData'), 'DesktopST')
const STORAGE_META_FILE = path.join(app.getPath('userData'), 'DesktopST-storage.json')

type DataDirMeta = { dataDir?: string }

function loadDataDirFromMeta(): string {
  if (!fs.existsSync(STORAGE_META_FILE)) return DEFAULT_DATA_DIR
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_META_FILE, 'utf-8')) as DataDirMeta
    const configured = typeof raw?.dataDir === 'string' ? raw.dataDir.trim() : ''
    return configured ? path.resolve(configured) : DEFAULT_DATA_DIR
  } catch {
    return DEFAULT_DATA_DIR
  }
}

let DATA_DIR = loadDataDirFromMeta()

export function getDataDir(): string {
  return DATA_DIR
}

export function getDefaultDataDir(): string {
  return DEFAULT_DATA_DIR
}

/**
 * 切換資料根目錄（只改記憶體中的值，不搬檔案、不寫 meta）。
 * 實際的搬遷流程在 `fileStore.relocateDataDir`。
 */
export function setDataDir(nextDir: string): string {
  DATA_DIR = path.resolve(nextDir)
  return DATA_DIR
}

export function saveDataDirMeta(targetDir: string): void {
  try {
    fs.writeFileSync(
      STORAGE_META_FILE,
      JSON.stringify({ dataDir: path.resolve(targetDir) } satisfies DataDirMeta, null, 2),
      'utf-8'
    )
  } catch (e) {
    console.error('[dataDir] saveDataDirMeta failed:', e)
  }
}
