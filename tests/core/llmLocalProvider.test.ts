import { describe, expect, it } from 'vitest'
import { localReasoningParams, resolveEndpoint, resolveApiKeyForProvider } from '@core/llm'
import { applyUtilitySettings, hasUsableApiKey, providerNeedsApiKey, resolveApiKey } from '@core/prompt/promptUtils'
import { makeSettings } from '../fixtures'
import type { AppSettings } from '@core/types'

/**
 * 本機供應商（`local` = 使用者自架的 OpenAI 相容端點）的路由與參數。
 *
 * 這裡驗的都是「錯了會很安靜」的東西：端點查錯家只會讓請求打到別台機器，
 * 漏了關思考參數只會得到一個 `Empty response from model`。
 * 設計背景：`docs/local-llm-provider-plan.md`。
 */

function withLocal(over: Partial<AppSettings['llm']> = {}): AppSettings {
  const s = makeSettings()
  return { ...s, llm: { ...s.llm, ...over } }
}

describe('localReasoningParams', () => {
  it('local 要帶 effort:none —— 思考模型會把 token 預算吃光、正文回空字串', () => {
    expect(localReasoningParams('local')).toEqual({ reasoning: { effort: 'none' } })
  })

  it('其他供應商一律不帶（OpenAI 的推理模型不該被硬關掉思考）', () => {
    for (const p of ['openai', 'claude', 'gemini', 'grok']) {
      expect(localReasoningParams(p)).toEqual({})
    }
  })
})

describe('resolveEndpoint', () => {
  it('從 endpoints 表查該供應商的端點', () => {
    const s = withLocal({ endpoints: { local: 'http://100.70.201.116:11434/v1' } })
    expect(resolveEndpoint(s, 'local')).toBe('http://100.70.201.116:11434/v1')
  })

  it('查的是指定的供應商，不是目前生效的那家', () => {
    // 主模型 claude（雲端）、輔助 local（本機）——這組是整個功能的核心情境
    const s = withLocal({
      provider: 'claude',
      endpoints: { local: 'http://192.168.1.9:11434/v1', openai: 'https://proxy.example/v1' }
    })
    expect(resolveEndpoint(s, 'local')).toBe('http://192.168.1.9:11434/v1')
    expect(resolveEndpoint(s, 'openai')).toBe('https://proxy.example/v1')
    // claude 沒設過端點 → undefined（SDK 用官方預設）
    expect(resolveEndpoint(s, 'claude')).toBeUndefined()
  })

  it('grok 沒設端點時仍退回官方預設', () => {
    expect(resolveEndpoint(withLocal({ endpoints: {} }), 'grok')).toBe('https://api.x.ai/v1')
  })

  it('endpoints 整張表還是空的時，才退回舊的單一 endpoint 欄位（只限目前生效的供應商）', () => {
    // 遷移寫回磁碟前的空窗期；不能讓別家沿用到這個值
    const s = withLocal({ provider: 'openai', endpoint: 'https://legacy.example/v1', endpoints: {} })
    expect(resolveEndpoint(s, 'openai')).toBe('https://legacy.example/v1')
    expect(resolveEndpoint(s, 'local')).toBeUndefined()
  })

  it('表裡已有別家的值時，不可以再退回舊欄位——切回雲端會被送去本機那台', () => {
    /*
     * owner 2026-08-15 手機獨立版實測：切到本機模型、再切回雲端就連不上。
     * 舊欄位是個「跟著目前 provider 更新」的鏡像，切到 local 時被寫成本機網址；
     * 切回 openai 後 `endpoints.openai` 本來就沒有值（用官方端點是正常狀態），
     * 舊程式一路退回鏡像 → OpenAI 的請求被打到 `http://…:11434/v1`。
     */
    const s = withLocal({
      provider: 'openai',
      endpoint: 'http://100.70.201.116:11434/v1',
      endpoints: { local: 'http://100.70.201.116:11434/v1' }
    })
    expect(resolveEndpoint(s, 'openai')).toBeUndefined()
    // grok 同理：不可以拿本機網址去覆蓋官方預設
    expect(resolveEndpoint(s, 'grok')).toBe('https://api.x.ai/v1')
    // local 自己照樣查得到
    expect(resolveEndpoint(s, 'local')).toBe('http://100.70.201.116:11434/v1')
  })
})

