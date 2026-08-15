import { describe, expect, it } from 'vitest'
import {
  applyConvPreset,
  convActionFor,
  countConvPlan,
  defaultConvChoice,
  defaultConvChoices,
  defaultConvFieldChoices,
  hasFieldWork,
  pairConversations,
  type ConvEntity,
  type ConvRow
} from '../../../src/core/sync/convPair'
import { mergeMessages, messageIdsHash, pickSummary, summaryHash } from '../../../src/core/sync/convHash'

const conv = (over: Partial<ConvEntity> & { id: string }): ConvEntity => ({
  title: '對話',
  updatedAt: 1000,
  messageCount: 0,
  ...over
})

const msg = (id: string, timestamp: number, content = ''): { id: string; timestamp: number; content: string } => ({
  id,
  timestamp,
  content
})

describe('pairConversations', () => {
  it('id 相同配成一列', () => {
    const rows = pairConversations([conv({ id: 'a' })], [conv({ id: 'a' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.localId).toBe('a')
    expect(rows[0]!.remoteId).toBe('a')
  })

  /*
   * 這是整個對話同步最關鍵的一條測試。
   *
   * S1 匯入進來的對話，本地 id 是手機自己發的，跟電腦端那則完全不同；
   * 只有 `importedFrom.sourceId`（＝這裡的 `linkedRemoteId`）記得它們是同一則。
   * 少了這一步配對，每一則匯入過的對話都會被判成「手機獨有」而再推一份回電腦
   * ——S2 M3 重複增生的失敗模式原封不動重演。
   */
  it('S1 匯入過的對話靠 linkedRemoteId 配成一列，不會變成兩列', () => {
    const local = conv({ id: 'phone-1', linkedRemoteId: 'pc-1', title: '週末的冒險' })
    const remote = conv({ id: 'pc-1', title: '週末的冒險' })
    const rows = pairConversations([local], [remote])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.localId).toBe('phone-1')
    expect(rows[0]!.remoteId).toBe('pc-1')
  })

  it('linkedRemoteId 即使標題兩邊都被改過也仍配得起來', () => {
    const local = conv({ id: 'phone-1', linkedRemoteId: 'pc-1', title: '手機上改的名字' })
    const remote = conv({ id: 'pc-1', title: '電腦上改的名字' })
    const rows = pairConversations([local], [remote])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.remoteTitle).toBe('電腦上改的名字')
    // 標題不同 → 長出一個單值欄位的衝突子列
    expect(rows[0]!.conflicts.map((c) => c.field)).toEqual(['title'])
  })

  it('標題配對是最後手段，同名多筆時依 updatedAt 由新到舊配對', () => {
    const rows = pairConversations(
      [conv({ id: 'l1', title: '新對話', updatedAt: 200 }), conv({ id: 'l2', title: '新對話', updatedAt: 100 })],
      [conv({ id: 'r1', title: '新對話', updatedAt: 900 }), conv({ id: 'r2', title: '新對話', updatedAt: 800 })]
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => [r.localId, r.remoteId])).toEqual([
      ['l1', 'r1'],
      ['l2', 'r2']
    ])
  })

  it('單邊獨有的各自成一列', () => {
    const rows = pairConversations([conv({ id: 'l', title: '只有手機' })], [conv({ id: 'r', title: '只有電腦' })])
    expect(rows).toHaveLength(2)
    expect(rows[0]!.remoteId).toBeUndefined()
    expect(rows[1]!.localId).toBeUndefined()
  })

  it('訊息指紋相同時 compare 是 same，不同時是 differs', () => {
    const h1 = messageIdsHash([msg('m1', 1), msg('m2', 2)])
    const h2 = messageIdsHash([msg('m1', 1), msg('m3', 3)])
    const same = pairConversations(
      [conv({ id: 'a', messageIdsHash: h1 })],
      [conv({ id: 'a', messageIdsHash: h1 })]
    )
    const diff = pairConversations(
      [conv({ id: 'a', messageIdsHash: h1 })],
      [conv({ id: 'a', messageIdsHash: h2 })]
    )
    expect(same[0]!.compare).toBe('same')
    expect(diff[0]!.compare).toBe('differs')
  })

  it('舊版電腦端沒有指紋時退化成 unknown，不當機', () => {
    const rows = pairConversations([conv({ id: 'a', messageIdsHash: 'x' })], [conv({ id: 'a' })])
    expect(rows[0]!.compare).toBe('unknown')
  })

  it('摘要涵蓋範圍不同時不算衝突（有客觀答案，不打擾使用者）', () => {
    const rows = pairConversations(
      [conv({ id: 'a', summaryHash: 'h1', summaryCoversTs: 100 })],
      [conv({ id: 'a', summaryHash: 'h2', summaryCoversTs: 200 })]
    )
    expect(rows[0]!.conflicts).toEqual([])
  })

  it('摘要涵蓋範圍相同但內容不同時才算衝突', () => {
    const rows = pairConversations(
      [conv({ id: 'a', summaryHash: 'h1', summaryCoversTs: 100 })],
      [conv({ id: 'a', summaryHash: 'h2', summaryCoversTs: 100 })]
    )
    expect(rows[0]!.conflicts.map((c) => c.field)).toEqual(['summary'])
  })
})

