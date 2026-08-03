import type { OmikujiTier, RandomResult, PendingRandomTool } from '../types'

/**
 * 隨機工具（御神籤／擲筊／硬幣／骰子）的擲出邏輯 —— **單一真相**。
 *
 * 搬進 core 之前，同一套機率表存在三份實作：
 *   `renderer/utils/randomTools.ts`／`main/mobileServer.ts`／`assets/mobile.html`，
 * 且三份的權重**已經長歪**（見 `docs/mobile-html-feature-inventory.md` §4）。
 * 本檔以桌面版（renderer）那份為準，逐字沿用。
 *
 * ⚠️ 中文字串（籤詩等第、筊象、正反面）是**資料值**不是 UI 文案 ——
 * 它們會存進 `RandomResult` 並直接進入訊息內容與 prompt，兩端必須完全一致，
 * 因此不適用 roadmap §3.3「UI 文案不得進 core」那條。
 * 顯示用的 emoji 與徽章措辭留在各自的 UI 層。
 */

const OMIKUJI_TIERS: [OmikujiTier, number][] = [
  ['大吉', 12], ['中吉', 18], ['小吉', 20], ['吉', 22], ['末吉', 15], ['凶', 10], ['大凶', 3]
]

const JIAO_TIERS: ['聖筊' | '笑筊' | '陰筊', number][] = [
  ['聖筊', 40], ['笑筊', 30], ['陰筊', 30]
]

function weightedPick<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [item, w] of items) {
    r -= w
    if (r <= 0) return item
  }
  return items[items.length - 1][0]
}

export function computeRandomResult(pending: PendingRandomTool): RandomResult {
  switch (pending.tool) {
    case 'omikuji':
      return { tool: 'omikuji', result: weightedPick(OMIKUJI_TIERS) }
    case 'jiao': {
      const result = weightedPick<'聖筊' | '笑筊' | '陰筊'>(JIAO_TIERS)
      return { tool: 'jiao', result }
    }
    case 'coin': {
      const result: '正面' | '反面' = Math.random() < 0.5 ? '正面' : '反面'
      return { tool: 'coin', result }
    }
    case 'dice': {
      const faces = pending.faces ?? 6
      const count = pending.count ?? 1
      const modifier = pending.modifier ?? 0
      const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1)
      // Keep Highest / Keep Lowest
      let kept: number[]
      if (pending.keepHighest != null && pending.keepHighest < count) {
        kept = [...rolls].sort((a, b) => b - a).slice(0, pending.keepHighest)
      } else if (pending.keepLowest != null && pending.keepLowest < count) {
        kept = [...rolls].sort((a, b) => a - b).slice(0, pending.keepLowest)
      } else {
        kept = rolls
      }
      const rollSum = kept.reduce((s, r) => s + r, 0)
      return { tool: 'dice', faces, count, rolls, kept, keepHighest: pending.keepHighest, keepLowest: pending.keepLowest, modifier, total: rollSum + modifier }
    }
  }
}

/** 骰式表示法，例如 `2d6+3`、`4d6kh3`。純記號，無語系相依。 */
export function diceNotation(pending: PendingRandomTool): string {
  if (pending.tool !== 'dice') return ''
  const count = pending.count ?? 1
  const faces = pending.faces ?? 6
  const mod = pending.modifier ?? 0
  const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''
  const khStr = pending.keepHighest != null ? `kh${pending.keepHighest}` : ''
  const klStr = pending.keepLowest != null ? `kl${pending.keepLowest}` : ''
  return `${count}d${faces}${khStr}${klStr}${modStr}`
}

/** `+3` / `-2` / 空字串。結果格式化共用。 */
export function modifierString(mod: number): string {
  return mod > 0 ? `+${mod}` : mod < 0 ? String(mod) : ''
}

/** dice 的取捨後點數；沒有 kh/kl 時就是全部。 */
export function keptRolls(result: Extract<RandomResult, { tool: 'dice' }>): number[] {
  return result.kept ?? result.rolls
}

/**
 * 把**外部來源**（HTTP 請求等）的參數夾到安全範圍內。
 *
 * `computeRandomResult` 蓄意不做這件事 —— UI 送進來的值已受表單限制，
 * 多一層夾擠只會讓桌面與手機的行為變得難以推理。
 * 但 HTTP 端點收的是任意 JSON，`count: 1e9` 會讓 process 當場卡死，
 * 所以在信任邊界上呼叫這支，而不是把防禦塞進核心算式。
 */
export function sanitizePendingRandomTool(
  tool: string,
  params: Record<string, number | undefined>
): PendingRandomTool | null {
  if (tool === 'omikuji' || tool === 'jiao' || tool === 'coin') {
    return { tool }
  }
  if (tool !== 'dice') return null
  const clampInt = (v: number | undefined, min: number, max: number, fallback: number): number => {
    const n = Math.floor(Number(v))
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
  }
  const count = clampInt(params.count, 1, 20, 1)
  const pending: PendingRandomTool = {
    tool: 'dice',
    faces: clampInt(params.faces, 2, 1000, 6),
    count,
    modifier: clampInt(params.modifier, -1000, 1000, 0)
  }
  if (params.keepHighest != null) pending.keepHighest = clampInt(params.keepHighest, 1, count, 1)
  if (params.keepLowest != null) pending.keepLowest = clampInt(params.keepLowest, 1, count, 1)
  return pending
}
