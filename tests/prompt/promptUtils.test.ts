import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildSystemPrompt,
  buildTriggerMessage,
  buildTriggerTimeStr,
  annotateTimeGaps,
  expandReactionAnnotations,
  sanitizePromptText,
  applyStStyleTags,
  normalizeEmotion,
  parseEmotion
} from '@core/prompt/promptUtils'
import { makeSettings, CHAR, PERSONA, WORLD, baseMessages, T0 } from '../fixtures'
import type { Message } from '@core/types'

/**
 * prompt 組裝的黃金測試 —— `pre-b3-work-assessment.md` §6.2 列為「最有價值的一項」。
 *
 * 固定輸入 → 固定字串。任何人改壞 prompt 會立刻紅燈。
 * 這裡用 vitest 的 snapshot：第一次跑會產生 `__snapshots__/`，之後每次比對。
 * **prompt 有意的改動會讓它紅字，那是正常的** —— 確認差異符合預期後
 * 跑 `npx vitest run -u` 更新快照即可。
 */

afterEach(() => { vi.useRealTimers() })

describe('buildSystemPrompt', () => {
  it('一般聊天：完整 system prompt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const out = buildSystemPrompt(makeSettings(), CHAR, PERSONA, WORLD, ['小綠'])
    expect(out).toMatchSnapshot()
  })

  it('群組：桌面上有多個角色時會列出其他角色', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const out = buildSystemPrompt(makeSettings(), CHAR, PERSONA, WORLD, ['小綠', '小藍'])
    expect(out).toContain('小藍')
  })

  it('minimal：跳過角色扮演相關段落，明顯短很多', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const full = buildSystemPrompt(makeSettings(), CHAR, PERSONA, WORLD, ['小綠'])
    const minimal = buildSystemPrompt(makeSettings(), CHAR, PERSONA, WORLD, ['小綠'], undefined, { minimal: true })
    expect(minimal.length).toBeLessThan(full.length)
    expect(minimal).toMatchSnapshot()
  })

  it('splitEmotion：有自訂表情差分時才省略情緒合約', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    // ⚠️ splitEmotion 只在角色**有自訂表情圖**時才有差別（`hasCustomSprites`）。
    // 用沒有圖的角色測會兩邊一樣長 —— 寫這支測試時就是這樣被騙過一次。
    const spriteChar = { ...CHAR, emotions: { neutral: 'a.png', joy: 'b.png' } }
    const withContract = buildSystemPrompt(makeSettings(), spriteChar, PERSONA, WORLD, ['小綠'])
    const split = buildSystemPrompt(makeSettings(), spriteChar, PERSONA, WORLD, ['小綠'], undefined, { splitEmotion: true })
    expect(split.length).toBeLessThan(withContract.length)
  })

  it('injectSystemTime 關閉時，prompt 不含現實時間', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const out = buildSystemPrompt(
      makeSettings({ injectSystemTime: false } as never), CHAR, PERSONA, WORLD, ['小綠']
    )
    expect(out).not.toContain('[System Time]')
  })

  it('沒有 persona / world 也不會爆，且有預設稱呼', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const out = buildSystemPrompt(makeSettings(), CHAR, null, null, ['小綠'])
    expect(out).toContain('小綠')
    expect(out).toMatchSnapshot()
  })

  it('extraSystemContext 會附在末尾', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const out = buildSystemPrompt(
      makeSettings(), CHAR, PERSONA, WORLD, ['小綠'], '[Weather] 台北 28°C 晴'
    )
    expect(out).toContain('[Weather] 台北 28°C 晴')
  })
})

describe('buildTriggerMessage', () => {
  it('基本形：只有角色名', () => {
    expect(buildTriggerMessage('小綠')).toBe('[Write the next in-character reply as "小綠" only.]')
  })

  it('帶時間與 directive：時間在最前、directive 在最後', () => {
    expect(buildTriggerMessage('小綠', 'Bring up the news.', '2025-08-03 20:26 晚上'))
      .toBe('[Current time: 2025-08-03 20:26 晚上]\n[Write the next in-character reply as "小綠" only.]\nBring up the news.')
  })

  it('空白 directive 視為沒有', () => {
    expect(buildTriggerMessage('小綠', '   ')).toBe('[Write the next in-character reply as "小綠" only.]')
  })
})

describe('buildTriggerTimeStr', () => {
  it('距最後一則訊息超過一小時 → 附註 last message N ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const msgs = [{ id: 'm1', role: 'user', content: 'x', timestamp: T0 - 14 * 3_600_000 }] as unknown as Message[]
    expect(buildTriggerTimeStr(makeSettings(), msgs)).toContain('(last message 14h ago)')
  })

  it('剛剛才講過 → 不附註', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const msgs = [{ id: 'm1', role: 'user', content: 'x', timestamp: T0 - 60_000 }] as unknown as Message[]
    expect(buildTriggerTimeStr(makeSettings(), msgs)).not.toContain('last message')
  })

  it('injectSystemTime 關閉 或 minimal → 完全不給時間', () => {
    const msgs = baseMessages()
    expect(buildTriggerTimeStr(makeSettings({ injectSystemTime: false } as never), msgs)).toBeUndefined()
    expect(buildTriggerTimeStr(makeSettings(), msgs, true)).toBeUndefined()
  })
})

