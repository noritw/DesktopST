/**
 * 「說點什麼」／主動發話的新聞素材：抽一則、記已讀、必要時 enrich，
 * 組出可直接塞進 `extraSystemContext`／`triggerDirective` 的內容
 * （B1 抽 core，news-standalone-kickoff §4 步驟⑦）。
 *
 * 指令組裝（角色怎麼把新聞講出來的措辭）在 `trigger.ts`，那邊是純規則；
 * 這裡是需要平台能力（抓取來源／讀寫設定／輔助模型）的那一半，桌面與手機共用，
 * 不再各自兜一份——這正是缺口 #6 的起因：手機以前完全沒有這段邏輯，
 * `chat.ts` 只認得已經掛好的 `newsLink`，從不會自己抽新聞當話題。
 */
import type { StorageAdapter } from '../adapters/storage'
import type { NewsSourceDeps } from './sources'
import { fetchAllSources } from './sources'
import { filterAndPick } from './filter'
import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { getActiveNewsTopic } from './topicState'
import { applyEnrichToItem, enrichNewsForChat, type EnrichDeps } from './enrich'
import {
  buildNewsContextString, buildNewsDirective, buildTopicContextString, buildTopicDirective,
  shouldGrabNews, markNewsSeen as markNewsSeenPure, type NewsInjection
} from './trigger'
import type { AppSettings } from '../types'
import type { NewsModuleSettings, NewsSelectionContext } from './types'

export type NewsInjectionDeps = NewsSourceDeps & EnrichDeps

/** 把抽中的新聞 id 記入 seenIds（去重），並存檔。上限保護避免無限增長。 */
export async function markNewsSeen(
  storage: StorageAdapter,
  settings: NewsModuleSettings,
  id: string
): Promise<NewsModuleSettings> {
  const next = markNewsSeenPure(settings, id)
  // 相同物件 = 沒有變動，不必存檔（core 的 markNewsSeen 保證這個語意）
  if (next !== settings) await saveNewsModuleSettings(storage, next)
  return next
}

export interface NewsInjectionOptions {
  force?: boolean
  rng?: () => number
  ctx?: NewsSelectionContext
  enabledOverride?: boolean
  appSettings?: AppSettings
}

/**
 * 為「說點什麼」／主動發話取得一則新聞素材。
 * 回傳 null 代表：模組停用 / 這次不抓 / 沒有可用候選。
 */
export async function getNewsInjectionForSpeak(
  deps: NewsInjectionDeps,
  options: NewsInjectionOptions = {}
): Promise<NewsInjection | null> {
  const settings = await loadNewsModuleSettings(deps.storage)
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

  const items = await fetchAllSources(deps, settings, {}, options.ctx)
  const { picked } = filterAndPick(items, settings, { rng, ctx: options.ctx })
  if (!picked) return null

  await markNewsSeen(deps.storage, settings, picked.id)

  let item = picked
  try {
    const enrich = await enrichNewsForChat(deps, picked, { settings, appSettings: options.appSettings })
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
