/**
 * 假的 `electron` 模組，給 Node 下跑的 harness 用（B2.7 設定載入比對）。
 *
 * 只實作 harness 會碰到的兩塊：
 * - `app.getPath()` → 由 `DEST_HARNESS_USERDATA` 環境變數指定的暫存資料夾
 * - `safeStorage` → **可決定性的假加密**（XOR ＋ base64）。真 DPAPI 每次密文都不同，
 *   拿來做逐字比對會永遠有差異；這裡只要「加得回、解得開、前綴一致」即可。
 */

export const app = {
  getPath(_name: string): string {
    return process.env.DEST_HARNESS_USERDATA ?? '.'
  },
  getVersion(): string {
    return '0.0.0-harness'
  },
  on(): void {},
  isPackaged: false
}

const XOR_KEY = 0x5a
/** 魔術前綴：讓「不是本函式加密出來的東西」能像真 DPAPI 一樣拋錯，
 *  否則單純 XOR 對任何位元組都會「解密成功」，測不到解密失敗的保護路徑。 */
const MAGIC = Buffer.from('DESTFAKE', 'utf-8')

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return true
  },
  encryptString(plain: string): Buffer {
    const buf = Buffer.from(plain, 'utf-8')
    return Buffer.concat([MAGIC, Buffer.from(buf.map(b => b ^ XOR_KEY))])
  },
  decryptString(data: Buffer): string {
    if (data.length < MAGIC.length || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('fake safeStorage: not encrypted by this key')
    }
    return Buffer.from(data.subarray(MAGIC.length).map(b => b ^ XOR_KEY)).toString('utf-8')
  }
}

export const ipcMain = { handle(): void {}, on(): void {} }
export const shell = { openPath(): void {}, openExternal(): void {} }
export const BrowserWindow = class { static getAllWindows(): unknown[] { return [] } }
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) }
export const powerMonitor = { on(): void {} }
export const dialog = {}
export const Notification = class {}
export const Tray = class {}
export const Menu = { buildFromTemplate: () => ({}) }
export const screen = { getAllDisplays: () => [], getPrimaryDisplay: () => ({}) }
export const net = {}
export const session = {}
export const protocol = {}
export const clipboard = {}
export const desktopCapturer = {}

export default { app, safeStorage, ipcMain, shell, BrowserWindow }
