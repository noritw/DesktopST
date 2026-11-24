import { describe, expect, it, vi } from 'vitest'
import { chatWithLLM } from '@core/llm'
import { estimateUsd, groupUsage, sumUsage, type LlmUsageRecord } from '@core/llm/usage'
import { DEFAULT_SETTINGS } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import {
  clearUsage,
  flushUsage,
  loadUsage,
  recordUsage,
  saveUsageSettings
} from '../../src/mobile/runtime/llmUsage'

const rec = (p: Partial<LlmUsageRecord> = {}): LlmUsageRecord => ({
  at: Date.now(), feature: 'chat', provider: 'openai', model: 'gpt-6-sol', ok: true, input: 100, output: 10, usd: 0.1, ...p
})

describe('估價與加總', () => {
  it('牌價、本機免費、查無單價', () => {
    const t = { input: 1_000_000, output: 100_000 }
    expect(estimateUsd('openai', 'gpt-6-sol', t)).toBeCloseTo(3)
    expect(estimateUsd('local', 'qwen3', t)).toBe(0)
    expect(estimateUsd('openai', '不存在', t)).toBeUndefined()
  })

  it('失敗與估不出價的另外數，貴的排前面', () => {
    const list = [rec(), rec({ ok: false, input: undefined, output: undefined, usd: undefined }), rec({ feature: 'walk-foe', usd: 5 })]
    expect(sumUsage(list)).toMatchObject({ calls: 3, failed: 1, input: 200, output: 20, unpriced: 1 })
    expect(groupUsage(list, (r) => r.feature).map((g) => g.key)).toEqual(['walk-foe', 'chat'])
  })
})

describe('落地', () => {
  it('同時記多筆不掉，背景分檔，測試有標記', async () => {
    const s = createMemoryStorage()
    for (let i = 0; i < 5; i++) recordUsage(s, rec(), false)
    recordUsage(s, rec({ feature: 'reminder' }), true)
    await saveUsageSettings(s, { testing: true })
    recordUsage(s, rec(), false)
    await flushUsage()
    const list = await loadUsage(s, Date.now() - 60_000)
    expect(list).toHaveLength(7)
    expect(list.filter((r) => r.test)).toHaveLength(1)
    await clearUsage(s)
    expect(await loadUsage(s, 0)).toEqual([])
  })

  it('過期的檔會清掉', async () => {
    const s = createMemoryStorage()
    recordUsage(s, rec({ at: Date.now() - 100 * 86_400_000 }), false)
    expect(await loadUsage(s, 0)).toEqual([])
  })
})

describe('chatWithLLM 記帳', () => {
  const call = async (body: unknown, status = 200): Promise<{ records: LlmUsageRecord[]; failed: boolean }> => {
    const records: LlmUsageRecord[] = []
    const base = DEFAULT_SETTINGS
    const settings = {
      ...base,
      llm: { ...base.llm, provider: 'openai' as const, apiKeys: { openai: 'x' }, models: { openai: 'gpt-6-sol' } }
    } as typeof base
    const failed = await chatWithLLM(
      {
        settings,
        character: { id: 'c', name: 'C', emotions: {}, personality: '' },
        messages: [],
        persona: null,
        world: null,
        desktopCharacterNames: [],
        isReminder: true,
        feature: 'walk-foe'
      },
      {
        http: {
          supportsStreaming: false,
          fetch: vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
          onLlmUsage: (r) => records.push(r)
        }
      }
    ).then(() => false, () => true)
    return { records, failed }
  }
  const usage = {
    input_tokens: 1000, output_tokens: 200,
    input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 150 }
  }

  it('成功記一筆', async () => {
    const { records, failed } = await call({ output_text: 'hi', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], usage })
    expect(failed).toBe(false)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ feature: 'walk-foe', ok: true, input: 1000, output: 200, cached: 400, reasoning: 150 })
    expect(records[0].usd).toBeCloseTo(0.004)
  })

  it('空回應照樣記 token', async () => {
    const { records, failed } = await call({ output: [], usage })
    expect(failed).toBe(true)
    expect(records[0]).toMatchObject({ ok: false, input: 1000, output: 200 })
  })

  it('請求失敗記一筆沒有 token 的', async () => {
    const { records } = await call({ error: { message: 'bad' } }, 400)
    expect(records).toHaveLength(1)
    expect(records[0].ok).toBe(false)
    expect(records[0].usd).toBeUndefined()
  })
})
