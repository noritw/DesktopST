import type { Character } from '../types'
import { buildSpriteIdMap } from './emotionCatalog'

/**
 * 依訊息的 emotion 決定要顯示哪張圖（手機聊天泡泡、小工具共用）。
 * 見 `docs/mobile-character-expression-plan.md` §4。
 */
export interface DisplayImageResult {
  /** 要讀的圖片相對路徑（或平台路徑）：`character.avatar` 或 `emotions[key]` 其中一個。 */
  path: string
  /** 有沒有找到對應這個 emotion 的專屬圖片（false＝退回主圖）。 */
  matchedEmotion: boolean
}

/**
 * ⚠️ **這裡查 `spriteIds` 是必要的，不是 bug**（跟「統計有幾張表情圖」那個
 * 場景不一樣，那邊才不該混進 `spriteIds`，見 `CharacterEditor.tsx` 的說明）。
 *
 * 原因：`core/prompt/promptUtils.ts` 的 `buildEmotionContract()` 送給模型的
 * 情緒 id **不是** `EMOTION_OPTIONS` 的 28 個 canonical key 本身，而是
 * `spriteIds[imagePath]`（自訂 id）或缺省時的**檔名主幹**——這是為了讓一張
 * 圖能同時涵蓋好幾個情緒 key 時只需要一個 id。模型回傳的 `message.emotion`
 * 因此常常是這個衍生 id，不是 canonical key。這裡如果只查
 * `character.emotions[emotion]`，正常情況（角色卡有任何表情圖）下**永遠對不到**，
 * 顯示會一直退回主圖——2026-08-23 owner 實機回報「AI 選的表情看起來像檔名，
 * 頭像卻都是預設圖」正是這裡當初漏接 `buildSpriteIdMap()` 這一步。
 * 兩邊算 id 的規則**必須對稱**，所以都共用同一支 `buildSpriteIdMap()`。
 */
/**
 * `emotionOverride` 的哨符：**明確指定「不要用表情圖，就顯示主圖」**。
 *
 * 跟 `emotionOverride` 不存在（＝跟隨 AI 判斷）是**不同的意思**，所以需要
 * 第三個狀態而不是清成 null：清成 null 只是把選擇權交回 AI，AI 下次判斷出
 * 什麼表情就顯示什麼；使用者要的是「這則就是給我顯示主圖」。
 * owner 2026-08-23 實機回報「換表情之後換不回去了」正是缺這個選項——
 * 選單上只有「跟隨 AI 判斷」，而 AI 判定的表情本來就不是主圖。
 *
 * 用一個不可能跟真實情緒 key／自訂 sprite id 撞名的字串當哨符，
 * 存進 `message.emotionOverride` 就跟一般的表情 key 走同一條儲存路徑
 * （桌面／手機的 `setEmotionOverride` 都不驗證值，見兩邊的實作）。
 */
export const DEFAULT_IMAGE_EMOTION = '__default__'

export function resolveDisplayImagePath(
  character: Pick<Character, 'avatar' | 'emotions' | 'spriteIds'>,
  emotion: string | undefined
): DisplayImageResult {
  const em = emotion?.trim()
  if (!em) return { path: character.avatar, matchedEmotion: false }
  // 明確要求主圖：不要往下查 emotions／spriteIds（就算真的有同名的也不理）
  if (em === DEFAULT_IMAGE_EMOTION) return { path: character.avatar, matchedEmotion: false }

  const emotions = character.emotions ?? {}
  const direct = emotions[em]
  if (direct?.trim()) return { path: direct.trim(), matchedEmotion: true }

  const byId = buildSpriteIdMap(emotions, character.spriteIds).get(em)
  return byId ? { path: byId, matchedEmotion: true } : { path: character.avatar, matchedEmotion: false }
}

/**
 * 框選的臉部矩形，比例座標（0–1），套用到這個角色的主圖與所有表情圖。
 * mobile-only 裝置偏好（`character-display-config.json`），不進 `Character` 型別本身
 * ——見 §3.1「為什麼是 mobile-only」。
 */
export interface FaceCropRect {
  x: number
  y: number
  size: number
}

export type CharacterDisplayConfigMap = Record<string, { faceCrop?: FaceCropRect }>