describe('金鑰：local 可以不填', () => {
  it('local 沒金鑰時給 placeholder，不讓「沒有金鑰」變成錯誤', () => {
    expect(resolveApiKeyForProvider('local', '', {})).toBe('local')
    expect(resolveApiKey(withLocal({ provider: 'local', apiKey: '', apiKeys: {} }))).toBe('local')
  })

  it('local 有填金鑰時照用（自架端點也可能有 auth）', () => {
    expect(resolveApiKeyForProvider('local', '', { local: 'my-proxy-key' })).toBe('my-proxy-key')
  })

  it('其他供應商沒金鑰仍是空字串（照舊會被擋下）', () => {
    expect(resolveApiKeyForProvider('openai', '', {})).toBe('')
  })
})

describe('hasUsableApiKey：擋在 LLM 呼叫前面的關卡', () => {
  it('local 沒填金鑰也算「可用」', () => {
    expect(hasUsableApiKey(withLocal({ provider: 'local', apiKeys: {} }))).toBe(true)
    expect(providerNeedsApiKey('local')).toBe(false)
  })

  it('其他供應商沒金鑰仍要被擋（不能為了本機模型把所有人都放行）', () => {
    expect(hasUsableApiKey(withLocal({ provider: 'openai', apiKeys: {} }))).toBe(false)
    expect(hasUsableApiKey(withLocal({ provider: 'openai', apiKeys: { openai: 'sk-x' } }))).toBe(true)
    expect(providerNeedsApiKey('openai')).toBe(true)
  })

  it('只看目前生效的供應商，不是「有任何一把金鑰就好」', () => {
    // 有 openai 金鑰但目前用 claude → 仍要擋
    expect(hasUsableApiKey(withLocal({ provider: 'claude', apiKeys: { openai: 'sk-x' } }))).toBe(false)
  })
})

describe('applyUtilitySettings：輔助模型要換到自己那家的端點', () => {
  it('主＝Claude 雲端、輔助＝本機 Ollama', () => {
    const s = withLocal({
      provider: 'claude',
      endpoint: undefined,
      endpoints: { local: 'http://100.70.201.116:11434/v1' },
      utilityEnabled: true,
      utilityProvider: 'local',
      utilityModels: { local: 'qwen3:8b' }
    })
    const out = applyUtilitySettings(s)
    expect(out.llm.provider).toBe('local')
    expect(out.llm.models?.local).toBe('qwen3:8b')
    expect(out.llm.endpoint).toBe('http://100.70.201.116:11434/v1')
  })

  it('反過來：主＝本機、輔助＝雲端時，端點不可以殘留本機的值', () => {
    // 這是最容易寫錯的方向——舊程式不動 endpoint，會拿著本機 URL 去打 OpenAI
    const s = withLocal({
      provider: 'local',
      endpoint: 'http://100.70.201.116:11434/v1',
      endpoints: { local: 'http://100.70.201.116:11434/v1' },
      utilityEnabled: true,
      utilityProvider: 'openai',
      utilityModels: { openai: 'gpt-5-nano' }
    })
    const out = applyUtilitySettings(s)
    expect(out.llm.provider).toBe('openai')
    expect(out.llm.endpoint).toBeUndefined()
  })

  it('關閉輔助模型時原樣返回', () => {
    const s = withLocal({ utilityEnabled: false, utilityProvider: 'local' })
    expect(applyUtilitySettings(s)).toBe(s)
  })
})
