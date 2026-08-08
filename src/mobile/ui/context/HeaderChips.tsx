import { useCallback, useEffect, useState } from 'react'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * Header 上的狀態標籤（owner 2026-08-06 設計）。
 *
 * 取代原本掛在角色列上方的 `CurrentContext`。三個標籤同時是**顯示**與**入口**：
 * 一眼看到「現在在哪個對話、套了哪個情境與世界觀」，點下去就能換 ——
 * 省掉一整條獨立的狀態列，也省掉 header 上那排猜不出用途的 emoji 按鈕。
 *
 * ⚠️ **deps 用整包 `snapshot` 而不是那幾個 id。**
 * 這個元件常駐在 header、不會像 sheet 那樣每次打開都重新掛載；
 * 改名「不是目前使用中」的情境或世界觀時 id 完全不會變，
 * 只看 id 的話標籤會一直顯示舊名字（`PersonaIdentity.tsx` 踩過同一個坑）。
 */
export function HeaderChips(): JSX.Element | null {
  const snapshot = useAppStore((s) => s.snapshot)
  const push = useUiStore((s) => s.push)
  const [labels, setLabels] = useState({ scene: '', world: '' })

  const load = useCallback(async () => {
    try {
      const api = getData().presets
      const [scenes, worlds] = await Promise.all([api.listScenes(), api.listWorlds()])
      setLabels({
        scene: scenes.find((x) => x.id === snapshot?.activeSceneId)?.name ?? '',
        world: worlds.find((x) => x.id === snapshot?.activeWorldId)?.name ?? ''
      })
    } catch {
      /* 標籤載不到時不阻擋聊天 */
    }
  }, [snapshot])
  useEffect(() => {
    void load()
  }, [load])

  const conversationTitle = snapshot?.conversation?.title?.trim()
  if (!conversationTitle && !labels.scene && !labels.world) return null

  const sceneLabel = labels.scene
    ? `${labels.scene}${snapshot?.activeSceneDirty ? ' *' : ''}`
    : ''

  /*
   * ⚠️ 不要 `overflow-x-auto`。
   * 標籤字一長右邊就會冒出橫向捲軸（owner 2026-08-08），看起來像壞掉。
   * 改成 `overflow-hidden` + 每顆 chip 可收縮截斷，擠不下就省略號，不出現捲軸。
   */
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {conversationTitle && (
        <Chip prefix="對話" value={conversationTitle} onClick={() => push('conversations')} />
      )}
      {labels.scene && (
        <Chip
          prefix="情境"
          value={sceneLabel}
          title={snapshot?.activeSceneDirty ? '目前狀態與情境不一致，可到情境頁覆寫存回' : undefined}
          onClick={() => push('presets', 'scene')}
        />
      )}
      {labels.world && <Chip prefix="世界" value={labels.world} onClick={() => push('presets', 'world')} />}
    </div>
  )
}

/**
 * 前綴用淡色小字、值用正常色 —— 三個抽象概念用圖示表達只會變成另一輪「這是什麼意思」，
 * 直接寫字最清楚（正是這次要解決的問題）。
 */
function Chip({
  prefix,
  value,
  onClick,
  title
}: {
  prefix: string
  value: string
  onClick: () => void
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`${prefix}：${value}，點此更換`}
      className="flex min-w-0 max-w-[9rem] shrink items-center gap-1 rounded-full bg-[var(--surface)]/70 px-2 py-1 text-[11px] active:bg-[var(--surface)]"
    >
      <span className="shrink-0 text-[var(--text-sub)]">{prefix}</span>
      <span className="truncate font-medium text-[var(--text)]">{value}</span>
    </button>
  )
}