describe('annotateTimeGaps', () => {
  it('間隔超過一小時才插入標註，且原訊息全部保留', () => {
    const out = annotateTimeGaps(baseMessages())
    const gaps = out.filter(m => m.id.endsWith(':timegap'))
    expect(gaps).toHaveLength(1)
    expect(gaps[0].content).toBe('(2h later)')
    expect(out.filter(m => !m.id.endsWith(':timegap'))).toHaveLength(5)
  })

  it('沒有斷層時原樣回傳', () => {
    const msgs = [
      { id: 'a', role: 'user', content: '1', timestamp: T0 },
      { id: 'b', role: 'user', content: '2', timestamp: T0 + 60_000 }
    ] as unknown as Message[]
    expect(annotateTimeGaps(msgs)).toHaveLength(2)
  })

  it('空陣列不會爆', () => {
    expect(annotateTimeGaps([])).toEqual([])
  })
})

describe('expandReactionAnnotations', () => {
  it('有 reaction 時插入一則合成訊息', () => {
    const out = expandReactionAnnotations(baseMessages())
    expect(out.length).toBe(6)
    expect(JSON.stringify(out)).toContain('found it funny')
  })

  it('沒有任何 reaction 時回傳原陣列本身（不複製）', () => {
    const msgs = baseMessages().map(m => ({ ...m, reaction: undefined })) as Message[]
    expect(expandReactionAnnotations(msgs)).toBe(msgs)
  })

  it('😒 + 新聞訊息 → 措辭是「對新聞主題沒興趣」而非針對角色', () => {
    const msgs = [
      { id: 'n1', role: 'character', characterId: 'char-1', content: '你看這則新聞', timestamp: T0, reaction: '😒', newsLink: { url: 'https://example.com' } }
    ] as unknown as Message[]
    const out = expandReactionAnnotations(msgs)
    expect(out).toHaveLength(2)
    expect(out[1].content).toMatchSnapshot()
  })
})

describe('sanitizePromptText / applyStStyleTags', () => {
  it('清掉 [object Object]、統一換行、收斂空行', () => {
    expect(sanitizePromptText('a[object Object]\r\n\n\n\nb   \n c ')).toBe('a\n\nb\n c')
  })

  it('null / undefined → 空字串', () => {
    expect(sanitizePromptText(null)).toBe('')
    expect(sanitizePromptText(undefined)).toBe('')
  })

  it('{{user}} / {{char}} 取代（大小寫與空白都吃）', () => {
    expect(applyStStyleTags('{{user}} 對 {{ CHAR }} 說', { userName: '阿諾', charName: '小綠' }))
      .toBe('阿諾 對 小綠 說')
  })
})

describe('normalizeEmotion / parseEmotion', () => {
  it('未知情緒 → null', () => {
    expect(normalizeEmotion('不存在的情緒')).toBeNull()
    expect(normalizeEmotion(undefined)).toBeNull()
  })

  it('已知情緒 → 正規化後的 id（大小寫與前後空白都吃）', () => {
    expect(normalizeEmotion('joy')).toBe('joy')
    expect(normalizeEmotion(' JOY ')).toBe('joy')
  })

  it('別名對照：sad → sadness、calm → neutral', () => {
    expect(normalizeEmotion('sad')).toBe('sadness')
    expect(normalizeEmotion('calm')).toBe('neutral')
    expect(normalizeEmotion('angry')).toBe('anger')
  })

  it('從回覆文字中抽出情緒標籤與內容', () => {
    const r = parseEmotion('[joy]\n今天天氣真好')
    expect(r.emotion).toBe('joy')
    expect(r.content).toBe('今天天氣真好')
  })

  it('emotion: xxx 格式也吃', () => {
    expect(parseEmotion('emotion: amused\n哈哈')).toEqual({ emotion: 'amusement', content: '哈哈' })
  })

  it('中文開頭的對白不會被誤吃掉（沒有 CJK 啟發式）', () => {
    const r = parseEmotion('好啊，那就這樣吧。')
    expect(r.content).toBe('好啊，那就這樣吧。')
    expect(r.emotion).toBe('neutral')
  })

  it('沒有標籤時內容原樣、情緒給預設', () => {
    const r = parseEmotion('就只是一句話')
    expect(r.content).toBe('就只是一句話')
    expect(typeof r.emotion).toBe('string')
  })
})
