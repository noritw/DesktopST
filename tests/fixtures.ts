import type { AppSettings, Character, Message, PersonaPreset, WorldPreset } from '@core/types'

/**
 * 測試用的固定資料。
 *
 * 刻意與 `scripts/prompt-equivalence-harness.ts` 用同一組角色／Persona／訊息 ——
 * 那份 harness 已經驗過「重構前後 48 情境逐字相同」，沿用同一組資料，
 * 兩邊的結果才能互相對照。
 *
 * ⚠️ **不得依賴當下時間或亂數**：時間一律從 `T0` 推算，
 * 需要亂數的測試自己注入或固定 `Math.random`。
 */

/** 固定基準時間：2025-08-03 12:26:40 UTC */
export const T0 = 1_754_200_000_000

export function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    llm: {
      provider: 'openai',
      apiKey: 'test-key',
      apiKeys: { openai: 'k-openai', claude: 'k-claude', gemini: 'k-gemini', grok: 'k-grok' },
      model: 'test-model',
      models: { openai: 'gpt-test', claude: 'claude-test', gemini: 'gemini-test', grok: 'grok-test' },
      temperature: 0.8,
      maxResponseTokens: 300,
      maxImagesPerMessage: 3
    },
    injectSystemTime: true,
    memory: { keepRecentN: 20, autoSummarizeAfter: 50, autoSummarizeEnabled: true, keepDebugPromptN: 5 },
    ui: {},
    ...over
  } as unknown as AppSettings
}

export const CHAR: Character = {
  id: 'char-1',
  name: '小綠',
  personality: '個性直率、講話帶點嗆，但其實很關心人。喜歡植物。',
  emotions: { neutral: '', happy: '', sad: '' }
} as unknown as Character

export const CHAR2: Character = {
  id: 'char-2',
  name: '小藍',
  personality: '溫吞、慢熱。',
  emotions: {}
} as unknown as Character

export const PERSONA: PersonaPreset = {
  id: 'p-1',
  name: 'Nori',
  description: '一個獨立開發者，正在做桌面寵物程式。'
} as unknown as PersonaPreset

export const WORLD: WorldPreset = {
  id: 'w-1',
  name: '日常',
  description: '現代台灣，普通的日常生活。'
} as unknown as WorldPreset

/** 1×1 透明 PNG，用來驗圖片路徑而不必真的讀檔 */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * 標準對話。m2→m3 之間刻意隔超過一小時，用來觸發時間斷層標註；
 * m4 帶 reaction，用來觸發 reaction 展開。
 */
export function baseMessages(): Message[] {
  return [
    { id: 'm1', role: 'user', content: '早安', timestamp: T0 - 7_200_000 },
    { id: 'm2', role: 'character', characterId: 'char-1', content: '早，你昨天不是說要早睡？', timestamp: T0 - 7_100_000 },
    { id: 'm3', role: 'user', content: '結果又熬夜了', timestamp: T0 - 600_000 },
    { id: 'm4', role: 'character', characterId: 'char-1', content: '不意外。', timestamp: T0 - 500_000, reaction: '😂' },
    { id: 'm5', role: 'user', content: '你看這張圖', images: [TINY_PNG], timestamp: T0 - 60_000 }
  ] as unknown as Message[]
}

/**
 * 固定亂數：xorshift32。
 *
 * 兩次用同一個 seed 就會得到同一串數列 → 有亂數參與的邏輯也能有標準答案。
 * 用完記得還原（vitest 設定開了 `restoreMocks`，用 `vi.spyOn` 會自動還原）。
 */
export function makeSeededRandom(seed: number): () => number {
  let s = seed >>> 0
  return (): number => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
