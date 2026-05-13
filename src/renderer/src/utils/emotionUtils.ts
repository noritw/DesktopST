export interface SpriteEntry {
  imagePath: string
  filename: string
  dimensions: { w: number; h: number } | null
  assignedEmotions: string[]
  customId?: string
}

export const EMOTION_OPTIONS: Array<{ en: string; zh: string }> = [
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
  const row = EMOTION_OPTIONS.find(r => r.en === en)
  return row ? `${row.en}（${row.zh}）` : en
}

export function stemFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
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

/** Returns a map of effectiveId → imagePath for resolving LLM emotion output. */
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
