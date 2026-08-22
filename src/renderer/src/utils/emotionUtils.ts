/**
 * `EMOTION_OPTIONS`／`emotionLabel`／`stemFromFilename`／`buildSpriteIdMap`
 * 已搬到 `core/character/emotionCatalog.ts` 供桌面與手機共用
 * （`docs/mobile-character-expression-plan.md` §3.3／§9 落地筆記）——
 * 這裡只 re-export，不要再維護自己的複本，否則 LLM 合約用的 id 算法
 * （`core/prompt/promptUtils.ts` 的 `buildEmotionContract()`）跟這裡反查
 * 圖片路徑的算法會漂移，症狀是「AI 選的表情永遠對不到圖」。
 */
export { EMOTION_OPTIONS, emotionLabel, stemFromFilename, buildSpriteIdMap } from '@core/character/emotionCatalog'

export interface SpriteEntry {
  imagePath: string
  filename: string
  dimensions: { w: number; h: number } | null
  assignedEmotions: string[]
  customId?: string
}

export function buildSpriteEntries(
  emotions: Record<string, string>,
  spriteIds?: Record<string, string>
): SpriteEntry[] {
  const pathToEmotions = new Map<string, string[]>()
  for (const [emo, p] of Object.entries(emotions)) {
    if (!p?.trim()) continue
    const list = pathToEmotions.get(p) ?? []
    list.push(emo)
    pathToEmotions.set(p, list)
  }
  const entries: SpriteEntry[] = []
  for (const [imagePath, assignedEmotions] of pathToEmotions) {
    const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
    entries.push({
      imagePath,
      filename,
      dimensions: null,
      assignedEmotions,
      customId: spriteIds?.[imagePath] ?? undefined
    })
  }
  return entries
}

export function updateEmotionAssignment(
  emotions: Record<string, string>,
  imagePath: string,
  selectedEmotions: string[]
): Record<string, string> {
  const next = { ...emotions }
  for (const key of Object.keys(next)) {
    if (next[key] === imagePath) delete next[key]
  }
  for (const em of selectedEmotions) {
    next[em] = imagePath
  }
  return next
}

export function removeEmotionSprite(emotions: Record<string, string>, imagePath: string): Record<string, string> {
  const next = { ...emotions }
  for (const key of Object.keys(next)) {
    if (next[key] === imagePath) delete next[key]
  }
  return next
}
