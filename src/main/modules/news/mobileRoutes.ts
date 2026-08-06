/**
 * mobileRoutes.ts
 * 個人新聞報的手機端 HTTP 路由（`/api/news/reader/*`）。
 *
 * 設計原則：
 * - 抓取邏輯與桌面共用 `readerFetch.ts`，釘選 / 不看了共用 `readerState.ts`，不做第二份實作。
 * - 不做通用 RPC 轉發（那等於開一個能呼叫任意 IPC 的洞）。
 * - 授權沿用 mobileServer 的 token（同 /api/scenes、/api/presets）。這些只讀新聞、寫新聞報設定，
 *   不碰使用者的電腦，所以不納入 remote-control 的裝置白名單 / capability 機制。
 */

import type * as http from 'http'
import { loadNewsModuleSettings, saveNewsModuleSettings, applyNewsFeedbackDelta } from './settings'
import { fetchReaderBatch, fetchReaderSection } from './readerFetch'
import { loadNewsReaderState, saveNewsReaderDismissed, saveNewsReaderPinned } from './readerState'
import { getNewsScheduler, syncNewsScheduler } from './scheduler'
import type { NewsModuleSettings, NewsSource } from './types'
import type { ReminderSchedule } from '../../types'
import type { MobileRouteRegistrar, MobileRouteContext } from '../../mobileServer'

