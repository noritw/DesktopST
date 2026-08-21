import { useCallback, useEffect, useState } from 'react'
import type { PresetListItem } from '@core/data'
import type { PersonaPreset } from '@core/types'
import MonoIcon from '@shared/MonoIcon'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

/** 輸入前確認「我是誰」；名稱可直接切換，也可一鍵跳進編輯不必繞去設定頁。 */
export function PersonaIdentity(): JSX.Element | null {
  const activeId = useAppStore((s) => s.snapshot?.activePersonaId)
  // 這個元件常駐在輸入框上方、不會像 sheet 那樣每次打開都重新掛載——
  // 只用 activeId 當 deps 的話，刪掉／改名一個「不是目前使用中」的使用者設定時
  // activeId 不會變，選單會一直留著已經刪掉的那個選項，直到整個 App 重新整理
  // （owner 2026-08-05 實機回報）。改成整包 `snapshot` 當 deps，
  // 每次 state-invalidated 重抓狀態都順便刷新選單清單。
  const snapshot = useAppStore((s) => s.snapshot)
  const refresh = useAppStore((s) => s.refresh)
  const toast = useUiStore((s) => s.toast)
  const push = useUiStore((s) => s.push)
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
  useEffect(() => { void load() }, [load, snapshot])
  if (!activeId || !active) return null
  const name = active.displayName.trim() || active.nickname.trim() || active.name
  const switchPersona = async (id: string): Promise<void> => {
    try {
      await getData().presets.activatePersona(id)
      await refresh()
    } catch (e) { toast(describeSettingsError(e, '切換使用者身分'), 'error') }
  }
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1.5 text-xs text-[var(--text-sub)]">
      <span>發言身分</span>
      <select
        aria-label="目前使用者身分"
        value={activeId}
        onChange={(e) => void switchPersona(e.target.value)}
        className="max-w-[12rem] rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-semibold text-[var(--text)] outline-none"
      >
        {personas.map(p => <option key={p.id} value={p.id}>{p.id === activeId ? name : p.name}</option>)}
      </select>
      {/* 快速跳進目前身分的編輯頁，省去繞去設定裡找（owner 2026-08-10 需求）。 */}
      <button
        type="button"
        aria-label="編輯目前使用者身分"
        onClick={() => push('preset-editor', `persona:${activeId}`)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--border)]"
      >
        <MonoIcon name="edit" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
