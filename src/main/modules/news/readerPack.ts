import type { NewsKeywordGroup, NewsModuleSettings, NewsSource, NewsWeight } from './types'
import { DEFAULT_KEYWORD_GROUP_ID, normalizeNewsModuleSettings } from './settings'

/** 跨機搬運個人新聞報／關鍵字組用的輕量包（不含已讀、學習權重、聊天排程） */
export const NEWS_READER_PACK_FORMAT = 'desktopst.news-reader'
export const NEWS_READER_PACK_VERSION = 1

export interface NewsReaderPack {
  format: typeof NEWS_READER_PACK_FORMAT
  version: number
  exportedAt: string
  keywordGroups: NewsKeywordGroup[]
  /** 興趣關鍵字（不含角色卡）+ RSS / JSON */
  sources: NewsSource[]
  readerKeywordGroupIds: string[]
  readerMaxItems: number
  readerPerKeyword: number
  readerBreakoutQuota: number
  blacklist: string[]
  maxAgeDays: number
  breakout: { enabled: boolean; weight: NewsWeight; zhOnly?: boolean }
}

function isExportableSource(s: NewsSource): boolean {
  if (s.origin === 'character' || s.origin === 'location') return false
  return s.type === 'keyword' || s.type === 'rss' || s.type === 'json'
}

/** 從目前模組設定組出可匯出的新聞報設定包 */
export function buildNewsReaderPack(settings: NewsModuleSettings): NewsReaderPack {
  const normalized = normalizeNewsModuleSettings(settings)
  return {
    format: NEWS_READER_PACK_FORMAT,
    version: NEWS_READER_PACK_VERSION,
    exportedAt: new Date().toISOString(),
    keywordGroups: normalized.keywordGroups,
    sources: normalized.sources.filter(isExportableSource),
    readerKeywordGroupIds: normalized.readerKeywordGroupIds ?? [],
    readerMaxItems: normalized.readerMaxItems ?? 30,
    readerPerKeyword: normalized.readerPerKeyword ?? 3,
    readerBreakoutQuota: normalized.readerBreakoutQuota ?? 3,
    blacklist: normalized.blacklist,
    maxAgeDays: normalized.maxAgeDays,
    breakout: {
      enabled: normalized.breakout.enabled,
      weight: normalized.breakout.weight,
      zhOnly: normalized.breakout.zhOnly !== false
    }
  }
}

export function parseNewsReaderPack(raw: unknown): { ok: true; pack: NewsReaderPack } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '檔案內容不是有效的 JSON 物件' }
  const o = raw as Record<string, unknown>
  if (o.format !== NEWS_READER_PACK_FORMAT) {
    return { ok: false, error: '不是 DesktopST 新聞報設定檔（format 不符）' }
  }
  if (typeof o.version !== 'number' || o.version < 1) {
    return { ok: false, error: '設定檔版本無法辨識' }
  }

  // 借 normalize 把欄位收斂成合法結構
  const probe = normalizeNewsModuleSettings({
    keywordGroups: o.keywordGroups as NewsModuleSettings['keywordGroups'],
    sources: Array.isArray(o.sources) ? (o.sources as NewsSource[]) : [],
    readerKeywordGroupIds: o.readerKeywordGroupIds as string[] | undefined,
    readerMaxItems: o.readerMaxItems as number | undefined,
    readerPerKeyword: o.readerPerKeyword as number | undefined,
    readerBreakoutQuota: o.readerBreakoutQuota as number | undefined,
    blacklist: o.blacklist as string[] | undefined,
    maxAgeDays: typeof o.maxAgeDays === 'number' ? o.maxAgeDays : undefined,
    breakout: o.breakout && typeof o.breakout === 'object'
      ? (o.breakout as NewsModuleSettings['breakout'])
      : undefined
  })

  const sources = probe.sources.filter(isExportableSource)
  if (probe.keywordGroups.length === 0) {
    return { ok: false, error: '設定檔缺少關鍵字組' }
  }

  return {
    ok: true,
    pack: {
      format: NEWS_READER_PACK_FORMAT,
      version: Math.floor(o.version),
      exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : new Date().toISOString(),
      keywordGroups: probe.keywordGroups,
      sources,
      readerKeywordGroupIds: probe.readerKeywordGroupIds ?? [],
      readerMaxItems: probe.readerMaxItems ?? 30,
      readerPerKeyword: probe.readerPerKeyword ?? 3,
      readerBreakoutQuota: probe.readerBreakoutQuota ?? 3,
      blacklist: probe.blacklist,
      maxAgeDays: probe.maxAgeDays,
      breakout: {
        enabled: probe.breakout.enabled,
        weight: probe.breakout.weight,
        zhOnly: probe.breakout.zhOnly !== false
      }
    }
  }
}

/**
 * 套用匯入包：覆蓋關鍵字組、可匯出來源、新聞報則數／組選、黑名單、新鮮度、破圈。
 * 保留：模組開關、聊天／提醒／對話搜尋、學習權重、已讀、地方新聞來源、角色卡來源。
 */
export function applyNewsReaderPack(
  current: NewsModuleSettings,
  pack: NewsReaderPack
): NewsModuleSettings {
  const preserved = current.sources.filter(
    s => s.origin === 'character' || s.origin === 'location'
  )
  const incoming = pack.sources.filter(isExportableSource).map(s => ({
    ...s,
    // 匯入後一律當本機使用者設定，避免 builtin 標籤殘留
    origin: (s.origin === 'builtin' ? 'builtin' : 'user') as NewsSource['origin']
  }))

  // 確保預設組存在（normalize 也會補）
  const groups = pack.keywordGroups.some(g => g.id === DEFAULT_KEYWORD_GROUP_ID)
    ? pack.keywordGroups
    : [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }, ...pack.keywordGroups]

  return normalizeNewsModuleSettings({
    ...current,
    keywordGroups: groups,
    sources: [...preserved, ...incoming],
    readerKeywordGroupIds: pack.readerKeywordGroupIds,
    readerMaxItems: pack.readerMaxItems,
    readerPerKeyword: pack.readerPerKeyword,
    readerBreakoutQuota: pack.readerBreakoutQuota,
    blacklist: pack.blacklist,
    maxAgeDays: pack.maxAgeDays,
    breakout: pack.breakout
  })
}
