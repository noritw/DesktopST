/**
 * 模型停用日期表：到期前通知、到期日自動換成替代型號。
 *
 * 桌面與手機共用，純函式不碰 I/O。日期寫在程式裡，所以到期會自己換，
 * 不必趕在停用前發版；只有官方改日期或公告新型號時才要回來更新。
 */
import type { AppSettings } from '../types'

type Llm = AppSettings['llm']
type Provider = Llm['provider']

interface ModelRetirement {
  provider: Provider
  ids: string[]
  /** 官方停用日（YYYY-MM-DD） */
  date: string
  replacement: string
  /**
   * 到期是否自動換。`false` ＝ 官方只給「最早可能日期」，或公告裡只列了帶日期的快照、
   * 沒有明講別名會不會一起關——自動換掉可能還能用的型號比不換更糟，只通知。
   */
  autoSwitch: boolean
}

/**
 * 來源（2026-11-24 逐條核對）：
 * https://developers.openai.com/api/docs/deprecations
 * https://aistudio.google.com/docs/deprecations
 * Claude 與 Grok 目前清單內的型號都沒有公告停用日。
 */
export const MODEL_RETIREMENTS: ModelRetirement[] = [
  {
    provider: 'openai', date: '2026-12-11', replacement: 'gpt-6.1-sol', autoSwitch: true,
    ids: ['gpt-5', 'gpt-5-2025-08-07', 'gpt-5-pro', 'gpt-5-pro-2025-10-06', 'o3', 'o3-2025-04-16', 'o3-pro', 'o3-pro-2025-06-10']
  },
  {
    provider: 'openai', date: '2026-12-11', replacement: 'gpt-6.1-terra', autoSwitch: true,
    ids: ['gpt-5-mini', 'gpt-5-mini-2025-08-07']
  },
  {
    provider: 'openai', date: '2026-12-11', replacement: 'gpt-6-luna', autoSwitch: true,
    ids: ['gpt-5-nano', 'gpt-5-nano-2025-08-07']
  },
  {
    provider: 'openai', date: '2027-01-14', replacement: 'gpt-6-luna', autoSwitch: true,
    ids: ['gpt-4o-2024-08-06', 'gpt-4o-2024-11-20', 'gpt-4o-mini-2024-07-18', 'gpt-4.1-2025-04-14', 'gpt-4.1-mini-2025-04-14']
  },
  {
    // 官方這幾列只寫了帶日期的快照，沒提別名
    provider: 'openai', date: '2027-01-14', replacement: 'gpt-6-luna', autoSwitch: false,
    ids: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini']
  },
  {
    provider: 'openai', date: '2027-04-01', replacement: 'gpt-6-luna', autoSwitch: true,
    ids: ['gpt-5.4-nano', 'gpt-5.4-nano-2026-03-17']
  },
  {
    provider: 'openai', date: '2027-04-01', replacement: 'gpt-6-sol', autoSwitch: true,
    ids: ['gpt-5.1', 'gpt-5.1-2025-11-13']
  },
  {
    // Google 給的是「最早可能日期」
    provider: 'gemini', date: '2027-05-07', replacement: 'gemini-3.5-flash-lite', autoSwitch: false,
    ids: ['gemini-3.1-flash-lite']
  }
]

export const EARLY_NOTICE_DAYS = 60
export const FINAL_NOTICE_DAYS = 7

const OFFICIAL_HOSTS: Partial<Record<Provider, string>> = {
  openai: 'api.openai.com',
  claude: 'api.anthropic.com',
  gemini: 'generativelanguage.googleapis.com',
  grok: 'api.x.ai'
}

function findRetirement(provider: string, model: string | undefined): ModelRetirement | undefined {
  return model ? MODEL_RETIREMENTS.find(r => r.provider === provider && r.ids.includes(model)) : undefined
}

/** 自訂／轉接端點的型號生死由對方決定，官方停用日不適用。 */
function usesOfficialEndpoint(llm: Llm, provider: Provider): boolean {
  const endpoint = llm.endpoints?.[provider]?.trim()
  if (!endpoint) return true
  try {
    return new URL(endpoint).hostname === OFFICIAL_HOSTS[provider]
  } catch {
    return false
  }
}

/** 距離停用日幾天（以裝置當地日期計，當天＝0、過期為負）。 */
function daysUntil(date: string, now: number): number {
  const [y, m, d] = date.split('-').map(Number)
  const n = new Date(now)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86_400_000)
}

/** 已過停用日、會被自動換掉的型號（下拉清單用來隱藏）。 */
export function isModelRetired(provider: string, model: string, now = Date.now()): boolean {
  const r = findRetirement(provider, model)
  return !!r && r.autoSwitch && daysUntil(r.date, now) <= 0
}

export type ModelSlot = 'main' | 'utility'

interface SlotGroup {
  provider: Provider
  model: string
  slots: ModelSlot[]
}

/** 目前真的在用的型號；主／輔助同一顆時併成一筆，不要跳兩次。 */
function activeGroups(llm: Llm): SlotGroup[] {
  const main = llm.models?.[llm.provider] || llm.model || ''
  const groups: SlotGroup[] = [{ provider: llm.provider, model: main, slots: ['main'] }]
  if (llm.utilityEnabled) {
    const provider = llm.utilityProvider ?? llm.provider
    const model = llm.utilityModels?.[provider] ?? ''
    if (provider === llm.provider && model === main) groups[0].slots.push('utility')
    else groups.push({ provider, model, slots: ['utility'] })
  }
  return groups
}

