/**
 * Lorebook 注入預覽（B2.5 的手動驗證工具）。
 *
 * B2.5 是純 core、零呼叫端，聊天流程還沒接上（那是 B2.6）。
 * 這支讓 owner 現在就能看見「如果接上去，prompt 會多出什麼」：
 * 讀 `scripts/lore-preview-input.json`，印出哪些條目被觸發、為什麼、
 * 以及最終那段 `[Glossary]` 的**逐字內容**。
 *
 * 不需要 API Key、不連網、不碰真實資料。用法見 `scripts/README-lore-preview.md`。
 */

import * as fs from 'fs'
import * as path from 'path'
import { importStLorebook } from '../src/core/lore/stLorebook'
import { buildScanText, matchesEntry, selectLoreEntries, resolveScanDepth, entryCost } from '../src/core/lore/scan'
import { formatLoreBlock } from '../src/core/lore/format'
import type { LoreEntry } from '../src/core/lore/types'

// bundle 後 __dirname 會變成專案根目錄，故以 cwd 為準（指令固定在專案根目錄跑）
const inputPath = path.join(process.cwd(), 'scripts', 'lore-preview-input.json')
const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'))

const book = importStLorebook(input.lorebook, { id: 'preview', now: 0 })
const books = [book]

const scanDepth = resolveScanDepth(books)
const scanText = buildScanText({
  summary: input.summary,
  recentContents: input.recentContents,
  currentInput: input.currentInput
}, scanDepth)

const selected = selectLoreEntries(books, scanText)
const picked = new Set(selected.map(e => e.id))

function why(entry: LoreEntry): string {
  if (!entry.enabled) return '未啟用'
  if (entry.constant) return '常駐（不需被提到）'
  const hit = (entry.keys ?? []).filter(k => {
    const t = entry.case_sensitive ? scanText : scanText.toLowerCase()
    return k.trim() && t.includes(entry.case_sensitive ? k : k.toLowerCase())
  })
  if (hit.length === 0) return '關鍵字都沒被提到'
  if (!matchesEntry(entry, scanText)) return `命中「${hit.join('、')}」，但 secondary_keys 沒同時命中`
  const base = `命中關鍵字「${hit.join('、')}」`
  return picked.has(entry.id) ? base : `${base}，但超出預算被砍掉`
}

console.log('=== 掃描文字（scan_depth = ' + scanDepth + '，只取最近 ' + scanDepth + ' 則）===')
console.log(scanText)
console.log()

console.log('=== 逐條判定 ===')
for (const entry of book.entries) {
  const mark = picked.has(entry.id) ? '✅' : '⬜'
  console.log(`${mark} [${entry.keys.join(' / ') || '(無關鍵字)'}] ${why(entry)}`)
}
console.log()

const total = selected.reduce((s, e) => s + entryCost(e), 0)
console.log(`=== 實際會注入 prompt 的內容（${total} 字元 / 上限 ${book.token_budget}）===`)
const block = formatLoreBlock(selected)
console.log(block || '(沒有任何條目被觸發 → prompt 完全不受影響，連 [Glossary] 標籤都不會出現)')
