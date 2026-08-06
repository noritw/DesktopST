import { BrowserWindow, dialog, ipcMain, screen } from 'electron'
import fs from 'fs'
import type { ModuleIpcRegistry } from '../moduleTypes'
import { loadNewsModuleSettings, saveNewsModuleSettings, applyNewsFeedbackDelta } from './settings'
import { fetchAllSources } from './sources'
import { filterAndPick } from './filter'
import { applyNewsReaderPack, buildNewsReaderPack, parseNewsReaderPack } from './readerPack'
import { fetchReaderBatch, fetchReaderSection } from './readerFetch'
import {
  hasNewsReaderState, loadNewsReaderState,
  saveNewsReaderDismissed, saveNewsReaderPinned, saveNewsReaderState
} from './readerState'
import { getNewsScheduler, syncNewsScheduler } from './scheduler'
import { enrichNewsForChat, applyEnrichToItem, cacheManualPromptContext } from './enrich'
import { setPendingUserNewsLink } from './trigger'
import {
  openSettingsWindow,
  createNewsReaderWindow,
  createInputWindow
} from '../../windowManager'
import type { NewsItem, NewsModuleSettings } from './types'
import type { ReminderSchedule } from '../../types'
import type { NewsLinkInfo } from '../../../core/types'

export function registerNewsIpcHandlers(registry: ModuleIpcRegistry = ipcMain): void {
  // 讀取目前模組設定（設定面板初始化用）
  registry.handle('news:get-settings', () => loadNewsModuleSettings())

  // 儲存設定（傳整份或部分；後端會正規化）
  //
  // ⚠️ **只把 partial 原樣傳給 `saveNewsModuleSettings`，不要自己先讀一次
  // `loadNewsModuleSettings()` 再整包 spread 進去。** `saveNewsModuleSettings`
  // 內部本來就會在寫入前重新讀一次磁碟現況、只疊上傳進去的欄位（沒帶到的欄位
  // 一律沿用磁碟上現有值，不是回預設值——那是 `normalizeNewsModuleSettings`
  // 直接收到「整份設定」時才會發生的事，`saveNewsModuleSettings` 不是那樣用）。
  // 這裡以前是「先讀 current 再整包 spread」，等於把「這個請求進來那一刻」的
  // 舊快照也一起送進去；桌面與手機現在會同時寫這份設定檔（B3 階段 6），
  // 兩邊前後腳存檔時，晚執行的那個會用它手上的舊快照把剛存好的欄位蓋掉——
  // 跟 owner 回報過的「頻率互相蓋掉」同一類問題，只是換一個觸發路徑。
  registry.handle('news:save-settings', (_, partial: Partial<NewsModuleSettings>) => {
    return saveNewsModuleSettings(partial ?? {})
  })

  // 只切換啟用 / 停用（擴充分頁的開關）
  registry.handle('news:set-enabled', (_, enabled: boolean) => {
    return saveNewsModuleSettings({ enabled: !!enabled })
  })

  // 一鍵重置學習權重（design §9）
  registry.handle('news:reset-feedback', () => {
    return saveNewsModuleSettings({ feedback: { adjustments: {} } })
  })

  // 「跟我無關」：略過該則（記弱負向），可選擇封鎖關鍵字 / 來源（design §9）
  registry.handle('news:dont-want', (_, payload: {
    id?: string
    sourceId?: string
    keyword?: string
    source?: string
    blockKeyword?: boolean
    blockSource?: boolean
    reduceSource?: boolean
  }) => {
    const current = loadNewsModuleSettings()
    const adjustments = { ...current.feedback.adjustments }
    // 弱負向：把該來源權重往下微調（夾住下限避免歸零後永遠抽不到）
    if (payload?.sourceId) {
      adjustments[payload.sourceId] = Math.max(-1.5, (adjustments[payload.sourceId] ?? 0) - 0.5)
    }
    const blacklist = [...current.blacklist]
    if (payload?.blockKeyword && payload.keyword && !blacklist.includes(payload.keyword)) {
      blacklist.push(payload.keyword)
    }
    const excludedSources = [...current.excludedSources]
    if (payload?.blockSource && payload.source && !excludedSources.includes(payload.source)) {
      excludedSources.push(payload.source)
    }
    // 降低顯示（非封鎖）：與封鎖互斥，封鎖已經完全不會抽到，沒必要重複降權
    const reducedSources = [...current.reducedSources]
    if (payload?.reduceSource && !payload?.blockSource && payload.source && !reducedSources.includes(payload.source)) {
      reducedSources.push(payload.source)
    }
    const seenIds = payload?.id && !current.seenIds.includes(payload.id)
      ? [...current.seenIds, payload.id].slice(-500)
      : current.seenIds
    // 這裡讀 `current` 是為了算出上面五個欄位的新值，**不是要整包送出去**——
    // 理由同 `news:save-settings` 上面的說明。
    return saveNewsModuleSettings({
      feedback: { adjustments },
      blacklist,
      excludedSources,
      reducedSources,
      seenIds
    })
  })

  // 使用者點開原文連結 → 微加分（+0.1，表示有好奇感興趣，比回話低）
  registry.handle('news:mark-opened', (_, sourceId: string) => {
    if (typeof sourceId === 'string' && sourceId) applyNewsFeedbackDelta(sourceId, 0.1)
    return { ok: true }
  })

  // 試抓一則（設定面板的「試抓」按鈕）：依目前設定抓+篩+抽，但不記入 seenIds，可重複測試
  registry.handle('news:preview', async () => {
    const settings = loadNewsModuleSettings()
    try {
      const items = await fetchAllSources(settings, { useCache: false })
      const result = filterAndPick(items, settings)
      return {
        ok: true,
        item: result.picked,
        candidateCount: result.candidateCount,
        stats: result.stats
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // 新聞定時排程：在 reminders 檔維護一條固定的特殊 Reminder（排程器自動吃到）。
  // 本體在 `scheduler.ts`，手機的 `/api/news/scheduler` 呼叫同一支（B3 階段 6）。
  registry.handle('news:sync-scheduler', (_, payload: { enabled: boolean; schedule?: ReminderSchedule }) =>
    syncNewsScheduler(payload))

  registry.handle('news:get-scheduler', () => getNewsScheduler())

  // 開啟（或聚焦）設定視窗並導航至新聞模組設定分頁（REQ-10）
  registry.handle('news:open-settings-tab', () => {
    openSettingsWindow('news')
    return { ok: true }
  })

  // 匯出個人新聞報／關鍵字組設定（JSON，可換機）
  registry.handle('news:export-reader-settings', async (event) => {
    try {
      const pack = buildNewsReaderPack(loadNewsModuleSettings())
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOpts = {
        title: '匯出新聞報設定',
        defaultPath: 'DesktopST-news-reader.json',
        filters: [{ name: 'DesktopST 新聞報設定', extensions: ['json'] }]
      }
      const { canceled, filePath } =
        win && !win.isDestroyed()
          ? await dialog.showSaveDialog(win, dialogOpts)
          : await dialog.showSaveDialog(dialogOpts)
      if (canceled || !filePath) return { ok: false as const, canceled: true as const }
      fs.writeFileSync(filePath, JSON.stringify(pack, null, 2), 'utf-8')
      return { ok: true as const, path: filePath }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })

  // 匯入個人新聞報／關鍵字組設定（覆蓋關鍵字組與新聞報相關欄位）
  registry.handle('news:import-reader-settings', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const dialogOpts = {
        title: '匯入新聞報設定',
        properties: ['openFile' as const],
        filters: [{ name: 'DesktopST 新聞報設定', extensions: ['json'] }]
      }
      const { canceled, filePaths } =
        win && !win.isDestroyed()
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts)
      if (canceled || filePaths.length === 0) return { ok: false as const, canceled: true as const }

      const text = fs.readFileSync(filePaths[0], 'utf-8')
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return { ok: false as const, error: 'JSON 解析失敗' }
      }
      const parsed = parseNewsReaderPack(raw)
      if (!parsed.ok) return { ok: false as const, error: parsed.error }

      const next = applyNewsReaderPack(loadNewsModuleSettings(), parsed.pack)
      const saved = saveNewsModuleSettings(next)
      return {
        ok: true as const,
        settings: saved,
        summary: {
          groups: parsed.pack.keywordGroups.length,
          sources: parsed.pack.sources.length,
          keywords: parsed.pack.sources.filter(s => s.type === 'keyword').length
        }
      }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })

  // 新聞報：只重抓單一欄（關鍵字／破圈／地方／訂閱）
  registry.handle('news:fetch-section', async (_, req?: {
    sectionGroupId?: string
    excludeIds?: string[]
    strictExclude?: boolean
  }) => fetchReaderSection(req))

  // 新聞報：批次抓取（略過 seenIds，取前 N 則）
  registry.handle('news:fetch-batch', async (_, req?: {
    maxItems?: number
    /** 換一批：排除目前畫面上的新聞 id */
    excludeIds?: string[]
    /** true＝絕不回填已排除 id（釘選換一批） */
    strictExclude?: boolean
  }) => fetchReaderBatch(req))

  // 新聞報共用狀態：釘選 / 不看了（桌面視窗與手機共用同一份，見 readerState.ts）
  registry.handle('news:reader-get-state', () => ({
    ...loadNewsReaderState(),
    // false 代表這台還沒有共用狀態檔 → renderer 該把舊的 localStorage 內容搬上來
    initialized: hasNewsReaderState()
  }))

  registry.handle('news:reader-set-pinned', (_, items: unknown) => saveNewsReaderPinned(items))

  registry.handle('news:reader-set-dismissed', (_, ids: unknown) => saveNewsReaderDismissed(ids))

  // 首次從 localStorage 搬移（兩項一起寫，省一次來回）
  registry.handle('news:reader-migrate-state', (_, payload?: { pinnedItems?: unknown; dismissedIds?: unknown }) => {
    if (hasNewsReaderState()) return loadNewsReaderState()   // 已有共用狀態就不覆蓋
    return saveNewsReaderState({
      pinnedItems: payload?.pinnedItems as never,
      dismissedIds: payload?.dismissedIds as never
    })
  })

  // 新聞報：開啟／聚焦視窗（模組停用時不開窗）
  registry.handle('news:open-reader', () => {
    const settings = loadNewsModuleSettings()
    if (!settings.enabled) {
      return { ok: false as const, reason: 'module-disabled' as const }
    }
    createNewsReaderWindow()
    return { ok: true as const }
  })

  /** 整理一則新聞的 promptContext（抓原文／摘要）；供「聊這個」與面板重抓 */
  registry.handle('news:enrich-for-chat', async (_, payload?: {
    item?: Partial<NewsItem> & { title?: string; url?: string; id?: string }
    forceRefresh?: boolean
  }) => {
    const raw = payload?.item
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) {
      return { ok: false as const, error: 'empty' as const }
    }
    const item: NewsItem = {
      id: String(raw.id ?? ''),
      title: raw.title.trim(),
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      source: typeof raw.source === 'string' ? raw.source : '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      url: typeof raw.url === 'string' ? raw.url : '',
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
      sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : '',
      sourceType: (raw.sourceType as NewsItem['sourceType']) || 'keyword',
      sourceWeight: (raw.sourceWeight as NewsItem['sourceWeight']) || 'normal',
      keyword: raw.keyword,
      breakout: raw.breakout,
      category: raw.category,
      image: raw.image,
      lang: raw.lang
    }
    let appSettings: import('../../types').AppSettings | undefined
    try {
      const mod = await import('../../ipcHandlers')
      appSettings = mod.getSettings()
    } catch {
      appSettings = undefined
    }
    try {
      const enrich = await enrichNewsForChat(item, {
        forceRefresh: !!payload?.forceRefresh,
        appSettings
      })
      if (enrich.warning) console.warn('[news enrich]', item.id || item.title, enrich.warning)
      return {
        ok: true as const,
        promptContext: enrich.promptContext,
        source: enrich.source,
        usedUtility: enrich.usedUtility,
        warning: enrich.warning,
        item: applyEnrichToItem(item, enrich)
      }
    } catch (e) {
      console.warn('[news enrich] ipc failed', e)
      return {
        ok: true as const,
        promptContext: typeof raw.summary === 'string' ? raw.summary : '',
        source: 'rss-fallback' as const,
        usedUtility: false,
        warning: e instanceof Error ? e.message : String(e),
        item
      }
    }
  })

  /**
   * 新聞報「聊這個」確認後：只把標題塞進輸入框，並暫存 newsLink（含 promptContext）。
   * 下一次送出訊息時掛到使用者訊息上。
   */
  registry.handle('news:insert-to-input', (_, payload?: {
    title?: string
    summary?: string
    promptContext?: string
    newsId?: string
    sourceId?: string
    url?: string
    source?: string
    keyword?: string
  }) => {
    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    if (!title) return { ok: false as const, error: 'empty' }

    const promptContext = typeof payload?.promptContext === 'string'
      ? payload.promptContext.trim()
      : (typeof payload?.summary === 'string' ? payload.summary.trim() : '')

    const link: NewsLinkInfo = {
      id: typeof payload?.newsId === 'string' ? payload.newsId : '',
      sourceId: typeof payload?.sourceId === 'string' ? payload.sourceId : '',
      title,
      url: typeof payload?.url === 'string' ? payload.url : '',
      summary: typeof payload?.summary === 'string' ? payload.summary : '',
      source: typeof payload?.source === 'string' ? payload.source : '',
      keyword: typeof payload?.keyword === 'string' ? payload.keyword : undefined,
      promptContext
    }
    setPendingUserNewsLink(link)
    if (link.id) cacheManualPromptContext(link.id, promptContext)

    const fallback = screen.getPrimaryDisplay().workArea
    const win = createInputWindow({
      x: fallback.x + 80,
      y: fallback.y + fallback.height - 200
    })

    // UI 只塞標題；promptContext 走 pending newsLink
    const send = () => {
      if (win.isDestroyed()) return
      win.webContents.send('input:insert-news-topic', {
        text: title,
        meta: {
          newsId: link.id,
          sourceId: link.sourceId,
          title,
          promptContext
        }
      })
    }
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', send)
    } else {
      send()
    }
    return { ok: true as const }
  })
}
