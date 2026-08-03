import { describe, it, expect, vi } from 'vitest'
import { computeRandomResult, diceNotation, sanitizePendingRandomTool, modifierString } from '@core/random/dice'
import { makeTokenString, hasRandomTokens, expandRandomTokens } from '@core/prompt/randomTokens'
import { formatRandomResultForPrompt } from '@core/prompt/randomResult'
import { makeSeededRandom } from '../fixtures'
import type { RandomResult } from '@core/types'

/**
 * 隨機工具 —— 2026-08-04 從三份實作收成一份時，用一次性腳本驗過 3,819 項零差異。
 * 這裡把當時的驗證固化成常設測試（`pre-b3-work-assessment.md` §6.2 的作法）。
 *
 * 亂數一律用固定 seed → 完全可決定性。
 */

const dice = (over: Partial<Extract<RandomResult, { tool: 'dice' }>> = {}): Extract<RandomResult, { tool: 'dice' }> => ({
  tool: 'dice', faces: 6, count: 1, rolls: [4], kept: [4], modifier: 0, total: 4, ...over
})

/** 取非骰子工具的結果字串（骰子沒有 `result` 欄位，型別上要先縮小） */
function resultOf(r: RandomResult): string {
  if (r.tool === 'dice') throw new Error('expected a non-dice result')
  return r.result
}

describe('computeRandomResult', () => {
  it('硬幣只會是正面或反面', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(1))
    for (let i = 0; i < 200; i++) {
      expect(['正面', '反面']).toContain(resultOf(computeRandomResult({ tool: 'coin' })))
    }
  })

  it('擲筊只會是三種筊象', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(2))
    for (let i = 0; i < 200; i++) {
      expect(['聖筊', '笑筊', '陰筊']).toContain(resultOf(computeRandomResult({ tool: 'jiao' })))
    }
  })

  it('御神籤只會是七種等第', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(3))
    const tiers = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶']
    for (let i = 0; i < 300; i++) {
      expect(tiers).toContain(resultOf(computeRandomResult({ tool: 'omikuji' })))
    }
  })

  it('骰子點數落在 1..faces，總和 = 採計點數 + 修正值', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(4))
    for (let i = 0; i < 300; i++) {
      const r = computeRandomResult({ tool: 'dice', faces: 20, count: 3, modifier: 2 })
      if (r.tool !== 'dice') throw new Error('unreachable')
      expect(r.rolls).toHaveLength(3)
      for (const n of r.rolls) expect(n).toBeGreaterThanOrEqual(1)
      for (const n of r.rolls) expect(n).toBeLessThanOrEqual(20)
      expect(r.total).toBe(r.kept.reduce((a, b) => a + b, 0) + 2)
    }
  })

  it('keepHighest 取最大的 N 顆', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(5))
    const r = computeRandomResult({ tool: 'dice', faces: 6, count: 4, keepHighest: 3 })
    if (r.tool !== 'dice') throw new Error('unreachable')
    expect(r.kept).toHaveLength(3)
    const sorted = [...r.rolls].sort((a, b) => b - a).slice(0, 3)
    expect([...r.kept].sort()).toEqual(sorted.sort())
  })

  it('keepLowest 取最小的 N 顆', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(6))
    const r = computeRandomResult({ tool: 'dice', faces: 20, count: 2, keepLowest: 1 })
    if (r.tool !== 'dice') throw new Error('unreachable')
    expect(r.kept).toEqual([Math.min(...r.rolls)])
  })

  it('kh >= 顆數時不生效（全部採計）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(7))
    const r = computeRandomResult({ tool: 'dice', faces: 6, count: 3, keepHighest: 3 })
    if (r.tool !== 'dice') throw new Error('unreachable')
    expect(r.kept).toEqual(r.rolls)
  })

  it('同一個 seed 給同一個結果（可重現）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(2024))
    const a = computeRandomResult({ tool: 'dice', faces: 100, count: 5, modifier: -3 })
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(2024))
    const b = computeRandomResult({ tool: 'dice', faces: 100, count: 5, modifier: -3 })
    expect(a).toEqual(b)
  })

  it('機率分布大致符合權重（擲筊聖筊約 40%）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(20260804))
    let sheng = 0
    const N = 20000
    for (let i = 0; i < N; i++) {
      if (resultOf(computeRandomResult({ tool: 'jiao' })) === '聖筊') sheng++
    }
    // 抓寬一點，只擋「權重被整個改掉」這種等級的錯，不擋統計波動
    expect(sheng / N).toBeGreaterThan(0.35)
    expect(sheng / N).toBeLessThan(0.45)
  })
})

describe('diceNotation / modifierString', () => {
  it('各種組合', () => {
    expect(diceNotation({ tool: 'dice', count: 2, faces: 6, modifier: 3 })).toBe('2d6+3')
    expect(diceNotation({ tool: 'dice', count: 1, faces: 20, modifier: -2 })).toBe('1d20-2')
    expect(diceNotation({ tool: 'dice', count: 4, faces: 6, keepHighest: 3 })).toBe('4d6kh3')
    expect(diceNotation({ tool: 'dice' })).toBe('1d6')
  })

  it('非骰子回空字串', () => {
    expect(diceNotation({ tool: 'coin' })).toBe('')
  })

  it('modifierString：0 給空字串', () => {
    expect(modifierString(0)).toBe('')
    expect(modifierString(3)).toBe('+3')
    expect(modifierString(-2)).toBe('-2')
  })
})

