/**
 * Prompt 全等比對工具（B1／B2 重構驗證用）。
 *
 * 做什麼：用**假的 fetch 攔截 SDK 實際組好的 HTTP 請求**，把要送給 LLM 的
 * 完整內容 dump 成 JSON。在重構前（`main`）與重構後（`feat/mobile-standalone`）
 * 各跑一次，逐字比對 —— 若兩邊一模一樣，就證明「送給模型的東西完全沒變」。
 *
 * 為什麼不直接比對函式輸出：真正會影響角色的是**最終送出的請求本體**，
 * 不是中間某個函式的回傳值。攔 fetch 抓到的是真正的那串位元組。
 *
 * 不需要 API Key、不連網、不花錢。
 *
 * 用法（兩個工作區各跑一次）：
 *   npx esbuild scripts/prompt-equivalence-harness.ts --bundle --platform=node \
 *     --format=cjs --outfile=<out>.cjs && node <out>.cjs > <out>.json
 *
 * ⚠️ 本檔刻意只 import `src/main/llm`，因為重構前後**該路徑的對外簽名相同**，
 *    同一份 harness 才能在兩個版本上跑。
 */
import { state as intercept } from './_fetchIntercept'   // ⚠️ 必須第一個 import，理由見該檔
import { chatWithLLM } from '../src/main/llm'
import type { AppSettings, Character, Message, PersonaPreset, WorldPreset } from '../src/main/types'

// ── 固定測試資料（全部寫死，不得依賴當下時間 / 亂數）──────────

const T0 = 1_754_200_000_000 // 固定基準時間

function makeSettings(provider: string, over: Partial<AppSettings> = {}): AppSettings {
  return {
    llm: {
      provider,
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

const CHAR: Character = {
  id: 'char-1',
  name: '小綠',
  personality: '個性直率、講話帶點嗆，但其實很關心人。喜歡植物。',
  emotions: { neutral: '', happy: '', sad: '' }
} as unknown as Character

const CHAR2: Character = { id: 'char-2', name: '小藍', personality: '溫吞、慢熱。', emotions: {} } as unknown as Character

const PERSONA: PersonaPreset = {
  id: 'p-1', name: 'Nori', description: '一個獨立開發者，正在做桌面寵物程式。'
} as unknown as PersonaPreset

const WORLD: WorldPreset = {
  id: 'w-1', name: '日常', description: '現代台灣，普通的日常生活。'
} as unknown as WorldPreset

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function baseMessages(): Message[] {
  return [
    { id: 'm1', role: 'user', content: '早安', timestamp: T0 - 7_200_000 },
    { id: 'm2', role: 'character', characterId: 'char-1', content: '早，你昨天不是說要早睡？', timestamp: T0 - 7_100_000 },
    // 間隔超過一小時 → 應觸發時間斷層標註
    { id: 'm3', role: 'user', content: '結果又熬夜了', timestamp: T0 - 600_000 },
    { id: 'm4', role: 'character', characterId: 'char-1', content: '不意外。', timestamp: T0 - 500_000, reaction: '😂' },
    { id: 'm5', role: 'user', content: '你看這張圖', images: [TINY_PNG], timestamp: T0 - 60_000 }
  ] as unknown as Message[]
}

// ── 情境清單 ────────────────────────────────────────────────

interface Scenario { name: string; params: any }

function scenarios(provider: string): Scenario[] {
  const s = makeSettings(provider)
  return [
    {
      name: '01-一般聊天',
      params: { settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'] }
    },
    {
      name: '02-附帶新圖片',
      params: { settings: s, character: CHAR, messages: baseMessages(), images: [TINY_PNG], persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'] }
    },
    {
      name: '03-群組多角色',
      params: {
        settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD,
        desktopCharacterNames: ['小綠', '小藍'],
        speakerNameById: { 'char-1': '小綠', 'char-2': '小藍' }
      }
    },
    {
      name: '04-說點什麼（新聞 directive）',
      params: {
        settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD,
        desktopCharacterNames: ['小綠'],
        extraSystemContext: '[A piece of news you just came across]\nTitle: 測試新聞標題\nSource: 測試來源',
        triggerDirective: 'Bring up this news on your own this time: "測試新聞標題"'
      }
    },
    {
      name: '05-有記憶摘要',
      params: {
        settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD,
        desktopCharacterNames: ['小綠'],
        memorySummary: '使用者在做一個桌面寵物程式。\n答應過要早睡，但常熬夜。'
      }
    },
    {
      name: '06-提醒（isReminder，無 trigger）',
      params: {
        settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD,
        desktopCharacterNames: ['小綠'], isReminder: true,
        extraSystemContext: '[Reminder] 該喝水了'
      }
    },
    {
      name: '07-關閉時間注入（TRPG）',
      params: {
        settings: makeSettings(provider, { injectSystemTime: false } as any),
        character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠']
      }
    },
    {
      name: '08-minimal（精簡）',
      params: { settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'], minimal: true }
    },
    {
      name: '09-splitEmotion',
      params: { settings: s, character: CHAR, messages: baseMessages(), persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'], splitEmotion: true }
    },
    {
      name: '10-無 persona/world',
      params: { settings: s, character: CHAR2, messages: baseMessages(), persona: null, world: null, desktopCharacterNames: ['小藍'] }
    },
    {
      name: '11-空對話（首次發話）',
      params: { settings: s, character: CHAR, messages: [], persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'] }
    },
    {
      name: '12-歷史訊息含多張圖',
      params: {
        settings: s, character: CHAR, persona: PERSONA, world: WORLD, desktopCharacterNames: ['小綠'],
        messages: [
          { id: 'a', role: 'user', content: '看這些', images: [TINY_PNG, TINY_PNG], timestamp: T0 - 1000 },
          { id: 'b', role: 'character', characterId: 'char-1', content: '嗯。', timestamp: T0 - 500 }
        ]
      }
    }
  ]
}

// ── 主流程 ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const out: Record<string, unknown> = {}

  for (const provider of ['openai', 'claude', 'gemini', 'grok']) {
    intercept.provider = provider === 'grok' ? 'openai' : provider
    for (const sc of scenarios(provider)) {
      intercept.captured = []
      const key = `${provider}/${sc.name}`
      try {
        await chatWithLLM(sc.params)
        out[key] = intercept.captured
      } catch (e) {
        out[key] = { ERROR: e instanceof Error ? e.message : String(e), captured: intercept.captured }
      }
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2))
}

void main()
