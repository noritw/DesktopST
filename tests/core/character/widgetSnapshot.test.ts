import { describe, expect, it } from 'vitest'
import {
  buildWidgetLines,
  hasDistinctSpeakers,
  isPinnedMessage,
  normalizeWidgetConfig,
  type PinnedWidgetMessage,
  type WidgetScanMessage
} from '../../../src/core/character/widgetSnapshot'

const msg = (over: Partial<WidgetScanMessage> & { id: string; timestamp: number }): WidgetScanMessage => ({
  role: 'character',
  content: '內容',
  ...over
})

describe('buildWidgetLines', () => {
  const messages: WidgetScanMessage[] = [
    msg({ id: 'm1', role: 'user', content: '嗨', timestamp: 1000 }),
    msg({ id: 'm2', characterId: 'char-a', content: '你好', emotion: 'joy', timestamp: 2000 }),
    msg({ id: 'm3', characterId: 'char-b', content: '第二位角色', timestamp: 3000 }),
    msg({ id: 'm4', characterId: 'char-a', content: '   ', timestamp: 4000 })
  ]

  it('沒有釘選時顯示目前對話最新的兩則角色發言，**新的在下面**（跟對話記錄一致）', () => {
    const lines = buildWidgetLines(messages, 'conv-1', [])
    expect(lines.map((l) => l.messageId)).toEqual(['m2', 'm3'])
    expect(lines.every((l) => l.pinned === false)).toBe(true)
    expect(lines[0].conversationId).toBe('conv-1')
  })

  it('limit=1 拿到的是**最新**那則——不是 limit=2 的第 0 則', () => {
    const two = buildWidgetLines(messages, 'conv-1', [])
    const one = buildWidgetLines(messages, 'conv-1', [], 1)
    expect(one.map((l) => l.messageId)).toEqual(['m3'])
    // 這條就是矮版小工具不能拿 limit=2 的結果取第一個來用的原因
    expect(one[0].messageId).not.toBe(two[0].messageId)
  })

  it('跳過使用者訊息與空白內容', () => {
    const lines = buildWidgetLines(messages, 'conv-1', [], 4)
    expect(lines.some((l) => l.messageId === 'm1')).toBe(false)
    expect(lines.some((l) => l.messageId === 'm4')).toBe(false)
  })

  it('emotionOverride 優先於 emotion', () => {
    const lines = buildWidgetLines(
      [msg({ id: 'x', characterId: 'char-a', emotion: 'joy', emotionOverride: 'anger', timestamp: 9 })],
      'conv-1',
      []
    )
    expect(lines[0].emotion).toBe('anger')
  })

  const pin: PinnedWidgetMessage = {
    messageId: 'pinned-1',
    conversationId: 'conv-other',
    text: '釘選的一句',
    characterId: 'char-z',
    characterName: '別的對話的角色',
    emotion: 'smile',
    pinnedAt: 1
  }

  it('釘選的排在前面，剩下的格子用最新對話補滿', () => {
    const lines = buildWidgetLines(messages, 'conv-1', [pin])
    expect(lines.map((l) => l.messageId)).toEqual(['pinned-1', 'm3'])
    expect(lines[0].pinned).toBe(true)
    expect(lines[1].pinned).toBe(false)
  })

  it('釘選帶著自己的 conversationId（可能來自別的對話）', () => {
    const lines = buildWidgetLines(messages, 'conv-1', [pin])
    expect(lines[0].conversationId).toBe('conv-other')
    expect(lines[1].conversationId).toBe('conv-1')
  })

  it('釘選的剛好就是最新那一則時，第二格不會重複顯示同一句', () => {
    const pinLatest: PinnedWidgetMessage = { ...pin, messageId: 'm3', conversationId: 'conv-1', text: '第二位角色' }
    const lines = buildWidgetLines(messages, 'conv-1', [pinLatest])
    expect(lines.map((l) => l.messageId)).toEqual(['m3', 'm2'])
  })

  it('釘選的順序是使用者指定的，**不跟著時間反轉**', () => {
    const older: PinnedWidgetMessage = { ...pin, messageId: 'p-old', text: '先釘的', pinnedAt: 1 }
    const newer: PinnedWidgetMessage = { ...pin, messageId: 'p-new', text: '後釘的', pinnedAt: 2 }
    expect(buildWidgetLines(messages, 'conv-1', [older, newer]).map((l) => l.messageId))
      .toEqual(['p-old', 'p-new'])
  })

  it('釘滿兩則時完全不補最新對話', () => {
    const second: PinnedWidgetMessage = { ...pin, messageId: 'pinned-2', text: '第二句' }
    const lines = buildWidgetLines(messages, 'conv-1', [pin, second])
    expect(lines.map((l) => l.messageId)).toEqual(['pinned-1', 'pinned-2'])
  })

  it('沒對話也沒釘選時回空陣列（原生層顯示「還沒有對話」）', () => {
    expect(buildWidgetLines([], null, [])).toEqual([])
  })

  it('limit 為 0 時回空陣列', () => {
    expect(buildWidgetLines(messages, 'conv-1', [pin], 0)).toEqual([])
  })
})

