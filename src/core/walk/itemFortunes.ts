/**
 * 物品「使用」時抽到的籤語（`docs/walk-items-design.md` §7.2）。
 *
 * 主要由揭曉那次呼叫順便寫好（`buildItemPrompt`），這裡是它的語氣範例，也是漏寫與舊物品的備用。
 * 使用當下不呼叫 LLM：馬上有結果、離線可用。一律寫成對誰都通用、無法驗證的話；
 * 提醒類最多是「注意」，不寫壞事會發生，也不碰療效、投資與投注。
 */

import type { ItemCategory } from './items'

export type FortuneKind = 'luck' | 'answer' | 'mood' | 'care'

/** 提醒類刻意少，免得抽到的多半像警告。 */
const FORTUNE_WEIGHTS: Record<FortuneKind, number> = { luck: 0.4, answer: 0.28, mood: 0.2, care: 0.12 }

export const FORTUNES: Record<FortuneKind, readonly string[]> = {
  luck: [
    '明天一整天運氣都會很好',
    '你期望的事情很快就會出現',
    '接下來會有一個剛剛好的巧合',
    '最近會收到一個讓你笑出來的消息',
    '下一個紅綠燈會為你變綠',
    '想了很久的那件事，快要有進展了',
    '這幾天會遇到一個幫得上忙的人',
    '你隨口說的一句話，會幫到某個人',
    '今天的選擇，過幾天會證明是對的',
    '有一件小事會比你想的順利',
    '好運正在路上，只是走得比較慢',
    '你會在意想不到的地方找到想要的東西',
    '下一次抽選，你會覺得自己很有手氣',
    '接下來吃到的東西會特別合胃口',
    '有人正想著要怎麼謝謝你',
    '你最近的努力，有人都看在眼裡',
    '很快會有一個值得拍下來的瞬間',
    '本來以為錯過的機會，會再出現一次',
    '這週會有一段完全屬於你的時間',
    '今天走的路，會帶你去不錯的地方',
    '你在等的回覆，會在你忘記它的時候來',
    '最近會聽到一首很喜歡的歌',
    '下次出門，天氣會站在你這邊',
    '一個舊的緣分，會帶來新的消息'
  ],
  answer: [
    '要不要去問問看那個人？',
    '答案你其實已經知道了',
    '可以，但先喝口水再說',
    '再等一天，會看得更清楚',
    '先做最小的那一步',
    '就照你第一個想到的做',
    '換個順序試試看',
    '這次可以任性一點',
    '問問比你年紀小的人',
    '不急，它不會跑掉',
    '說出來會比放在心裡好',
    '選比較好笑的那一個',
    '睡一覺再決定',
    '去做吧，後面的事後面再想',
    '先整理桌子，答案會自己出現',
    '如果是朋友問你，你會怎麼回答？',
    '兩個都不選也是一種選擇',
    '你需要的不是答案，是有人陪',
    '把它寫下來，會比想像中簡單',
    '往前走一點點就看得到了',
    '可以放手一半',
    '現在的你已經夠了',
    '試試看平常不會選的那條路',
    '你想聽到的是「可以」，那就可以'
  ],
  mood: [
    '接下來的一整天你都會有好心情',
    '今晚會睡得很安穩',
    '明天起床時會覺得特別輕鬆',
    '今天適合穿喜歡的衣服',
    '你會想起一件很久以前的開心事',
    '今天的你看起來比平常更有精神',
    '煩惱會在洗澡的時候變小一點',
    '會有一陣風吹得剛剛好',
    '今天就算什麼都沒做，也算過得不錯',
    '你會發現自己比上個月更厲害了一點',
    '接下來的咖啡或茶會特別香',
    '今天適合原諒自己一件小事',
    '有一句稱讚正在等你',
    '你會笑得比平常多一次',
    '今天的晚霞值得抬頭看一眼',
    '心裡那個結，會鬆開一點點'
  ],
  care: [
    '出門要注意交通安全',
    '要小心和人起爭執',
    '飲食方面要注意節制',
    '出門前再檢查一次鑰匙',
    '重要的訊息，送出前多看一遍',
    '記得喝水，也記得站起來走走',
    '今天說話慢一點會比較好',
    '答應別人之前，先看看行事曆',
    '購物車裡的東西，放一晚再決定',
    '小東西容易亂放，用完記得歸位',
    '早點休息，明天會感謝今天的你',
    '帶把傘比較安心'
  ]
}

/** 使用當下的小反應，看分類；讓同一句籤語配不同物品也有差別。 */
export const USE_REACTIONS: Record<ItemCategory, readonly string[]> = {
  glow: ['它亮了一下，又慢慢暗下去。', '光晃了晃，像在點頭。', '它的光變暖了一點。'],
  sound: ['它輕輕響了一聲。', '它響了兩聲，隔了一會兒又一聲。', '聲音很小，但聽得很清楚。'],
  ink: ['上面好像多了一行字。', '你隨手一翻，停在這一頁。', '有一行字突然看得特別清楚。'],
  vessel: ['打開一看，裡面有張小紙條。', '搖一搖，掉出一張折好的紙。', '蓋子自己鬆開了一點。'],
  nature: ['它在手心裡微微發暖。', '有一陣風剛好吹過。', '它輕輕轉了半圈。'],
  lost: ['握著它，忽然想到一句話。', '它好像記得什麼。', '灰塵拍掉之後，看見一行小字。'],
  gear: ['它喀的一聲，轉了一格。', '它自己動了一下，又停住。', '零件對齊的瞬間，像是有了答案。'],
  unknown: ['它沒有動，但你覺得它回答了。', '它變重了一下，又變回來。', '不知道為什麼，心裡冒出一句話。']
}

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))]

export const FORTUNE_GUIDES: Record<FortuneKind, string> = {
  luck: '預告一件小小的好事',
  answer: '像翻書翻到的答案，模稜兩可但鼓勵人',
  mood: '讓人心情變好的一句話',
  care: '溫和的提醒，最多是「要注意」，不說壞事會發生'
}

/** `roll` 為 0～1 以下的數，同一個 roll 永遠同一類。 */
export function fortuneKindAt(roll: number): FortuneKind {
  let r = roll
  let kind: FortuneKind = 'luck'
  for (const k of Object.keys(FORTUNE_WEIGHTS) as FortuneKind[]) {
    kind = k
    r -= FORTUNE_WEIGHTS[k]
    if (r < 0) break
  }
  return kind
}

const BAD_FORTUNE = /死|病|療|治|癌|失敗|投資|股票|彩券|賭|意外|倒楣|厄運|凶/

/** 不合格回 `undefined`，呼叫端改用備用籤語。 */
export function cleanFortune(raw: string): string | undefined {
  const t = raw.replace(/^[「『"“]+|[」』"”]+$/g, '').replace(/。$/, '').trim()
  return t.length >= 4 && t.length <= 30 && !BAD_FORTUNE.test(t) ? t : undefined
}

/** `avoid` 是最近抽過的，不會重複。 */
export function drawFortune(avoid: readonly string[], random: () => number = Math.random): string {
  const kind = fortuneKindAt(random())
  const fresh = FORTUNES[kind].filter((f) => !avoid.includes(f))
  return pick(fresh.length ? fresh : FORTUNES[kind], random)
}

export function drawReaction(category: ItemCategory, random: () => number = Math.random): string {
  return pick(USE_REACTIONS[category], random)
}
