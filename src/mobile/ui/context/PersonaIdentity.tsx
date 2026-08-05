import { useCallback, useEffect, useState } from 'react'
import type { PresetListItem } from '@core/data'
import type { PersonaPreset } from '@core/types'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

/** 輸入前確認「我是誰」；名稱可直接切換，不必跳去設定頁找。 */
export function PersonaIdentity(): JSX.Element | null {
  const activeId = useAppStore((s) => s.snapshot?.activePersonaId)
  const refresh = useAppStore((s) => s.refresh)
  const toast = useUiStore((s) => s.toast)
  const [personas, setPersonas] = useState<PresetListItem[]>([])
  const [active, setActive] = useState<PersonaPreset | null>(null)
  const load = useCallback(async () => {
    if (!activeId) return
    try {
      const api = getData().presets
      const [list, preset] = await Promise.all([api.listPersonas(), api.getPersona(activeId)])
      setPersonas(list); setActive(preset)
    } catch { /* 不阻擋輸入；下一次狀態更新會重試 */ }
  }, [activeId])
  useEffect(() => { void load() }, [load])
  if (!activeId || !active) return null
  const name = active.displayName.trim() || active.nickname.trim() || active.name
  const switchPersona = async (id: string): Promise<void> => {
    try {
      await getData().presets.activatePersona(id)
      await refresh()
    } catch (e) { toast(describeSettingsError(e, '切換使用者身分'), 'error') }
  }
  return <div className="flex items-center gap-1 px-3 pt-1.5 text-xs text-[var(--text-sub)]">
    <span>目前以</span>
    <select aria-label="目前使用者身分" value={activeId} onChange={(e) => void switchPersona(e.target.value)} className="max-w-[12rem] rounded-full bg-[var(--butter)]/70 px-2 py-0.5 font-semibold text-[var(--text)] outline-none">
      {personas.map(p => <option key={p.id} value={p.id}>{p.id === activeId ? name : p.name}</option>)}
    </select>
    <span>發言</span>
  </div>
}
