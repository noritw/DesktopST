import { chatWithLLM, applyUtilitySettings } from '../llm/index'
import type { LLMDeps } from '../llm/deps'
import type { AppSettings } from '../types'
import type { LoreEntry } from './types'

/**
 * 從角色卡自動生成一條用語解說（規格 `docs/future-lorebook.md` §8）。
 *
 * ⚠️ 本檔含刻意寫死的 prompt 指令字串（英文指令 + 要求輸出繁中），非 UI 文案。
 *    依 roadmap §3.3 例外條款保留。
 *
 * **LLM 只產生 `content` 一句話**；`keys` 由呼叫端用角色 `name` ＋ `nicknames` 填入 ——
 * 出錯面縮到最小，LLM 不決定觸發條件，只決定描述文字。
 *
 * 產出是**一次性快照，不與角色卡連動**：之後就是一條普通的可編輯條目。
 */

const LORE_ENTRY_INSTRUCTIONS =
  'You write one-line glossary entries so a roleplay character can understand who a person is when their name comes up.\n' +
  'Given a character profile, write ONE sentence describing them objectively: who they are, their role or relationship, and one key personality trait.\n' +
  'Objective facts first. Do not write in first person, do not address anyone, do not add opinions or flourishes.\n' +
  'Write in Traditional Chinese (Taiwan usage), under 40 characters.\n' +
  'Output the sentence only — no name prefix, no quotes, no explanations.'

/** 生成輸出的 token 上限（一句話而已）。 */
const LORE_ENTRY_MAX_TOKENS = 200

/** 生成條目時要餵給模型的角色資料（呼叫端從 `Character` 摘出來）。 */
export interface LoreEntrySourceCharacter {
  name: string
  nicknames?: string[]
  description?: string
  personality?: string
  scenario?: string
}

/** 條目的預設值（規格 §8.2）：人名偶爾提到，靠關鍵字觸發即可，不必常駐吃 token。 */
export const GENERATED_ENTRY_DEFAULTS = { constant: false, enabled: true } as const

/** 角色的觸發關鍵字＝名字 ＋ 暱稱（去空白、去重）。 */
export function loreKeysForCharacter(char: LoreEntrySourceCharacter): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [char.name, ...(char.nicknames ?? [])]) {
    const k = (raw ?? '').trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * 呼叫輔助模型產生條目內容。
 *
 * 回傳 `null` 代表沒有可用素材或模型吐空 —— 呼叫端據此**靜默略過，不擋匯入流程**（§8.2）。
 * 拋出的例外（無 API Key／逾時）同樣由呼叫端吞掉。
 */
export async function generateLoreEntryForCharacter(params: {
  settings: AppSettings
  character: LoreEntrySourceCharacter
}, deps: LLMDeps): Promise<Pick<LoreEntry, 'keys' | 'content' | 'constant' | 'enabled'> | null> {
  const { settings, character } = params

  const profile = [
    `Name: ${character.name}`,
    character.nicknames?.length ? `Also known as: ${character.nicknames.join(', ')}` : '',
    character.description?.trim() ? `Description: ${character.description.trim()}` : '',
    character.personality?.trim() ? `Personality: ${character.personality.trim()}` : '',
    character.scenario?.trim() ? `Scenario: ${character.scenario.trim()}` : ''
  ].filter(Boolean).join('\n')

  const keys = loreKeysForCharacter(character)
  if (keys.length === 0) return null

  const utilitySettings = applyUtilitySettings(settings)
  const result = await chatWithLLM({
    settings: {
      ...utilitySettings,
      llm: { ...utilitySettings.llm, maxResponseTokens: LORE_ENTRY_MAX_TOKENS }
    },
    character: { id: '__lore_writer__', name: 'glossary', personality: LORE_ENTRY_INSTRUCTIONS, emotions: {} },
    messages: [{ id: '__lore', role: 'user', content: profile, timestamp: Date.now() }],
    persona: null,
    world: null,
    desktopCharacterNames: [],
    isReminder: true,
    minimal: true
  }, deps)

  const content = result.content.trim()
  if (!content) return null
  return { keys, content, ...GENERATED_ENTRY_DEFAULTS }
}
