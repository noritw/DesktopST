/**
 * 28 個固定情緒 key（`en`／`zh` 對照），角色卡 `emotions`／`spriteIds` 用的目錄。
 *
 * ⚠️ **只能有一份。** 原本只在桌面 `renderer/src/utils/emotionUtils.ts`，
 * 手機端新增/指定表情圖片（`docs/mobile-character-expression-plan.md` §3.3）
 * 需要同一份清單——兩邊字面只要有一個字打錯，使用者在手機挑的情緒名稱就會跟
 * 桌面看到的名稱兜不起來。`emotionUtils.ts` 改成從這裡 re-export。
 */
export interface EmotionOption {
  en: string
  zh: string
}

export const EMOTION_OPTIONS: EmotionOption[] = [
  { en: 'admiration', zh: '欽佩' },
  { en: 'amusement', zh: '愉悅' },
  { en: 'anger', zh: '憤怒' },
  { en: 'annoyance', zh: '煩躁' },
  { en: 'approval', zh: '認同' },
  { en: 'caring', zh: '關懷' },
  { en: 'confusion', zh: '困惑' },
  { en: 'curiosity', zh: '好奇' },
  { en: 'desire', zh: '渴望' },
  { en: 'disappointment', zh: '失望' },
  { en: 'disapproval', zh: '不認同' },
  { en: 'disgust', zh: '厭惡' },
  { en: 'embarrassment', zh: '尷尬' },
  { en: 'excitement', zh: '興奮' },
  { en: 'fear', zh: '恐懼' },
  { en: 'gratitude', zh: '感激' },
  { en: 'grief', zh: '悲痛' },
  { en: 'joy', zh: '喜悅' },
  { en: 'love', zh: '愛意' },
  { en: 'nervousness', zh: '緊張' },
  { en: 'optimism', zh: '樂觀' },
  { en: 'pride', zh: '自豪' },
  { en: 'realization', zh: '恍然大悟' },
  { en: 'relief', zh: '如釋重負' },
  { en: 'remorse', zh: '懊悔' },
  { en: 'sadness', zh: '悲傷' },
  { en: 'surprise', zh: '驚訝' },
  { en: 'neutral', zh: '預設' }
]

export function emotionLabel(en: string): string {
  const row = EMOTION_OPTIONS.find((r) => r.en === en)
  return row ? `${row.en}（${row.zh}）` : en
}

/** 去掉副檔名，例如 `joy-172xxxx.png` → `joy-172xxxx`。 */
export function stemFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

/**
 * 依 `character.emotions`／`spriteIds` 建出「LLM 看到的情緒 id → 圖片路徑」對照表。
 *
 * ⚠️ **這支要跟 `core/prompt/promptUtils.ts` 的 `buildEmotionContract()` 完全對稱**
 * ——後者決定「送給模型的合約裡，這張圖該叫什麼 id」（`spriteIds[imagePath]` 沒填
 * 就退回檔名主幹），這支則是收到模型回傳的 id 之後反查回哪張圖。兩邊算 id 的規則
 * 只要有一絲不一致，模型回的 tag 就會找不到對應的圖，顯示永遠退回主圖——
 * 2026-08-23 owner 實機回報「AI 選的表情沒反映在頭像上，看起來像檔名」正是
 * 這裡（`resolveDisplayImagePath()`）當初漏接這個對照，只查了 canonical 的
 * 28 個情緒 key，查不到自訂 id／檔名主幹這一類 tag。
 */
export function buildSpriteIdMap(
  emotions: Record<string, string>,
  spriteIds?: Record<string, string>
): Map<string, string> {
  const map = new Map<string, string>()
  const pathToEmotions = new Map<string, string[]>()
  for (const [emo, p] of Object.entries(emotions)) {
    if (!p?.trim()) continue
    const list = pathToEmotions.get(p) ?? []
    list.push(emo)
    pathToEmotions.set(p, list)
  }
  for (const [imagePath] of pathToEmotions) {
    const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
    const id = spriteIds?.[imagePath]?.trim() || stemFromFilename(filename)
    map.set(id, imagePath)
  }
  return map
}
