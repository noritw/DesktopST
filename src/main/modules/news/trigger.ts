import { saveNewsModuleSettings } from './settings'
import * as core from '../../../core/news/injection'
import { electronHttp } from '../../adapters/httpAdapter'
import { electronRssParser } from '../../adapters/rssParseAdapter'
import { electronStorage } from '../../adapters/storageAdapter'
import {
  shouldGrabNews, markNewsSeen as markNewsSeenPure
} from '../../../core/news/trigger'
import type { NewsModuleSettings, NewsSelectionContext } from './types'
import type { AppSettings } from '../../types'
import type { NewsLinkInfo } from '../../../core/types'

/**
 * 新聞發話的桌面端外殼。
 *
 * 指令組裝（角色怎麼把新聞講出來的全部措辭）在 `core/news/trigger.ts`；
 * 抽選／記已讀／enrich 的整套流程在 `core/news/injection.ts`（B1 抽 core，步驟⑦）——
 * 桌面與手機現在共用同一套，不再各自兜一份。
 *
 * 留在這裡的只剩桌面獨有的東西：待結算回饋（`pendingNewsCreditSourceId`）與
 * 「聊這個」暫存 newsLink（`pendingUserNewsLink`）——這兩個是 process 級單例，
 * 手機獨立版另有自己的訊息流程，不透過這裡。
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

const injectionDeps: core.NewsInjectionDeps = { http: electronHttp, rss: electronRssParser, storage: electronStorage }

/**
 * 為「說點什麼」取得一則新聞素材。
 * 回傳 null 代表：模組停用 / 這次不抓 / 沒有可用候選。
 * 會把抽中的新聞記入 seenIds；必要時 enrich 後再組字串。
 *
 * 本體搬到 `core/news/injection.ts`（B1 抽 core，步驟⑦）——桌面與手機共用同一套
 * 抽選／記已讀／enrich 流程，不再各自兜一份。
 */
export function getNewsInjectionForSpeak(
  options: {
    force?: boolean
    rng?: () => number
    ctx?: NewsSelectionContext
    enabledOverride?: boolean
    appSettings?: AppSettings
  } = {}
): Promise<import('../../../core/news/trigger').NewsInjection | null> {
  return core.getNewsInjectionForSpeak(injectionDeps, options)
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
