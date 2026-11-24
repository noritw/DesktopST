import { describe, expect, it } from 'vitest'
import { chatWithLLM, applyUtilitySettings, classifyEmotionWithLLM } from '../../src/core/llm'
import { claudeUtilityThinkingParams } from '../../src/core/llm/claude'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/core/types'

const settingsFor = (model: string): AppSettings => ({
  ...DEFAULT_SETTINGS,
  llm: {
    ...DEFAULT_SETTINGS.llm, provider: 'claude',
    apiKeys: { ...DEFAULT_SETTINGS.llm.apiKeys, claude: 'test' },
    models: { claude: model }, utilityEnabled: true, utilityProvider: 'claude', utilityModels: { claude: model }
  }
})

function capture() {
  const bodies: any[] = []
  const fetch = async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'neutral' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { bodies, deps: { http: { fetch } } as any }
}
const character = { id: 'c', name: 'C' } as any

describe('Claude 輔助呼叫關閉思考', () => {
  it('只有輔助路徑的 Haiku 5.5 會帶 disabled，主模型不帶', async () => {
    const { bodies, deps } = capture()
    const s = settingsFor('claude-haiku-5-5')
    await chatWithLLM({ settings: s, character, messages: [] } as any, deps)
    await chatWithLLM({ settings: applyUtilitySettings(s), character, messages: [] } as any, deps)
    await classifyEmotionWithLLM({ settings: s, character, reply: 'hi' }, deps)
    expect(bodies.map(b => b.thinking)).toEqual([undefined, { type: 'disabled' }, { type: 'disabled' }])
  })

  it('其他型號不送（會 400）', () => {
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']) {
      expect(claudeUtilityThinkingParams(m)).toEqual({})
    }
  })
})
