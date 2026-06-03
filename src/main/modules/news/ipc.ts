import { ipcMain } from 'electron'
import type { ModuleIpcRegistry } from '../moduleTypes'
import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { fetchAllSources } from './sources'
import { filterAndPick } from './filter'
import type { NewsModuleSettings } from './types'

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
    const seenIds = payload?.id && !current.seenIds.includes(payload.id)
      ? [...current.seenIds, payload.id].slice(-500)
      : current.seenIds
    return saveNewsModuleSettings({
      ...current,
      feedback: { adjustments },
      blacklist,
      excludedSources,
      seenIds
    })
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
}
