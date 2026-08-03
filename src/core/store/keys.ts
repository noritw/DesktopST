/**
 * 儲存位置的單一真相（B2.7）。
 *
 * 這裡定義的是 `StorageAdapter` 用的**平台無關相對 key**
 * （以 `/` 分隔、不以 `/` 開頭、不含 `..`；見 `core/adapters/storage.ts`）。
 * 桌面解析到資料夾、手機解析到 app 沙箱，但**檔案佈局兩邊必須一致**——
 * 否則同一份資料在兩個平台叫不同名字，同步與搬家包都會對不起來。
 *
 * core 不認識絕對路徑，這裡也不得出現 `%APPDATA%` 或任何路徑分隔符判斷。
 */

export const SETTINGS_KEY = 'settings.json'
export const PINNED_NOTES_KEY = 'pinned-notes.json'
export const REMINDERS_KEY = 'reminders.json'

export const MODULES_DIR = 'modules'
export const CHARACTERS_DIR = 'characters'
export const CONVERSATIONS_DIR = 'conversations'
export const PERSONAS_DIR = 'personas'
export const WORLDS_DIR = 'worlds'
export const SCENES_DIR = 'scenes'
export const LOREBOOKS_DIR = 'lorebooks'

/** 啟動時需要先確保存在的目錄（相對 key，不含資料根目錄本身）。 */
export const DATA_SUBDIRS = [
  MODULES_DIR,
  CHARACTERS_DIR,
  CONVERSATIONS_DIR,
  PERSONAS_DIR,
  WORLDS_DIR,
  SCENES_DIR,
  LOREBOOKS_DIR
] as const

export const personaKey = (id: string): string => `${PERSONAS_DIR}/${id}.json`
export const worldKey = (id: string): string => `${WORLDS_DIR}/${id}.json`
export const sceneKey = (id: string): string => `${SCENES_DIR}/${id}.json`
export const conversationKey = (id: string): string => `${CONVERSATIONS_DIR}/${id}.json`
export const lorebookKey = (id: string): string => `${LOREBOOKS_DIR}/${id}.json`

/** 角色是一個資料夾（卡片 ＋ 圖片），卡片本體固定叫 card.json。 */
export const characterDirKey = (id: string): string => `${CHARACTERS_DIR}/${id}`
export const characterCardKey = (id: string): string => `${CHARACTERS_DIR}/${id}/card.json`

/** 從 `xxx.json` 檔名取出 id；非 .json 回傳 null。 */
export function idFromJsonName(name: string): string | null {
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : null
}