describe('預設決定', () => {
  it('兩邊都有且訊息不同 → merge；相同 → keep；單邊獨有 → copy', () => {
    expect(defaultConvChoice({ key: 'k', title: 't', localId: 'a', remoteId: 'b', compare: 'differs', conflicts: [] })).toBe('merge')
    expect(defaultConvChoice({ key: 'k', title: 't', localId: 'a', remoteId: 'b', compare: 'same', conflicts: [] })).toBe('keep')
    expect(defaultConvChoice({ key: 'k', title: 't', localId: 'a', conflicts: [] })).toBe('copy')
    expect(defaultConvChoice({ key: 'k', title: 't', remoteId: 'b', conflicts: [] })).toBe('copy')
  })

  it('單值欄位預設一律不動，不替使用者決定標題要用哪個', () => {
    const rows = pairConversations(
      [conv({ id: 'phone', linkedRemoteId: 'pc', title: '甲' })],
      [conv({ id: 'pc', title: '乙' })]
    )
    expect(defaultConvFieldChoices(rows)).toEqual({ 'L:phone': { title: 'keep' } })
  })
})

describe('convActionFor', () => {
  const both = (compare: ConvRow['compare']): ConvRow => ({
    key: 'k',
    title: 't',
    localId: 'a',
    remoteId: 'b',
    compare,
    conflicts: []
  })

  it('keep 一律不做事', () => {
    expect(convActionFor(both('differs'), 'keep')).toBe('none')
  })

  it('merge 只在訊息真的不同時才動', () => {
    expect(convActionFor(both('differs'), 'merge')).toBe('merge')
    expect(convActionFor(both('same'), 'merge')).toBe('none')
    // 指紋算不出來時保守地跑一趟合併——合併本身是冪等的，重跑不會有副作用
    expect(convActionFor(both('unknown'), 'merge')).toBe('merge')
  })

  it('單邊獨有選 copy 就是整則推或整則拉', () => {
    expect(convActionFor({ key: 'k', title: 't', localId: 'a', conflicts: [] }, 'copy')).toBe('push')
    expect(convActionFor({ key: 'k', title: 't', remoteId: 'b', conflicts: [] }, 'copy')).toBe('pull')
  })
})

describe('快捷鍵', () => {
  /*
   * 對話分頁刻意只有兩顆。「全部用手機／電腦」的語意是「用這一邊蓋掉另一邊」，
   * 套在聯集合併上等於每按一次就丟掉對面獨有的訊息——而使用者會以為自己
   * 選了一個安全的選項。這條測試守的是「不存在那種按鈕」這個規格。
   */
  it('「全部」＝回到預設（合併／補齊），「都不動」＝全部 keep', () => {
    const rows = pairConversations(
      [conv({ id: 'a', messageIdsHash: 'h1' }), conv({ id: 'only-l', title: '只有手機' })],
      [conv({ id: 'a', messageIdsHash: 'h2' })]
    )
    expect(applyConvPreset(rows, 'all')).toEqual({ 'L:a': 'merge', 'L:only-l': 'copy' })
    expect(applyConvPreset(rows, 'none')).toEqual({ 'L:a': 'keep', 'L:only-l': 'keep' })
  })

  it('快捷鍵不會產生任何刪除動作（這個分頁不刪東西）', () => {
    const rows = pairConversations([conv({ id: 'l' })], [conv({ id: 'r', title: '電腦獨有' })])
    for (const preset of ['all', 'none'] as const) {
      const choices = applyConvPreset(rows, preset)
      for (const row of rows) {
        expect(['none', 'merge', 'push', 'pull']).toContain(convActionFor(row, choices[row.key]!))
      }
    }
  })
})

describe('countConvPlan', () => {
  it('分別數合併／推／拉／不動', () => {
    const rows = pairConversations(
      [
        conv({ id: 'a', messageIdsHash: 'h1' }),
        conv({ id: 'b', messageIdsHash: 'same' }),
        conv({ id: 'only-l', title: '只有手機' })
      ],
      [conv({ id: 'a', messageIdsHash: 'h2' }), conv({ id: 'b', messageIdsHash: 'same' }), conv({ id: 'only-r', title: '只有電腦' })]
    )
    const counts = countConvPlan(rows, defaultConvChoices(rows))
    expect(counts).toMatchObject({ merge: 1, push: 1, pull: 1, untouched: 1 })
  })

  it('訊息相同但標題被選了一邊時，仍算成一件要做的事', () => {
    const rows = pairConversations(
      [conv({ id: 'phone', linkedRemoteId: 'pc', title: '甲', messageIdsHash: 'h' })],
      [conv({ id: 'pc', title: '乙', messageIdsHash: 'h' })]
    )
    expect(rows[0]!.compare).toBe('same')
    const fieldChoices = { 'L:phone': { title: 'local' as const } }
    expect(hasFieldWork(rows[0]!, fieldChoices)).toBe(true)
    expect(countConvPlan(rows, defaultConvChoices(rows), fieldChoices).fieldEdits).toBe(1)
  })
})

