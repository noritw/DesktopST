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
import type { NewsSource } from './types'
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

    const s = loadNewsModuleSettings()
    if (sectionGroupId === '__breakout__') {
      saveNewsModuleSettings({ ...s, readerBreakoutQuota: n })
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
      saveNewsModuleSettings({ ...s, sources: nextSources })
    } else {
      // 地方／RSS 等沒有單獨配額，改的是全域每關鍵字預設
      saveNewsModuleSettings({ ...s, readerPerKeyword: Math.max(1, n) })
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
    const s = loadNewsModuleSettings()
    saveNewsModuleSettings({ ...s, readerKeywordGroupIds: ids })
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

    saveNewsModuleSettings({ ...s, sources: reordered })
    jsonOk(res, { ok: true, sources: reordered })
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