export function registerNewsMobileRoutes(registerRoute: MobileRouteRegistrar): void {
  const get = (path: string, handler: (ctx: MobileRouteContext) => Promise<void> | void): void => {
    registerRoute({ method: 'GET', path, handler })
  }
  const post = (path: string, handler: (ctx: MobileRouteContext) => Promise<void> | void): void => {
    registerRoute({ method: 'POST', path, handler })
  }

  // ── 開啟面板時的一次性狀態 ──────────────────────────────
  get('/api/news/reader/state', ({ res }) => {
    const s = loadNewsModuleSettings()
    const shared = loadNewsReaderState()
    jsonOk(res, {
      enabled: s.enabled,
      sources: s.sources,
      keywordGroups: s.keywordGroups,
      readerKeywordGroupIds: s.readerKeywordGroupIds ?? [],
      readerMaxItems: s.readerMaxItems ?? 30,
      readerPerKeyword: s.readerPerKeyword ?? 3,
      readerBreakoutQuota: s.readerBreakoutQuota ?? 3,
      pinnedItems: shared.pinnedItems,
      dismissedIds: shared.dismissedIds
    })
  })

  // ── 抓取 ────────────────────────────────────────────────
  post('/api/news/reader/batch', async ({ req, res }) => {
    const payload = await readJsonBody<{ maxItems?: number; excludeIds?: string[]; strictExclude?: boolean }>(req, res)
    if (!payload) return
    jsonOk(res, await fetchReaderBatch(payload))
  })

  post('/api/news/reader/section', async ({ req, res }) => {
    const payload = await readJsonBody<{ sectionGroupId?: string; excludeIds?: string[]; strictExclude?: boolean }>(req, res)
    if (!payload) return
    jsonOk(res, await fetchReaderSection(payload))
  })

  // ── 共用狀態：釘選 / 不看了 ─────────────────────────────
  post('/api/news/reader/pinned', async ({ req, res }) => {
    const payload = await readJsonBody<{ items?: unknown }>(req, res)
    if (!payload) return
    jsonOk(res, saveNewsReaderPinned(payload.items))
  })

  post('/api/news/reader/dismissed', async ({ req, res }) => {
    const payload = await readJsonBody<{ ids?: unknown }>(req, res)
    if (!payload) return
    jsonOk(res, saveNewsReaderDismissed(payload.ids))
  })

  // ── 欄位設定（與桌面 store 的 setSectionQuota / setReaderKeywordGroups / reorderSources 對齊）──
  post('/api/news/reader/quota', async ({ req, res }) => {
    const payload = await readJsonBody<{ sectionGroupId?: string; quota?: number }>(req, res)
    if (!payload) return
    const sectionGroupId = String(payload.sectionGroupId ?? '')
    if (!sectionGroupId) { jsonError(res, 400, 'sectionGroupId required'); return }
    const n = Math.max(0, Math.min(20, Math.floor(Number(payload.quota))))
    if (!Number.isFinite(n)) { jsonError(res, 400, 'quota must be a number'); return }

    // ⚠️ 這裡讀 `s`只是為了算出新值（例如下面的 `nextSources`），
    // **存檔時只送真的改到的那個欄位** —— 把整個 `s` spread 進 `saveNewsModuleSettings`
    // 等於連同沒改到的欄位一起送出去，若同時間有別的請求（例如「管理關鍵字」面板
    // 才剛存好一個新分組）搶先寫入，這裡事後才存檔就會用手上這份舊的 `keywordGroups`
    // 把剛存好的蓋掉。`saveNewsModuleSettings` 內部本來就會在寫入前重新讀一次磁碟，
    // 只疊上真的傳進去的欄位即可，其餘欄位交給它自己去讀最新的。
    const s = loadNewsModuleSettings()
    if (sectionGroupId === '__breakout__') {
      saveNewsModuleSettings({ readerBreakoutQuota: n })
    } else if (sectionGroupId.startsWith('kw:')) {
      const sourceId = sectionGroupId.slice(3)
      const perKeyword = s.readerPerKeyword ?? 3
      const nextSources = s.sources.map(src => {
        if (src.id !== sourceId) return src
        // 與全域相同就清掉覆寫，回到「跟隨全域」
        if (n === perKeyword || n < 1) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { readerQuota: _drop, ...rest } = src
          return rest as NewsSource
        }
        return { ...src, readerQuota: Math.max(1, n) }
      })
      saveNewsModuleSettings({ sources: nextSources })
    } else {
      // 地方／RSS 等沒有單獨配額，改的是全域每關鍵字預設
      saveNewsModuleSettings({ readerPerKeyword: Math.max(1, n) })
    }
    // 只回該欄的新內容，手機端就地換掉，不必整頁重整
    jsonOk(res, await fetchReaderSection({ sectionGroupId }))
  })

  post('/api/news/reader/groups', async ({ req, res }) => {
    const payload = await readJsonBody<{ ids?: unknown }>(req, res)
    if (!payload) return
    const ids = Array.isArray(payload.ids)
      ? payload.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    saveNewsModuleSettings({ readerKeywordGroupIds: ids })
    jsonOk(res, { ok: true, readerKeywordGroupIds: ids })
  })

  post('/api/news/reader/order', async ({ req, res }) => {
    const payload = await readJsonBody<{ orderedSourceIds?: unknown }>(req, res)
    if (!payload) return
    const ordered = Array.isArray(payload.orderedSourceIds)
      ? payload.orderedSourceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (ordered.length === 0) { jsonError(res, 400, 'orderedSourceIds required'); return }

    const s = loadNewsModuleSettings()
    const byId = new Map(s.sources.map(src => [src.id, src]))
    const seen = new Set<string>()
    const reordered: NewsSource[] = []
    for (const id of ordered) {
      const src = byId.get(id)
      if (!src || seen.has(id)) continue
      seen.add(id)
      reordered.push(src)
    }
    // 沒被列到的（其他組的關鍵字、訂閱來源）維持原相對順序接在後面
    for (const src of s.sources) {
      if (!seen.has(src.id)) reordered.push(src)
    }
    if (reordered.length !== s.sources.length) { jsonError(res, 400, 'source list mismatch'); return }

    saveNewsModuleSettings({ sources: reordered })
    jsonOk(res, { ok: true, sources: reordered })
  })

  // ── 新聞設定（B3 階段 6：關鍵字／黑名單／來源／排程）──────────
  //
  // 手機只給這四樣，不是整份 `NewsModuleSettings`：語言處理、破圈、學習權重
  // 屬於桌面設定面板的深水區（roadmap §2 目標 4：進階的不要擠進第一層）。
  get('/api/news/settings', ({ res }) => {
    const s = loadNewsModuleSettings()
    jsonOk(res, {
      enabled: s.enabled,
      sources: s.sources,
      keywordGroups: s.keywordGroups,
      blacklist: s.blacklist,
      speakButton: s.speakButton
    })
  })

  post('/api/news/settings', async ({ req, res }) => {
    const payload = await readJsonBody<{
      sources?: unknown
      keywordGroups?: unknown
      blacklist?: unknown
      speakButton?: unknown
    }>(req, res)
    if (!payload) return

    // ⚠️ **只放進「這次真的送了什麼」，不要自己先 `loadNewsModuleSettings()`
    // 再把整包 spread 進去。** `saveNewsModuleSettings` 內部本來就會在寫入前
    // 重新讀一次磁碟現況、只疊上傳進去的 patch —— 這裡才是唯一該讀「現況」的地方。
    // 之前這裡多讀了一次 `current` 並整包塞進 patch，等於把「這個請求進來那一刻」
    // 的舊快照連同沒被改到的欄位（例如 `keywordGroups`）一起送進去；如果同時間
    // 有另一個請求（例如管理關鍵字面板連著送「改關鍵字」再送「新增組」）搶先
    // 存檔，這個請求的 `saveNewsModuleSettings` 事後才執行，就會用它手上那份
    // 舊的 `keywordGroups` 把剛存好的新組蓋掉——跟 owner 之前回報「頻率互相蓋掉」
    // 同一類問題，只是這次會發生在「不同欄位」之間，光靠前端排隊擋不住。
    const patch: Partial<NewsModuleSettings> = {}
    if (Array.isArray(payload.sources)) patch.sources = payload.sources as NewsSource[]
    if (Array.isArray(payload.keywordGroups)) {
      patch.keywordGroups = payload.keywordGroups as { id: string; name: string }[]
    }
    if (Array.isArray(payload.blacklist)) {
      patch.blacklist = payload.blacklist.filter((k): k is string => typeof k === 'string' && k.length > 0)
    }
    if (payload.speakButton === 'off' || payload.speakButton === 'sometimes' || payload.speakButton === 'always') {
      patch.speakButton = payload.speakButton
    }
    const next = saveNewsModuleSettings(patch)
    jsonOk(res, {
      enabled: next.enabled,
      sources: next.sources,
      keywordGroups: next.keywordGroups,
      blacklist: next.blacklist,
      speakButton: next.speakButton
    })
  })

  // ── 定時新聞陪聊（與桌面設定面板同一份資料，共用 scheduler.ts）──
  get('/api/news/scheduler', ({ res }) => {
    jsonOk(res, getNewsScheduler())
  })

  post('/api/news/scheduler', async ({ req, res }) => {
    const payload = await readJsonBody<{ enabled?: boolean; schedule?: ReminderSchedule }>(req, res)
    if (!payload) return
    // 要開啟卻沒給排程＝設定不完整；照收會變成「開關是開的但永遠不會觸發」
    if (payload.enabled && !payload.schedule) { jsonError(res, 400, 'schedule required'); return }
    syncNewsScheduler({ enabled: payload.enabled === true, schedule: payload.schedule })
    jsonOk(res, getNewsScheduler())
  })

  // ── 開原文加分（與陪聊共用同一套學習回饋）──
  post('/api/news/mark-opened', async ({ req, res }) => {
    const payload = await readJsonBody<{ sourceId?: string }>(req, res)
    if (!payload) return
    if (payload.sourceId) applyNewsFeedbackDelta(payload.sourceId, 0.1)
    jsonOk(res, { ok: true })
  })
}

// ── 工具函式（比照 remote-control/routes.ts，各模組自帶避免耦合）──

function jsonOk(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function jsonError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

async function readJsonBody<T>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | null> {
  const body = await new Promise<string>(resolve => {
    let buf = ''
    req.on('data', chunk => { buf += chunk.toString() })
    req.on('end', () => resolve(buf))
    req.on('error', () => resolve(''))
  })
  if (!body.trim()) return {} as T
  try {
    return JSON.parse(body) as T
  } catch {
    jsonError(res, 400, 'Invalid JSON')
    return null
  }
}