describe('mergeMessages', () => {
  it('以 id 聯集，已存在的略過並計進 skipped', () => {
    const base = [msg('m1', 1), msg('m2', 2)]
    const incoming = [msg('m2', 2), msg('m3', 3)]
    const r = mergeMessages(base, incoming)
    expect(r.merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(r.written).toBe(1)
    expect(r.skipped).toBe(1)
  })

  /*
   * §6.2 ② 規則 2：同 id 內容不同＝接收端保留自己那份。
   * 不做欄位級合併，也不做逐則挑選。
   */
  it('同一個 id 內容不同時保留接收端那份', () => {
    const r = mergeMessages([msg('m1', 1, '電腦上編輯過')], [msg('m1', 1, '手機上的原文')])
    expect(r.merged).toHaveLength(1)
    expect(r.merged[0]!.content).toBe('電腦上編輯過')
    expect(r.skipped).toBe(1)
  })

  it('合併後按 timestamp 重排', () => {
    const r = mergeMessages([msg('a', 30), msg('b', 10)], [msg('c', 20)])
    expect(r.merged.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  /*
   * 時間戳相同時要有穩定的 tiebreak，否則兩台裝置排出來的順序不一樣：
   * 集合相同、指紋也相同（指紋是排序後算的），但使用者在兩邊看到的
   * 對話順序不同，而且完全沒有任何訊號會提示這件事。
   */
  it('時間戳相同時用 id 當穩定 tiebreak，兩邊排出來的順序一致', () => {
    const a = mergeMessages([msg('zz', 5)], [msg('aa', 5)]).merged.map((m) => m.id)
    const b = mergeMessages([msg('aa', 5)], [msg('zz', 5)]).merged.map((m) => m.id)
    expect(a).toEqual(['aa', 'zz'])
    expect(a).toEqual(b)
  })

  it('空的 incoming 不改變任何東西', () => {
    const base = [msg('m1', 1)]
    const r = mergeMessages(base, [])
    expect(r.merged.map((m) => m.id)).toEqual(['m1'])
    expect(r.written).toBe(0)
  })
})

describe('messageIdsHash', () => {
  it('順序不同但集合相同時雜湊一樣', () => {
    expect(messageIdsHash([msg('a', 1), msg('b', 2)])).toBe(messageIdsHash([msg('b', 2), msg('a', 1)]))
  })

  it('內容不同不影響雜湊（只看 id）', () => {
    expect(messageIdsHash([msg('a', 1, '甲')])).toBe(messageIdsHash([msg('a', 9, '乙')]))
  })

  it('集合不同時雜湊不同', () => {
    expect(messageIdsHash([msg('a', 1)])).not.toBe(messageIdsHash([msg('a', 1), msg('b', 2)]))
  })
})

describe('pickSummary', () => {
  it('內容相同 → equal', () => {
    expect(pickSummary({ summary: '一樣' }, { summary: '一樣' })).toBe('equal')
  })

  it('只有一邊有摘要 → 有的那邊贏', () => {
    expect(pickSummary({ summary: '' }, { summary: '有' })).toBe('incoming')
    expect(pickSummary({ summary: '有' }, { summary: '' })).toBe('base')
  })

  /*
   * ⚠️ 這裡刻意不看 `updatedAt`：那是寫檔時間，推送本身就會把接收端設成現在，
   * 用它判斷永遠是對面比較新（`mobile-sync-m4-compare.md` §2.2）。
   * `summaryCoversTs` 從訊息時間戳推導，跨裝置可比。
   */
  it('涵蓋範圍較大的那份贏', () => {
    expect(pickSummary({ summary: '舊', summaryCoversTs: 100 }, { summary: '新', summaryCoversTs: 200 })).toBe('incoming')
    expect(pickSummary({ summary: '新', summaryCoversTs: 200 }, { summary: '舊', summaryCoversTs: 100 })).toBe('base')
  })

  it('涵蓋範圍相同但內容不同 → ambiguous（要問使用者）', () => {
    expect(pickSummary({ summary: '甲', summaryCoversTs: 100 }, { summary: '乙', summaryCoversTs: 100 })).toBe('ambiguous')
  })

  it('summaryHash 對空白與 undefined 一視同仁', () => {
    expect(summaryHash(undefined)).toBe('')
    expect(summaryHash('   ')).toBe('')
  })
})
