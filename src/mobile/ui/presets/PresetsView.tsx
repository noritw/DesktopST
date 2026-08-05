import { useCallback, useEffect, useState } from 'react'
import type { PresetListItem } from '@core/data'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'
import { useAppStore } from '../stores/appStore'

type Kind = 'scene' | 'persona' | 'world'

const labels: Record<Kind, string> = { scene: '情境', persona: '使用者設定', world: '世界觀' }

/** 預設組入口：切換與進入編輯分開，避免誤碰一列就改掉正在使用的設定。 */
export function PresetsView(): JSX.Element {
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const refresh = useAppStore((s) => s.refresh)
  const [lists, setLists] = useState<Record<Kind, PresetListItem[]> | null>(null)
  const [active, setActive] = useState({ persona: '', world: '' })
  const [activeScene, setActiveScene] = useState('')

  const load = useCallback(async () => {
    try {
      const data = getData()
      const [scene, persona, world, personaId, worldId, sceneId] = await Promise.all([
        data.presets.listScenes(), data.presets.listPersonas(), data.presets.listWorlds(),
        data.presets.activePersonaId(), data.presets.activeWorldId(), data.presets.activeSceneId()
      ])
      setLists({ scene, persona, world }); setActive({ persona: personaId, world: worldId }); setActiveScene(sceneId ?? '')
    } catch (e) { toast(describeSettingsError(e, '載入預設組'), 'error') }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const apply = async (kind: Kind, id: string): Promise<void> => {
    try {
      const api = getData().presets
      if (kind === 'scene') await api.applyScene(id)
      else if (kind === 'persona') await api.activatePersona(id)
      else await api.activateWorld(id)
      if (kind !== 'scene') setActive((x) => ({ ...x, [kind]: id })); else setActiveScene(id)
      await refresh()
      toast(`已套用${labels[kind]}`)
    } catch (e) { toast(describeSettingsError(e, `套用${labels[kind]}`), 'error') }
  }

  if (!lists) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
  return <div className="space-y-5 pb-2">
    {(['scene', 'persona', 'world'] as Kind[]).map((kind) => <section key={kind}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">{labels[kind]}</h3>
        <button type="button" onClick={() => push('preset-editor', `${kind}:new`)} className="rounded-full bg-[var(--mint)] px-3 py-1 text-xs text-[var(--text)]">＋ 新增</button>
      </div>
      <div className="space-y-2">
        {lists[kind].map((item) => {
          const isActive = (kind === 'scene' && activeScene === item.id) || (kind !== 'scene' && active[kind] === item.id)
          return <div key={item.id} className={`flex items-center gap-2 rounded-[14px] border px-3 py-2.5 ${isActive ? 'border-[var(--mint)] bg-[var(--mint)]/25' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void apply(kind, item.id)}>
              <p className="truncate text-sm text-[var(--text)]">{item.name}</p>
              <p className={`mt-0.5 text-[11px] ${isActive ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-sub)]'}`}>{isActive ? '✓ 目前使用中' : '點此套用'}</p>
            </button>
            <button type="button" aria-label={`編輯${item.name}`} onClick={() => push('preset-editor', `${kind}:${item.id}`)} className="rounded-full px-2 py-1 text-sm active:bg-[var(--border)]">✏️</button>
          </div>
        })}
      </div>
    </section>)}
  </div>
}
