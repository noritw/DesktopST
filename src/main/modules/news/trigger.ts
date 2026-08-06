import { fetchAllSources } from './sources'
import { filterAndPick } from './filter'
import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { getActiveNewsTopic } from './topicState'
import { applyEnrichToItem, enrichNewsForChat } from './enrich'
import {
  buildNewsContextString, buildNewsDirective, buildTopicContextString, buildTopicDirective,
  shouldGrabNews, markNewsSeen as markNewsSeenPure
} from '../../../core/news/trigger'
import type { NewsModuleSettings, NewsSelectionContext } from './types'
import type { AppSettings } from '../../types'
import type { NewsLinkInfo } from '../../../core/types'

/**
 * 新聞發話的桌面端外殼。
 *
 * 指令組裝（角色怎麼把新聞講出來的全部措辭）已搬到 `core/news/trigger.ts`——
 * 那是桌面與手機必須完全一致、最禁不起 drift 的部分。
 *
 * 留在這裡的是需要平台能力的三件事：
 * - 讀寫模組設定（`settings.ts` 走檔案存取）
 * - 抓取來源（`sources.ts`，見下方說明）
 * - 待結算回饋的 process 級狀態
 *
 * ⚠️ **`sources.ts` 尚未進 core**，因為它用了 `crypto.createHash` 與 `rss-parser`，
 * 兩者在手機端都需要替代方案（前者可換成純 JS hash，後者要確認能否在 WebView 跑，
 * 或改走 §3.3 提到的 news provider 介面）。這是 B4 模組移植要決定的事，
 * 不該在純重構階段順手決定。
 */

export {
  buildNewsContextString, buildNewsDirective, buildTopicContextString, buildTopicDirective,
  buildSurveyDirective, buildNotesDirective, shouldGrabNews, type NewsInjection
} from '../../../core/news/trigger'

/**
 * 待結算的正向回饋：角色剛講完一則新聞後，記住它的來源；
 * 若使用者接著回了話（送出訊息），就視為對該來源有興趣 → 加分（design §9）。
 */
let pendingNewsCreditSourceId: string | null = null

export function setPendingNewsCredit(sourceId: string | null): void {
  pendingNewsCreditSourceId = sourceId
}

/** 取出並清掉待結算的正向回饋來源（沒有則回 null） */
export function consumePendingNewsCredit(): string | null {
  const v = pendingNewsCreditSourceId
  pendingNewsCreditSourceId = null
  return v
}

/** 把抽中的新聞 id 記入 seenIds（去重），並存檔。上限保護避免無限增長。 */
export function markNewsSeen(settings: NewsModuleSettings, id: string): NewsModuleSettings {
  const next = markNewsSeenPure(settings, id)
  // 相同物件 = 沒有變動，不必存檔（core 的 markNewsSeen 保證這個語意）
  if (next !== settings) saveNewsModuleSettings(next)
  return next
}

/**
 * 為「說點什麼」取得一則新聞素材。
 * 回傳 null 代表：模組停用 / 這次不抓 / 沒有可用候選。
 * 會把抽中的新聞記入 seenIds；必要時 enrich 後再組字串。
 */
export async function getNewsInjectionForSpeak(
  options: {
    force?: boolean
    rng?: () => number
    ctx?: NewsSelectionContext
    enabledOverride?: boolean
    appSettings?: AppSettings
  } = {}
): Promise<import('../../../core/news/trigger').NewsInjection | null> {
  const settings = loadNewsModuleSettings()
  // enabledOverride：呼叫端算好的有效開關（情境覆蓋優先），未傳時用全域設定
  if (!(options.enabledOverride ?? settings.enabled)) return null

  // 主題模式優先：有釘住的話題時，主動發話一律圍繞它聊（覆寫 speakButton、不抽新）。
  const topic = getActiveNewsTopic()
  if (topic) {
    return {
      text: buildTopicContextString(topic),
      directive: buildTopicDirective(topic),
      item: null,
      fromTopic: true
    }
  }

  const rng = options.rng ?? Math.random
  if (!options.force && !shouldGrabNews(settings.speakButton, rng)) return null

  const items = await fetchAllSources(settings, {}, options.ctx)
  const { picked } = filterAndPick(items, settings, { rng, ctx: options.ctx })
  if (!picked) return null

  markNewsSeen(settings, picked.id)

  let item = picked
  try {
    const enrich = await enrichNewsForChat(picked, {
      settings,
      appSettings: options.appSettings
    })
    item = applyEnrichToItem(picked, enrich)
    if (enrich.warning) {
      console.warn('[news enrich]', picked.id, enrich.warning)
    }
  } catch (e) {
    console.warn('[news enrich] failed, using RSS fallback', e)
  }

  return {
    text: buildNewsContextString(item, settings),
    directive: buildNewsDirective(item),
    item,
    fromTopic: false
  }
}

/**
 * 「聊這個」確認後、送出前暫存的 newsLink。
 * 下一次 message:send 會掛到使用者訊息上並清空。
 */
let pendingUserNewsLink: NewsLinkInfo | null = null

export function setPendingUserNewsLink(link: NewsLinkInfo | null): void {
  pendingUserNewsLink = link
}

export function peekPendingUserNewsLink(): NewsLinkInfo | null {
  return pendingUserNewsLink
}

export function consumePendingUserNewsLink(): NewsLinkInfo | null {
  const v = pendingUserNewsLink
  pendingUserNewsLink = null
  return v
}
