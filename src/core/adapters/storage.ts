/**
 * 儲存 adapter —— 平台各自實作（Electron: fs／Capacitor: Filesystem plugin）。
 *
 * `core/` 不得認識絕對路徑、`%APPDATA%`、或任何檔案系統概念。
 * 所有位置一律以「平台無關的相對 key」表示，例如：
 *
 *   'settings.json'  'personas/abc.json'  'characters/xyz/avatar.png'
 *
 * key 一律以 `/` 分隔、不以 `/` 開頭、不含 `..`。
 * 由各平台 adapter 自行解析到實際位置（桌面 = 資料夾，手機 = app 沙箱）。
 *
 * 二進位一律用 `Uint8Array`，不用 Node 的 `Buffer`
 * ——`Buffer` 是 `Uint8Array` 的子類別，桌面端可以直接傳，手機端則沒有 `Buffer`。
 */
export interface StorageAdapter {
  readJson<T>(key: string): Promise<T | null>
  writeJson(key: string, value: unknown): Promise<void>

  readBinary(key: string): Promise<Uint8Array | null>
  writeBinary(key: string, data: Uint8Array): Promise<void>

  exists(key: string): Promise<boolean>
  remove(key: string): Promise<void>

  /** 列出某個前綴底下的 key（不遞迴），用於 personas/ worlds/ 這類多檔目錄。 */
  list(prefix: string): Promise<string[]>
}

/**
 * 同步版儲存。
 *
 * 桌面版現行 `fileStore.ts` 全部是同步的（`fs.readFileSync`），
 * 若強制改成非同步，改動會擴散到 `ipcHandlers.ts` 幾乎每一支 handler，
 * 對「桌面版行為完全不變」是不必要的風險。
 *
 * 因此保留同步介面給既有桌面路徑沿用；**新寫的 core 邏輯一律用非同步版**
 * （手機端 Filesystem plugin 只有非同步 API，無法實作這個介面）。
 */
export interface SyncStorageAdapter {
  readJsonSync<T>(key: string): T | null
  writeJsonSync(key: string, value: unknown): void
  existsSync(key: string): boolean
}