describe('內嵌 token 系統', () => {
  it('makeTokenString 產生的 token 自己認得', () => {
    for (const p of [
      { tool: 'omikuji' as const }, { tool: 'jiao' as const }, { tool: 'coin' as const },
      { tool: 'dice' as const, count: 2, faces: 6, modifier: 3 },
      { tool: 'dice' as const, count: 4, faces: 6, keepHighest: 3 }
    ]) {
      expect(hasRandomTokens(makeTokenString(p))).toBe(true)
    }
  })

  it('token 格式固定（改了會動到訊息內容）', () => {
    expect(makeTokenString({ tool: 'omikuji' })).toBe('[🏮抽籤]')
    expect(makeTokenString({ tool: 'dice', count: 2, faces: 6, modifier: 3 })).toBe('[🎲2d6+3]')
    expect(makeTokenString({ tool: 'dice', count: 2, faces: 20, keepLowest: 1 })).toBe('[🎲2d20kl1]')
  })

  it('舊格式（無 emoji）仍然相容', () => {
    expect(hasRandomTokens('來 [抽籤] 一下')).toBe(true)
    expect(hasRandomTokens('丟個 [2d6] 看看')).toBe(true)
  })

  it('沒有 token 的文字不會被誤判', () => {
    expect(hasRandomTokens('今天天氣真好')).toBe(false)
    expect(hasRandomTokens('陣列取值 arr[0] 這樣')).toBe(false)
  })

  it('展開後 token 消失、結果數量正確、其餘文字不動', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(11))
    const { expandedText, results } = expandRandomTokens('先 [🎲1d20] 再 [🏮抽籤] 結束')
    expect(results).toHaveLength(2)
    expect(expandedText.startsWith('先 ')).toBe(true)
    expect(expandedText.endsWith(' 結束')).toBe(true)
    expect(hasRandomTokens(expandedText)).toBe(false)
  })

  it('展開文字格式固定（會進對話與 prompt）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(12))
    expect(expandRandomTokens('[🎲2d6+3] [🪙硬幣] [🙏擲茭]').expandedText).toMatchSnapshot()
  })

  it('壞掉的 token 原樣保留、不產生結果', () => {
    const { expandedText, results } = expandRandomTokens('[🎲abc] [] [d6]')
    expect(results).toHaveLength(0)
    expect(expandedText).toBe('[🎲abc] [] [d6]')
  })

  it('沒有 token 時文字原樣', () => {
    const { expandedText, results } = expandRandomTokens('一般句子')
    expect(expandedText).toBe('一般句子')
    expect(results).toHaveLength(0)
  })
})

describe('sanitizePendingRandomTool（HTTP 端點的信任邊界）', () => {
  it('顆數夾到 1..20，擋掉會讓 process 卡死的輸入', () => {
    expect(sanitizePendingRandomTool('dice', { count: 1e9 })?.count).toBe(20)
    expect(sanitizePendingRandomTool('dice', { count: -5 })?.count).toBe(1)
  })

  it('面數夾到 2..1000', () => {
    expect(sanitizePendingRandomTool('dice', { faces: 1 })?.faces).toBe(2)
    expect(sanitizePendingRandomTool('dice', { faces: 99999 })?.faces).toBe(1000)
  })

  it('NaN / undefined 走預設值 1d6', () => {
    const p = sanitizePendingRandomTool('dice', { faces: NaN, count: undefined })
    expect(p).toMatchObject({ tool: 'dice', faces: 6, count: 1, modifier: 0 })
  })

  it('kh/kl 不會超過顆數', () => {
    expect(sanitizePendingRandomTool('dice', { count: 2, keepHighest: 99 })?.keepHighest).toBe(2)
  })

  it('無參數工具照過，未知工具給 null', () => {
    expect(sanitizePendingRandomTool('omikuji', {})).toEqual({ tool: 'omikuji' })
    expect(sanitizePendingRandomTool('不存在', {})).toBeNull()
  })
})

describe('formatRandomResultForPrompt', () => {
  it('單顆有修正值時明確說明「修正已計入」（避免 LLM 重複加）', () => {
    const out = formatRandomResultForPrompt(dice({ faces: 20, rolls: [9], kept: [9], modifier: 3, total: 12 }))
    expect(out).toContain('修正 +3 已計入')
    expect(out).toMatchSnapshot()
  })

  it('kh/kl 會列出骰出與採計', () => {
    const out = formatRandomResultForPrompt(dice({ count: 4, rolls: [5, 4, 6, 1], kept: [6, 5, 4], total: 15 }))
    expect(out).toContain('骰出')
    expect(out).toContain('採計')
    expect(out).toMatchSnapshot()
  })

  it('最單純的 1d20 就是一行', () => {
    expect(formatRandomResultForPrompt(dice({ faces: 20, rolls: [9], kept: [9], total: 9 })))
      .toBe('骰子結果：1d20 = 9')
  })

  it('三種非骰子工具', () => {
    expect(formatRandomResultForPrompt({ tool: 'omikuji', result: '大吉' })).toBe('抽籤結果：大吉')
    expect(formatRandomResultForPrompt({ tool: 'jiao', result: '聖筊' })).toBe('擲茭結果：聖筊')
    expect(formatRandomResultForPrompt({ tool: 'coin', result: '正面' })).toBe('硬幣結果：正面')
  })
})
