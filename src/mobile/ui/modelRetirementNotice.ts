import { modelPriceText } from '@core/llm/modelCatalog'
import {
  applyRetiredModels, clearSwitched, markNotified, pendingRetirementNotices, replaceModel,
  retirementNoticeText, switchedNoticeText
} from '@core/llm/modelRetirement'
import type { StandaloneSession } from '../runtime/session'
import { useUiStore } from './stores/uiStore'

let running = false

/** 本機模式的模型停用通知。遙控模式用的是電腦的設定，由電腦自己跳。 */
export async function notifyModelRetirement(session: StandaloneSession): Promise<void> {
  if (running) return
  running = true
  try {
    const llm = session.settings.llm
    const persist = async (): Promise<void> => {
      await session.saveSettings()
      session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    }
    if (applyRetiredModels(llm, Date.now())) await persist()

    // `uiStore.dialog` 只有一個位子，已經開著別的就不搶，下次回到前景再說
    const ui = useUiStore.getState
    if (ui().dialog) return
    const switched = switchedNoticeText(llm)
    if (switched) {
      await ui().confirm({ ...switched, confirmLabel: '知道了', cancelLabel: '關閉' })
      clearSwitched(session.settings.llm)
      await persist()
    }
    for (const n of pendingRetirementNotices(session.settings.llm, Date.now())) {
      if (ui().dialog) return
      const ok = await ui().confirm({
        ...retirementNoticeText(n, modelPriceText),
        confirmLabel: '立即更換',
        cancelLabel: '先不要'
      })
      // 對話框開著的期間設定可能被換成新物件，一律重新取
      if (ok) replaceModel(session.settings.llm, n.provider, n.from, n.to)
      markNotified(session.settings.llm, n)
      await persist()
    }
  } finally {
    running = false
  }
}
