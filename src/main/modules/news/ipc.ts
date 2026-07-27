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
import { loadReminders, saveReminders } from '../../fileStore'
import { reloadReminders } from '../../reminderScheduler'
import {
  openSettingsWindow,
  createNewsReaderWindow,
  createInputWindow
} from '../../windowManager'
import type { NewsModuleSettings } from './types'
import type { ReminderSchedule } from '../../types'

/** 新聞模組自動排程提醒的固定 ID，由模組設定驅動、不出現在「提醒管理員」 */
const NEWS_SCHEDULER_REMINDER_ID = 'news-module-scheduler'

export function registerNewsIpcHandlers(registry: ModuleIpcRegistry = ipcMain): void {
  // 讀取目前模組設定（設定面板初始化用）
  registry.handle('news:get-settings', () => loadNewsModuleSettings())

  // 儲存設定（傳整份或部分；後端會正規化）
  //
  // 一定要先跟磁碟上的現況合併：normalizeNewsModuleSettings() 是把收到的物件當「整份設定」
  // 正規化，沒帶到的欄位一律回預設值。新聞報視窗的欄位排序 / 則數 / 關鍵字組多選都只送 partial，
  // 不合併的話按一下就會把 enabled、關鍵字、黑名單、地方新聞、排程全部清成預設。
  registry.handle('news:save-settings', (_, partial: Partial<NewsModuleSettings>) => {
    const current = loadNewsModuleSettings()
    return saveNewsModuleSettings({ ...current, ...(partial ?? {}) })
  })

  // 只切換啟用 / 停用（擴充分頁的開關）
  registry.handle('news:set-enabled', (_, enabled: boolean) => {
    const current = loadNewsModuleSettings()
    return saveNewsModuleSettings({ ...current, enabled: !!enabled })
  })

  // 一鍵重置學習權重（design §9）
  registry.handle('news:reset-feedback', () => {
    const current = loadNewsModuleSettings()
    return saveNewsModuleSettings({ ...current, feedback: { adjustments: {} } })
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
    return saveNewsModuleSettings({
      ...current,
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

  // 新聞定時排程：在 reminders 檔維護一條固定的特殊 Reminder（排程器自動吃到）
  registry.handle('news:sync-scheduler', (_, payload: { enabled: boolean; schedule?: ReminderSchedule }) => {
    const reminders = loadReminders().filter(r => r.id !== NEWS_SCHEDULER_REMINDER_ID)
    if (payload?.enabled && payload.schedule) {
      reminders.push({
        id: NEWS_SCHEDULER_REMINDER_ID,
        label: '新聞陪聊（自動）',
        prompt: '',
        schedule: payload.schedule,
        enabled: true,
        injectNews: true,
        createdAt: Date.now()
      })
    }
    saveReminders(reminders)
    reloadReminders()
    const s = loadNewsModuleSettings()
    saveNewsModuleSettings({ ...s, reminder: { enabled: !!payload?.enabled, schedule: payload?.schedule } })
    return { ok: true }
  })

  registry.handle('news:get-scheduler', () => {
    const s = loadNewsModuleSettings()
    const active = loadReminders().find(r => r.id === NEWS_SCHEDULER_REMINDER_ID)
    return { enabled: !!active?.enabled, schedule: s.reminder.schedule }
  })

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

  // 新聞報：把標題／摘要插入發話視窗
  registry.handle('news:insert-to-input', (_, payload?: {
    title?: string
    summary?: string
    newsId?: string
    sourceId?: string
  }) => {
    const title = typeof payload?.title === 'string' ? payload.title : ''
    const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : ''
    const text = summary ? `${title}\n${summary}` : title
    if (!text) return { ok: false as const, error: 'empty' }

    const fallback = screen.getPrimaryDisplay().workArea
    const win = createInputWindow({
      x: fallback.x + 80,
      y: fallback.y + fallback.height - 200
    })

    const meta = {
      newsId: typeof payload?.newsId === 'string' ? payload.newsId : '',
      sourceId: typeof payload?.sourceId === 'string' ? payload.sourceId : '',
      title
    }
    const send = () => {
      if (win.isDestroyed()) return
      win.webContents.send('input:insert-news-topic', { text, meta })
    }
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', send)
    } else {
      send()
    }
    return { ok: true as const }
  })
}
