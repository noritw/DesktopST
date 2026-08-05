import { useCallback, useEffect, useState } from 'react'
import { getData, useAppStore } from '../stores/appStore'

/** 角色列上方的對話背景：只留情境與世界觀，避免吃掉聊天空間。 */
export function CurrentContext(): JSX.Element | null {
  const snapshot = useAppStore((s) => s.snapshot)
  const [labels, setLabels] = useState({ scene: '', world: '' })
  const load = useCallback(async () => {
    try {
      const api = getData().presets
      const [scenes, worlds] = await Promise.all([api.listScenes(), api.listWorlds()])
      setLabels({
        scene: scenes.find(x => x.id === snapshot?.activeSceneId)?.name ?? '',
        world: worlds.find(x => x.id === snapshot?.activeWorldId)?.name ?? ''
      })
    } catch { /* 標籤載不到時不阻擋聊天 */ }
  }, [snapshot?.activeSceneId, snapshot?.activeWorldId])
  useEffect(() => { void load() }, [load])
  if (!labels.scene && !labels.world) return null
  return <div className="flex shrink-0 items-center gap-1 overflow-x-auto bg-[var(--surface)] px-4 py-1 text-[11px] text-[var(--text-sub)]">
    {labels.scene && <span className="rounded-full bg-[var(--lavender)]/60 px-2 py-0.5">情境：{labels.scene}</span>}
    {labels.world && <span className="rounded-full bg-[var(--aqua)]/60 px-2 py-0.5">世界：{labels.world}</span>}
  </div>
}
