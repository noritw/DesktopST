import { describe, it, expect } from 'vitest'
import { importStJson, exportToStJson, mergeStPersonality } from '@core/card/stCardMapper'
import { extractCharaJson, embedCharaJson, PngCardError } from '@core/card/pngCard'
import { base64ToBytes } from '@core/util/base64'
import { TINY_PNG } from '../fixtures'
import type { Character } from '@core/types'

/**
 * 角色卡 —— §6.2 第 5、6 項。
 *
 * SillyTavern 相容性是**對外承諾**（CLAUDE.md 開宗明義），回歸的代價高：
 * 別人的角色卡匯不進來，或匯出去在 ST 裡開不起來，使用者只會覺得「這個 app 壞了」。
 */

const PNG_BYTES = base64ToBytes(TINY_PNG.split(',')[1])

describe('mergeStPersonality', () => {
  it('兩者都有時合併', () => {
    const out = mergeStPersonality('外表描述', '個性描述')
    expect(out).toContain('外表描述')
    expect(out).toContain('個性描述')
  })

  it('只有一邊時就用那一邊', () => {
    expect(mergeStPersonality('只有描述', '')).toBe('只有描述')
    expect(mergeStPersonality('', '只有個性')).toBe('只有個性')
  })

  it('都沒有時空字串', () => {
    expect(mergeStPersonality(undefined, null)).toBe('')
  })

  it('用換行接起來（不做去重，兩邊相同時會出現兩次）', () => {
    expect(mergeStPersonality('外表', '個性')).toBe('外表\n個性')
    // 現況：不去重。有些 ST 卡會把同一段字同時放在 description 與 personality，
    // 匯進來就會重複一次。影響僅止於 prompt 稍長，未特別處理。
    expect(mergeStPersonality('一樣的字', '一樣的字')).toBe('一樣的字\n一樣的字')
  })

  it('前後空白會被去掉', () => {
    expect(mergeStPersonality('  外表  ', '  個性  ')).toBe('外表\n個性')
  })
})

describe('importStJson', () => {
  it('chara_card_v2 基本欄位對映', () => {
    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '小綠',
        description: '個性直率。',
        personality: '',
        first_mes: '嗨，你來啦。',
        mes_example: '<START>\n{{user}}: 早\n{{char}}: 早安',
        scenario: '在陽台上',
        system_prompt: '',
        creator_notes: '作者備註'
      }
    }
    const char = importStJson(card, 'id-1')
    expect(char.id).toBe('id-1')
    expect(char.name).toBe('小綠')
    expect(char.personality).toBe('個性直率。')
    expect(char.firstMessage).toBe('嗨，你來啦。')
    expect(char.scenario).toBe('在陽台上')
    expect(char.creatorNotes).toBe('作者備註')
  })

  it('沒有名字時給 Unknown（不會產生無名角色）', () => {
    expect(importStJson({ data: { name: '' } }, 'id-2').name).toBe('Unknown')
  })

  it('v1 平坦格式（沒有 data 包一層）也吃', () => {
    const char = importStJson({ name: '小藍', description: '溫吞。', first_mes: '嗯…' }, 'id-3')
    expect(char.name).toBe('小藍')
    expect(char.personality).toBe('溫吞。')
  })

  it('DesktopST 擴充欄位（暱稱）會還原', () => {
    const card = {
      spec: 'chara_card_v2',
      data: { name: '小綠', description: 'x', extensions: { desktopst: { nicknames: ['小綠綠'], description: '這是 DeST 的描述欄' } } }
    }
    const char = importStJson(card, 'id-4')
    expect(char.nicknames).toEqual(['小綠綠'])
    expect(char.description).toBe('這是 DeST 的描述欄')
  })

  it('完全空的物件不會爆', () => {
    const char = importStJson({}, 'id-5')
    expect(char.name).toBe('Unknown')
    expect(char.id).toBe('id-5')
  })

  it('null / 字串等亂七八糟的輸入也不會爆', () => {
    expect(() => importStJson(null, 'id-6')).not.toThrow()
    expect(() => importStJson('not an object', 'id-7')).not.toThrow()
  })
})

describe('匯出後再匯入（round-trip）', () => {
  const original: Character = {
    id: 'orig',
    name: '小綠',
    nicknames: ['小綠綠'],
    avatar: '',
    description: 'DeST 描述欄',
    personality: '個性直率、講話帶點嗆。',
    firstMessage: '嗨。',
    exampleDialogue: '<START>\n{{user}}: 早\n{{char}}: 早',
    emotions: { neutral: 'a.png' },
    scenario: '陽台',
    systemPromptOverride: '',
    creatorNotes: '備註',
    lorebook: null,
    createdAt: 1,
    updatedAt: 2
  } as unknown as Character

  it('往返後語意欄位不流失', () => {
    const back = importStJson(JSON.parse(exportToStJson(original)), 'new-id')
    expect(back.name).toBe(original.name)
    expect(back.personality).toBe(original.personality)
    expect(back.firstMessage).toBe(original.firstMessage)
    expect(back.exampleDialogue).toBe(original.exampleDialogue)
    expect(back.scenario).toBe(original.scenario)
    expect(back.creatorNotes).toBe(original.creatorNotes)
    expect(back.nicknames).toEqual(original.nicknames)
    expect(back.description).toBe(original.description)
    expect(back.emotions).toEqual(original.emotions)
  })

  it('匯出的是合法 chara_card_v2', () => {
    const json = JSON.parse(exportToStJson(original))
    expect(json.spec).toBe('chara_card_v2')
    expect(json.spec_version).toBe('2.0')
    // ST 讀的是 data.description（DeST 的 personality 放這裡）
    expect(json.data.description).toBe(original.personality)
  })

  it('連續往返兩次結果穩定（不會每次都多包一層）', () => {
    const once = importStJson(JSON.parse(exportToStJson(original)), 'a')
    const twice = importStJson(JSON.parse(exportToStJson(once)), 'b')
    expect(twice.personality).toBe(once.personality)
    expect(twice.exampleDialogue).toBe(once.exampleDialogue)
  })
})

describe('PNG 角色卡', () => {
  it('嵌入後取得出來，內容一字不差', () => {
    const json = JSON.stringify({ spec: 'chara_card_v2', data: { name: '小綠', description: '個性直率。' } })
    const png = embedCharaJson(PNG_BYTES, json)
    expect(extractCharaJson(png)).toBe(json)
  })

  it('中文與 emoji 都能存活', () => {
    const json = JSON.stringify({ data: { name: '小綠🌿', description: '喜歡植物，常說「澆水了嗎」' } })
    expect(extractCharaJson(embedCharaJson(PNG_BYTES, json))).toBe(json)
  })

  it('重複嵌入是取代不是疊加', () => {
    const first = embedCharaJson(PNG_BYTES, '{"v":1}')
    const second = embedCharaJson(first, '{"v":2}')
    expect(extractCharaJson(second)).toBe('{"v":2}')
  })

  it('嵌入後仍是合法 PNG（保留簽章）', () => {
    const png = embedCharaJson(PNG_BYTES, '{"v":1}')
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })

  it('沒有角色卡資料的 PNG → 丟出可辨識的錯誤代碼', () => {
    try {
      extractCharaJson(PNG_BYTES)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PngCardError)
      expect((e as PngCardError).code).toBe('no-chara-chunk')
    }
  })

  it('不是 PNG 的位元組 → 也是丟錯誤代碼，不是隨便的 exception', () => {
    try {
      extractCharaJson(new Uint8Array([1, 2, 3, 4]))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PngCardError)
    }
  })
})
