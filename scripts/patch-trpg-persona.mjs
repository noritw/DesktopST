/**
 * 修補 TRPGPack 裡的 persona 模板：
 * - nickname 改為空字串（強迫使用者自己填角色名，不會留「待定」「主角」當真名）
 * - displayName 改短、更直覺
 * - description 移除「名字：（待定）」衝突行，新增說明引導使用者到正確欄位填名字
 */
import { readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'

const PATH = 'D:/DesktopST/assets/DesktopST_TRPGPack.dstpack'

const buf = readFileSync(PATH)
const zip = await JSZip.loadAsync(buf)

const partialRaw = await zip.file('global/settings.partial.json').async('string')
const partial = JSON.parse(partialRaw)

partial.persona.displayName = '（角色名或稱謂）'
partial.persona.nickname = ''
partial.persona.description = `我是 {{user}}，正在進行單人 TRPG。

【給玩家的提示】
上方「角色如何稱呼你」欄位就是你的角色名——GM 和同伴會用那個名字叫你。
開始前請先填入，之後想改隨時可以存檔，下一句話就會生效。

【角色資料】（開始前或開場後與 GM 共同決定）
- 職業／身份：（待定）
- 一句話背景：（待定）

【能力值修正】（D&D 風格 +X；新手可全部當 0 開始）
- 力量 STR：+0
- 敏捷 DEX：+0
- 體質 CON：+0
- 智力 INT：+0
- 感知 WIS：+0
- 魅力 CHA：+0

【生命值】HP 10 / 10
【裝備】（待定）

【玩家偏好】
- 我是 TRPG 新手 / 老手：（請填）
- 節奏偏好：劇情為主 / 戰鬥為主 / 平衡
- 引導程度：希望 GM 主動引導 / 喜歡自由發揮

備註：能力值不會自動計算，是給 GM 看的參考；骰子要自己骰再加修正值進去。`

zip.file('global/settings.partial.json', JSON.stringify(partial, null, 2))

const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
writeFileSync(PATH, out)
console.log('完成，persona 模板已更新。')
console.log('nickname 現在：', JSON.stringify(partial.persona.nickname))
console.log('displayName 現在：', partial.persona.displayName)
