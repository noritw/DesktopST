import * as keys from '@core/store/keys'
import type { CharacterDisplayConfigMap, FaceCropRect } from '@core/character/displayImage'
import { capacitorAdapters } from '../adapters'

export { cropImageToFace } from '../../shared/faceCrop'

/**
 * 框選的臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1，
 * 2026-08-25 起雙端同步，見該節附註與 `docs/reminder-sync-kickoff.md` 同一類
 * 落地模式）。
 *
 * ⚠️ **手機這一份讀寫仍然是裝置本地檔案**，不管手機當下連的是哪一種模式，
 * 都讀寫同一份 `character-display-config.json`（`capacitorAdapters.storage`，
 * 跟 `MODE_PREF_KEY` 同一類）。`LocalDataSource` 與 `RemoteDataSource` 都呼叫
 * 這裡的函式，不要各自維護一份邏輯。**要讓桌面也看到這份設定得靠 S2
 * `characterDisplay` 同步種類**（`core/sync/`），不是這支檔案自己連電腦。
 */
export async function getFaceCrop(characterId: string): Promise<FaceCropRect | null> {
  const map = (await capacitorAdapters.storage.readJson<CharacterDisplayConfigMap>(keys.CHARACTER_DISPLAY_CONFIG_KEY)) ?? {}
  return map[characterId]?.faceCrop ?? null
}

/**
 * `rect` 是 `null` 時**不會整筆刪掉這個角色的紀錄**，而是保留
 * `{ updatedAt }`（`faceCrop` 消失）——這樣「已清除」本身也是能被同步比對
 * 出來的狀態，不會在跟電腦比對時被誤判成「本地沒有、電腦端還留著舊框選」
 * 而把舊框選拉回來。
 */
export async function setFaceCrop(characterId: string, rect: FaceCropRect | null): Promise<void> {
  const map = { ...((await capacitorAdapters.storage.readJson<CharacterDisplayConfigMap>(keys.CHARACTER_DISPLAY_CONFIG_KEY)) ?? {}) }
  map[characterId] = { faceCrop: rect ?? undefined, updatedAt: Date.now() }
  await capacitorAdapters.storage.writeJson(keys.CHARACTER_DISPLAY_CONFIG_KEY, map)
}
