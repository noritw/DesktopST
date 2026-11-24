import { FOE_FORMS, FOE_FORM_IDS, type CharacterFoes, type FoeFormId, type FoeText } from './battle'

/** 角色專屬的敵人：一次寫六個形（`docs/walk-battle-design.md` §3）。 */

/** 少於這個數就視為失敗 */
export const MIN_FOES = 4
/** 六段比一般回覆長；各家實際上限是這個的三倍，含思考用掉的 */
export const FOE_MAX_RESPONSE_TOKENS = 2000

export function buildFoePrompt(leadName: string): string {
  return [
    '[路上的對手]',
    `「${leadName}」陪使用者散步時，會在路上遇到擋路的麻煩東西，想辦法把它趕走。請為「${leadName}」設計六個對手。`,
    '對手的內容要符合角色的世界、職業和日常：會戰鬥或有魔法的角色遇到怪物，現代人遇到工作或生活裡的小麻煩變成的東西。角色有職業就多用職業的題材。',
    '例如工程師會遇到「難解的Bug」，業務會遇到「難搞客戶的怒罵」，魔法師會遇到「打結的魔藤」。例子不要照抄。',
    '角色卡若說自己是程式裡的預設角色，就用它的職業或種族（魔導士、劍士）的世界來想。',
    '',
    '每個對手已經決定好樣子，內容要配得上：',
    ...FOE_FORM_IDS.map((id) => `- ${id}：${FOE_FORMS[id].hint}`),
    '',
    '規則：',
    '- **對手是麻煩本身，不是人**：可以是怪物、東西、現象、聲音、情況。不可以是真人、使用者、其他角色，也不可以是某個人的身分，例如要寫「難搞客戶的怒罵」，不要寫「難搞的客戶」',
    '- 有點好笑、讓人想出一口氣，不要可怕或沉重。不要寫生病、死亡、失業、欠錢、分手、霸凌、自傷、血腥',
    '- 六個要彼此不同，名稱一看就懂，不要硬湊無關的詞',
    `- 台詞是「${leadName}」的口吻，白話，像角色卡，不要打啞謎`,
    '- 大勝：對手乾脆地消失或變乖，讓人痛快，再接角色一句話',
    '- 打跑：對手退開，角色鬆一口氣',
    '- 平手：對手自己走掉或失去興趣，角色輕鬆說一句，像一起坐下休息。不要責備、洩氣、檢討，不要出現「輸、敗、可惜、努力、下次」',
    '- 不要說使用者現實中的問題解決了，不要給建議',
    '- 不要提步數、真實地名、桌面、介面、骰子、物品、幫忙的夥伴',
    '- 繁體中文（台灣用語），少用逗號串句',
    '',
    '依序輸出六段，每段六行，不要加其他文字：',
    '形：（上面的英文代號）',
    '名稱：（3～10 字）',
    '出場：（角色看到它時說的一句話，40 字內）',
    '大勝：（50 字內）',
    '打跑：（50 字內）',
    '平手：（50 字內）'
  ].join('\n')
}

const LABELS = '名稱|出場|大勝|打跑|平手'
const BLAMING = /打輸|輸了|認輸|落敗|敗給|失敗|可惜|努力|下次/

function parseSection(text: string): FoeText | null {
  const field = (label: string, max: number): string => {
    const m = text.match(
      new RegExp(`(?:^|\\n)[\\s>*#-]*${label}[\\s*]*[：:][\\s*]*([\\s\\S]*?)(?=\\n[\\s>*#-]*(?:${LABELS})[\\s*]*[：:]|$)`)
    )
    return (m?.[1] ?? '')
      .replace(/\*\*/g, '')
      .replace(/\n[\s>*#=-]*$/, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim()
      .slice(0, max)
  }
  const foe: FoeText = {
    name: field('名稱', 20).replace(/^[「『《【（(]+|[」』》】）)。]+$/g, ''),
    intro: field('出場', 160),
    perfect: field('大勝', 200),
    win: field('打跑', 200),
    draw: field('平手', 200)
  }
  return Object.values(foe).every(Boolean) && !BLAMING.test(foe.draw) ? foe : null
}

/** 逐段解析，壞的段落略過；有效的太少回 `null`。 */
export function parseFoeReply(raw: string): CharacterFoes['list'] | null {
  const text = raw.replace(/\r/g, '')
  const head = new RegExp(`(?:^|\\n)[\\s>*#【\\[-]*形[\\s*]*[：:][\\s*]*[「\`(（]*(${FOE_FORM_IDS.join('|')})(?![a-z])[^\\n]*`, 'gi')
  const heads = [...text.matchAll(head)]
  const list: Partial<Record<FoeFormId, FoeText>> = {}
  heads.forEach((h, i) => {
    const id = h[1].toLowerCase() as FoeFormId
    const body = text.slice(h.index! + h[0].length, heads[i + 1]?.index ?? text.length)
    const foe = parseSection(body)
    if (foe && !list[id]) list[id] = foe
  })
  return Object.keys(list).length >= MIN_FOES ? list : null
}
