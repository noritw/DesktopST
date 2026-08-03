import type { Lorebook } from './types'

/**
 * 「這一輪該用哪幾本」的解析 —— 兩種掛載機制的匯流點（規格 §4.2／§6.4）。
 *
 * | 來源 | 語意 |
 * |---|---|
 * | 角色卡 `Character.lorebookIds` | **疊加**（比照 `newsKeywords`） |
 * | 世界觀 `WorldPreset.lorebookIds` | **疊加** |
 * | 情境 `ScenePreset.lorebookIds` | **取代**（比照 `newsKeywordGroupId`）；未設＝用上面的疊加結果 |
 *
 * 疊加時**角色卡的排前面**（角色自己的設定優先於世界背景），
 * 這個順序會一路帶到 `selectLoreEntries` 的注入順序。
 *
 * 總開關（`moduleOverrides['desktopst.lorebook']`）不在這裡處理 ——
 * 那是既有的 `applySceneModuleOverrides()` 機制，由平台層在呼叫前決定要不要走這條路。
 */

export interface LorebookSources {
  /** 角色卡掛的（疊加，排前面） */
  characterIds?: string[]
  /** 世界觀掛的（疊加，排後面） */
  worldIds?: string[]
  /** 情境綁定的；**非 undefined 時取代**上面兩者（空陣列＝這個情境一本都不用） */
  sceneIds?: string[]
}

/** 解析出實際要載入的 lorebook id（依注入順序、已去重）。 */
export function resolveLorebookIds(sources: LorebookSources): string[] {
  const pick = sources.sceneIds !== undefined
    ? sources.sceneIds
    : [...(sources.characterIds ?? []), ...(sources.worldIds ?? [])]

  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of pick) {
    const id = (raw ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 依 id 順序取出已載入的 lorebook。
 *
 * **載入失敗的那本不會出現在 `loaded` 裡，這裡就直接跳過** ——
 * 檔案損壞／讀取失敗一律靜默略過該本，聊天流程不中斷（規格 §6.6）。
 */
export function orderLorebooks(ids: string[], loaded: Map<string, Lorebook> | Record<string, Lorebook>): Lorebook[] {
  const get = loaded instanceof Map
    ? (id: string) => loaded.get(id)
    : (id: string) => loaded[id]
  const out: Lorebook[] = []
  for (const id of ids) {
    const book = get(id)
    if (book) out.push(book)
  }
  return out
}
