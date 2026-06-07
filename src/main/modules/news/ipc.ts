import { ipcMain } from 'electron'
import type { ModuleIpcRegistry } from '../moduleTypes'
import { loadNewsModuleSettings, saveNewsModuleSettings, applyNewsFeedbackDelta } from './settings'
import { fetchAllSources } from './sources'
import { filterAndPick } from './filter'
import { loadReminders, saveReminders } from '../../fileStore'
import { reloadReminders } from '../../reminderScheduler'
import type { NewsModuleSettings } from './types'
import type { ReminderSchedule } from '../../types'

/** 新聞模組自動排程提醒的固定 ID，由模組設定驅動、不出現在「提醒管理員」 */
const NEWS_SCHEDULER_REMINDER_ID = 'news-module-scheduler'

export function registerNewsIpcHandlers(registry: ModuleIpcRegistry = ipcMain): void {
  // 讀取目前模組設定（設定面板初始化用）
  registry.handle('news:get-settings', () => loadNewsModuleSettings())

  // 儲存設定（傳整份或部分；後端會正規化）
  registry.handle('news:save-settings', (_, partial: Partial<NewsModuleSettings>) => {
    return saveNewsModuleSettings(partial ?? {})
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
}
