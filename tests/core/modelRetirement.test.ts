import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/core/types'
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER, MODEL_PRICES, modelPriceText } from '../../src/core/llm/modelCatalog'
import {
  MODEL_RETIREMENTS, applyRetiredModels, clearSwitched, isModelRetired, markNotified, pendingRetirementNotices,
  replaceModel, retirementNoticeText, switchedNoticeText
} from '../../src/core/llm/modelRetirement'
import { chatWithLLM, applyUtilitySettings, classifyEmotionWithLLM } from '../../src/core/llm'

const at = (d: string): number => new Date(`${d}T12:00:00`).getTime()
const llm = (o: Partial<AppSettings['llm']>): AppSettings['llm'] => ({ ...DEFAULT_SETTINGS.llm, ...o })

describe('停用表本身', () => {
  it('替代型號都在清單與價格表裡，且自己沒有排定停用', () => {
    for (const r of MODEL_RETIREMENTS) {
      expect(MODELS_BY_PROVIDER[r.provider]).toContain(r.replacement)
      expect(MODEL_PRICES[r.replacement]).toBeTruthy()
      expect(MODEL_RETIREMENTS.some(x => x.ids.includes(r.replacement))).toBe(false)
    }
  })
  it('OpenAI 預設值沒有排定停用', () => {
    const ids = MODEL_RETIREMENTS.flatMap(r => r.ids)
    expect(ids).not.toContain(DEFAULT_SETTINGS.llm.model)
    expect(ids).not.toContain(DEFAULT_MODEL_BY_PROVIDER.openai)
  })
})

describe('通知', () => {
  const s = llm({ models: { openai: 'gpt-5.4-nano-2026-03-17' } })
  it('60 天前不跳，60 天內跳 early，按過就不再跳，7 天內跳 final', () => {
    const l = { ...s }
    expect(pendingRetirementNotices(l, at('2027-01-30'))).toEqual([])
    const [n] = pendingRetirementNotices(l, at('2027-01-31'))
    expect(n).toMatchObject({ stage: 'early', to: 'gpt-6-luna', slots: ['main'] })
    markNotified(l, n)
    expect(pendingRetirementNotices(l, at('2027-03-24'))).toEqual([])
    const [f] = pendingRetirementNotices(l, at('2027-03-25'))
    expect(f.stage).toBe('final')
    markNotified(l, f)
    expect(pendingRetirementNotices(l, at('2027-03-31'))).toEqual([])
  })
  it('主輔同一顆併成一則；沒開輔助不算', () => {
    const both = llm({ models: { openai: 'gpt-5-nano' }, utilityModels: { openai: 'gpt-5-nano' }, utilityEnabled: true })
    const ns = pendingRetirementNotices(both, at('2026-11-24'))
    expect(ns).toHaveLength(1)
    expect(ns[0].slots).toEqual(['main', 'utility'])
    const off = llm({ models: { openai: 'gpt-6-luna' }, utilityModels: { openai: 'gpt-5-nano' } })
    expect(pendingRetirementNotices(off, at('2026-11-24'))).toEqual([])
  })
  it('自訂端點不通知也不換', () => {
    const l = llm({ models: { openai: 'gpt-5-nano' }, endpoints: { openai: 'https://proxy.example/v1' } })
    expect(pendingRetirementNotices(l, at('2026-12-20'))).toEqual([])
    expect(applyRetiredModels(l, at('2026-12-20'))).toBe(false)
    const official = llm({ models: { openai: 'gpt-5-nano' }, endpoints: { openai: 'https://api.openai.com/v1' } })
    expect(applyRetiredModels(official, at('2026-12-20'))).toBe(true)
  })
  it('文字帶兩邊價格；帶日期的快照也查得到價', () => {
    const [n] = pendingRetirementNotices({ ...s }, at('2027-03-01'))
    const { message } = retirementNoticeText(n, modelPriceText)
    expect(message).toContain('$0.2 / $1.25')
    expect(message).toContain('$0.1 / $0.5')
  })
})

describe('到期自動換', () => {
  it('停用日前一天不動，當天換，通知一次後清掉', () => {
    const l = llm({ models: { openai: 'gpt-5-nano' }, model: 'gpt-5-nano' })
    expect(applyRetiredModels(l, at('2026-12-10'))).toBe(false)
    expect(applyRetiredModels(l, at('2026-12-11'))).toBe(true)
    expect(l.models?.openai).toBe('gpt-6-luna')
    expect(l.model).toBe('gpt-6-luna')
    expect(switchedNoticeText(l)?.message).toContain('gpt-5-nano')
    clearSwitched(l)
    expect(switchedNoticeText(l)).toBeNull()
    expect(applyRetiredModels(l, at('2026-12-12'))).toBe(false)
  })
  it('只有遺留 llm.model 的舊設定也換得到', () => {
    const l = llm({ model: 'gpt-5.4-nano-2026-03-17', models: undefined })
    expect(applyRetiredModels(l, at('2027-04-01'))).toBe(true)
    expect(l.models?.openai).toBe('gpt-6-luna')
  })
  it('沒在用的供應商安靜換掉', () => {
    const l = llm({ provider: 'claude', model: 'claude-haiku-4-5', models: { claude: 'claude-haiku-4-5', openai: 'o3' } })
    expect(applyRetiredModels(l, at('2026-12-11'))).toBe(true)
    expect(l.models).toEqual({ claude: 'claude-haiku-4-5', openai: 'gpt-6.1-sol' })
    expect(l.model).toBe('claude-haiku-4-5')
    expect(switchedNoticeText(l)).toBeNull()
  })
  it('官方沒確定日期的只通知不換', () => {
    const l = llm({ models: { openai: 'gpt-4o' } })
    expect(applyRetiredModels(l, at('2027-03-01'))).toBe(false)
    expect(pendingRetirementNotices(l, at('2027-03-01'))[0].autoSwitch).toBe(false)
    expect(isModelRetired('openai', 'gpt-4o', at('2027-03-01'))).toBe(false)
  })
  it('不會改到 DEFAULT_SETTINGS', () => {
    const l = llm({ model: 'gpt-5-nano', models: undefined })
    replaceModel(l, 'openai', 'gpt-5-nano', 'gpt-6-luna')
    expect(DEFAULT_SETTINGS.llm.models).toBeUndefined()
  })
})

describe('GPT 關思考', () => {
  it('luna 全程關；sol 只在輔助呼叫關；不支援 none 的不送', async () => {
    const bodies: any[] = []
    const deps = { http: { fetch: async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ output_text: 'neutral', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'neutral' }] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    } } } as any
    const character = { id: 'c', name: 'C' } as any
    for (const m of ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol']) {
      const s: AppSettings = { ...DEFAULT_SETTINGS, llm: llm({ apiKeys: { openai: 't' }, models: { openai: m }, utilityEnabled: true, utilityModels: { openai: m } }) }
      await chatWithLLM({ settings: s, character, messages: [] } as any, deps)
      await chatWithLLM({ settings: applyUtilitySettings(s), character, messages: [] } as any, deps)
      await classifyEmotionWithLLM({ settings: s, character, reply: 'hi' }, deps)
    }
    expect(bodies.map(b => b.reasoning?.effort)).toEqual([
      'none', 'none', 'none',
      undefined, 'none', 'none',
      undefined, undefined, undefined
    ])
  })
})