describe('normalizeWidgetConfig', () => {
  const DEFAULTS = { pinnedMessages: [], showAvatar: true, appearance: { theme: null, bgOpacity: 100 } }

  it('沒有檔案（null）時給預設值：不釘選、顯示頭像、跟隨 App 配色且不透明', () => {
    expect(normalizeWidgetConfig(null)).toEqual(DEFAULTS)
  })

  it('改版前那個以 characterId 為 key 的舊格式會安靜地退回預設值', () => {
    const legacy = { 'char-a': { pinnedMessages: [{ messageId: 'm1', text: '舊的' }] } }
    expect(normalizeWidgetConfig(legacy)).toEqual(DEFAULTS)
  })

  it('底色透明度夾在 0–100 並取整', () => {
    expect(normalizeWidgetConfig({ appearance: { bgOpacity: -5 } }).appearance.bgOpacity).toBe(0)
    expect(normalizeWidgetConfig({ appearance: { bgOpacity: 999 } }).appearance.bgOpacity).toBe(100)
    expect(normalizeWidgetConfig({ appearance: { bgOpacity: 37.4 } }).appearance.bgOpacity).toBe(37)
  })

  it('showAvatar 只有明確 false 才算關閉（缺欄位＝開）', () => {
    expect(normalizeWidgetConfig({ pinnedMessages: [] }).showAvatar).toBe(true)
    expect(normalizeWidgetConfig({ pinnedMessages: [], showAvatar: false }).showAvatar).toBe(false)
  })

  it('丟掉形狀不對的釘選，並截到上限兩則', () => {
    const raw = {
      pinnedMessages: [
        { messageId: 'a', text: '一', conversationId: 'c', pinnedAt: 1 },
        null,
        { messageId: 'b', text: '二', conversationId: 'c', pinnedAt: 2 },
        { messageId: 'c', text: '三', conversationId: 'c', pinnedAt: 3 }
      ]
    }
    expect(normalizeWidgetConfig(raw).pinnedMessages.map((p) => p.messageId)).toEqual(['a', 'b'])
  })
})

describe('hasDistinctSpeakers', () => {
  const line = (characterId?: string): Parameters<typeof hasDistinctSpeakers>[0][number] => ({
    text: '哈囉',
    characterId,
    pinned: false
  })

  it('兩則不同角色 → true（各自顯示頭像與名字）', () => {
    expect(hasDistinctSpeakers([line('a'), line('b')])).toBe(true)
  })

  it('同一個角色連講兩句 → false（共用一張臉）', () => {
    expect(hasDistinctSpeakers([line('a'), line('a')])).toBe(false)
  })

  it('只有一則 → false', () => {
    expect(hasDistinctSpeakers([line('a')])).toBe(false)
  })

  it('任一則沒有 characterId → false（沒有身分可標，分兩欄只會多一塊空白）', () => {
    expect(hasDistinctSpeakers([line('a'), line(undefined)])).toBe(false)
    expect(hasDistinctSpeakers([line(undefined), line('b')])).toBe(false)
  })
})

describe('isPinnedMessage', () => {
  const pins: PinnedWidgetMessage[] = [
    { messageId: 'm1', conversationId: 'c', text: '一', pinnedAt: 1 }
  ]
  it('釘過的回 true、沒釘過的回 false', () => {
    expect(isPinnedMessage(pins, 'm1')).toBe(true)
    expect(isPinnedMessage(pins, 'm2')).toBe(false)
  })
})