/** 把某家的某型號全部換掉（主模型、輔助模型、遺留的 `llm.model` 鏡像）。就地修改。 */
export function replaceModel(llm: Llm, provider: Provider, from: string, to: string): void {
  // 早期設定只有 `llm.model`、沒有 models 表，這時它就是生效中的主模型
  const isActiveMain = llm.provider === provider && (llm.models?.[provider] || llm.model) === from
  if (isActiveMain || llm.models?.[provider] === from) llm.models = { ...llm.models, [provider]: to }
  if (isActiveMain) llm.model = to
  if (llm.utilityModels?.[provider] === from) llm.utilityModels = { ...llm.utilityModels, [provider]: to }
}

/**
 * 把已到停用日的型號換成替代型號，並記下「正在用的」那幾個等著通知使用者。
 * 沒在用的供應商也換（之後切過去才不會連不上），但不打擾。就地修改，回傳有沒有動到。
 */
export function applyRetiredModels(llm: Llm, now: number): boolean {
  const active = activeGroups(llm)
  const candidates: SlotGroup[] = [...active]
  for (const map of [llm.models, llm.utilityModels]) {
    for (const [p, model] of Object.entries(map ?? {})) {
      const provider = p as Provider
      if (!candidates.some(c => c.provider === provider && c.model === model)) candidates.push({ provider, model, slots: [] })
    }
  }
  let changed = false
  for (const c of candidates) {
    const r = findRetirement(c.provider, c.model)
    if (!r || !isModelRetired(c.provider, c.model, now) || !usesOfficialEndpoint(llm, c.provider)) continue
    replaceModel(llm, c.provider, c.model, r.replacement)
    if (c.slots.length > 0) {
      llm.modelRetirement = {
        ...llm.modelRetirement,
        switched: [...(llm.modelRetirement?.switched ?? []), { from: c.model, to: r.replacement, slots: c.slots }]
      }
    }
    changed = true
  }
  return changed
}

export interface RetirementNotice {
  key: string
  stage: 'early' | 'final'
  provider: Provider
  from: string
  to: string
  slots: ModelSlot[]
  date: string
  autoSwitch: boolean
}

/** 現在該跳哪些「快停用了」的通知。同一型號每個階段只會跳一次（靠 `markNotified`）。 */
export function pendingRetirementNotices(llm: Llm, now: number): RetirementNotice[] {
  const out: RetirementNotice[] = []
  for (const g of activeGroups(llm)) {
    const r = findRetirement(g.provider, g.model)
    if (!r || !usesOfficialEndpoint(llm, g.provider)) continue
    const days = daysUntil(r.date, now)
    if (days > EARLY_NOTICE_DAYS) continue
    const stage = days <= FINAL_NOTICE_DAYS ? 'final' : 'early'
    // 日期放進 key：官方改期時要重新通知
    const key = `${g.provider}:${g.model}:${r.date}`
    const seen = llm.modelRetirement?.notified?.[key]
    if (seen === 'final' || seen === stage) continue
    out.push({
      key, stage, provider: g.provider, from: g.model, to: r.replacement,
      slots: g.slots, date: r.date, autoSwitch: r.autoSwitch
    })
  }
  return out
}

export function markNotified(llm: Llm, notice: RetirementNotice): void {
  llm.modelRetirement = {
    ...llm.modelRetirement,
    notified: { ...llm.modelRetirement?.notified, [notice.key]: notice.stage }
  }
}

export function clearSwitched(llm: Llm): void {
  llm.modelRetirement = { ...llm.modelRetirement, switched: [] }
}

function slotText(slots: ModelSlot[]): string {
  return slots.map(s => (s === 'main' ? '主模型' : '輔助模型')).join('與')
}

/** 通知文字（桌面與手機共用）。`priceText` 由呼叫端給，避免跟型號目錄互相 import。 */
export function retirementNoticeText(
  n: RetirementNotice,
  priceText: (model: string) => string | null
): { title: string; message: string } {
  const withPrice = (m: string): string => {
    // 帶日期的快照跟別名同價
    const p = priceText(m) ?? priceText(m.replace(/-\d{4}-\d{2}-\d{2}$/, ''))
    return p ? `${m}（${p}）` : m
  }
  const when = n.autoSwitch ? `將於 ${n.date} 停用` : `最快可能在 ${n.date} 停用`
  const after = n.autoSwitch
    ? '現在不換的話，停用當天會自動更換。'
    : '官方還沒有確定時間，所以不會自動更換。'
  return {
    title: '使用中的 AI 模型即將停用',
    message:
      `${slotText(n.slots)}使用的 ${n.from} ${when}，建議改用 ${n.to}。\n\n` +
      `目前：${withPrice(n.from)}\n改用：${withPrice(n.to)}\n（價格為每百萬 tokens 的輸入 / 輸出）\n\n` +
      `換模型後角色的語氣可能會有些不同。${after}`
  }
}

/** 「已自動更換」的通知文字；沒有就回 null。看過後呼叫 `clearSwitched`。 */
export function switchedNoticeText(llm: Llm): { title: string; message: string } | null {
  const list = llm.modelRetirement?.switched ?? []
  if (list.length === 0) return null
  return {
    title: '已更換停用的 AI 模型',
    message:
      list.map(s => `${slotText(s.slots)}：${s.from} 已由官方停用，改用 ${s.to}。`).join('\n') +
      '\n\n想用別的模型，可以到設定裡更換。'
  }
}
