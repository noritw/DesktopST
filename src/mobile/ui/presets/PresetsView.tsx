import { useCallback, useEffect, useState } from 'react'
import type { PresetListItem } from '@core/data'
import MonoIcon from '@shared/MonoIcon'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'
import { ToggleRow } from '../settings/SettingsView'
import { StatusChip } from '../shell/StatusChip'

/**
 * 情境／使用者設定／世界觀／用語解說 —— 四組「設定資料」集中在同一頁。
 *
 * ## 2026-08-06 owner 回報後的兩個改動
 *
 * 1. **用語解說搬進來**。它原本自己一個畫面、掛在「設定 → 進階」底下，
 *    但它跟情境／世界觀是同一類東西（都是「這次對話用哪一組設定」），
 *    分開放使用者找不到。
 * 2. **四區塊改成展開式**。四組清單全部攤開會很長，
 *    改成點標題才展開，預設只展開被指定的那一組（`openParam`）。
 *
 * `openParam` 由 header 的狀態標籤帶進來（點「情境」就直接展開情境那組），
 * 沒帶就展開第一組。
 */

type Kind = 'scene' | 'persona' | 'world' | 'lore'

const LABELS: Record<Kind, string> = {
  scene: '情境',
  persona: '使用者設定',
  world: '世界觀',
  lore: '用語解說'
}

const HINTS: Record<Kind, string> = {
  scene: '一次套用一整組設定（使用者、世界觀、在場角色）。',
  persona: '你是誰。角色會用這個身分稱呼你。',
  world: '故事發生的背景設定。',
  lore: '讓角色聽得懂你世界裡的專有名詞。要哪個角色或情境使用，在該編輯畫面勾選。'
}

const KINDS: Kind[] = ['scene', 'persona', 'world', 'lore']

export function PresetsView({ openParam }: { openParam?: string }): JSX.Element {
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const refresh = useAppStore((s) => s.refresh)
  const activeSceneDirty = useAppStore((s) => s.snapshot?.activeSceneDirty === true)
  // 未設定＝開啟，與 `showLlmBadge` 同一個慣例。
  const showPersonaName = useAppStore((s) => s.snapshot?.showPersonaName !== false)

  const toggleShowPersonaName = async (): Promise<void> => {
    try {
      await getData().settings.setShowPersonaName(!showPersonaName)
      await refresh()
    } catch (e) {
      toast(describeSettingsError(e, '切換發話身分標示'), 'error')
    }
  }

  const [lists, setLists] = useState<Record<Kind, PresetListItem[]> | null>(null)
  const [active, setActive] = useState({ persona: '', world: '' })
  const [activeScene, setActiveScene] = useState('')
  const [open, setOpen] = useState<Kind>(
    KINDS.includes(openParam as Kind) ? (openParam as Kind) : 'scene'
  )

  const load = useCallback(async () => {
    try {
      const data = getData()
      const [scene, persona, world, lore, personaId, worldId, sceneId] = await Promise.all([
        data.presets.listScenes(),
        data.presets.listPersonas(),
        data.presets.listWorlds(),
        data.lorebooks.list(),
        data.presets.activePersonaId(),
        data.presets.activeWorldId(),
        data.presets.activeSceneId()
      ])
      setLists({ scene, persona, world, lore })
      setActive({ persona: personaId, world: worldId })
      setActiveScene(sceneId ?? '')
    } catch (e) {
      toast(describeSettingsError(e, '載入設定組'), 'error')
    }
  }, [toast])
  useEffect(() => {
    void load()
  }, [load])

  const apply = async (kind: Kind, id: string): Promise<void> => {
    try {
      const api = getData().presets
      if (kind === 'scene') await api.applyScene(id)
      else if (kind === 'persona') await api.activatePersona(id)
      else await api.activateWorld(id)
      if (kind === 'scene') setActiveScene(id)
      else setActive((x) => ({ ...x, [kind]: id }))
      await refresh()
      toast(`已套用${LABELS[kind]}`)
    } catch (e) {
      toast(describeSettingsError(e, `套用${LABELS[kind]}`), 'error')
    }
  }

  /** 把目前配色／Persona／世界觀等覆寫回使用中的情境（對應桌面「覆寫為目前狀態」）。 */
  const captureActive = async (id: string): Promise<void> => {
    try {
      await getData().presets.captureScene(id)
      await refresh()
      await load()
      toast('已把目前狀態存回情境')
    } catch (e) {
      toast(describeSettingsError(e, '覆寫情境'), 'error')
    }
  }

  /** 用語解說沒有「套用」，新增後直接進編輯器；其餘三種是新增空白預設組。 */
  const add = async (kind: Kind): Promise<void> => {
    if (kind !== 'lore') {
      push('preset-editor', `${kind}:new`)
      return
    }
    try {
      const book = await getData().lorebooks.create()
      await load()
      push('lorebook-editor', book.id)
    } catch (e) {
      toast(describeSettingsError(e, '新增用語解說'), 'error')
    }
  }

  if (!lists) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="space-y-2 pb-2">
      {KINDS.map((kind) => {
        const expanded = open === kind
        const items = lists[kind]
        return (
          <section key={kind} className="overflow-hidden rounded-[14px] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setOpen(expanded ? ('' as Kind) : kind)}
              className="flex w-full items-center gap-2 bg-[var(--bg)] px-3 py-2.5 text-left active:bg-[var(--surface)]"
            >
              <MonoIcon
                name={expanded ? 'chevron-down' : 'chevron-right'}
                className="h-4 w-4 shrink-0 text-[var(--text-sub)]"
              />
              <span className="flex-1 text-sm font-semibold text-[var(--text)]">{LABELS[kind]}</span>
              <span className="text-[11px] text-[var(--text-sub)]">{items.length}</span>
            </button>

            {expanded && (
              <div className="space-y-2 border-t border-[var(--border)] bg-[var(--surface)]/30 px-3 py-3">
                <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">{HINTS[kind]}</p>

                {/* 顯示開關放這裡而不是設定頁：會想關掉它的人，正是在這頁切身分的人。
                    真值住在快照（與電腦端共用 `ui.showPersonaName`），不另存本地 state。 */}
                {kind === 'persona' && (
                  <>
                    <ToggleRow
                      label="在對話裡標示發話身分"
                      checked={showPersonaName}
                      onChange={() => void toggleShowPersonaName()}
                    />
                    <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
                      你的訊息上方會顯示當時是用哪個身分說的。切著好幾個身分玩角色扮演時才分得出誰是誰。
                    </p>
                  </>
                )}
                {kind === 'scene' && activeSceneDirty && (
                  <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
                    ＊ 目前狀態與使用中的情境不一致（例如改過配色）。可按「存回目前狀態」寫進情境。
                  </p>
                )}

                {items.length === 0 && (
                  <p className="py-2 text-center text-xs text-[var(--text-sub)]">還沒有任何{LABELS[kind]}。</p>
                )}

                {items.map((item) => {
                  const isActive =
                    kind === 'scene'
                      ? activeScene === item.id
                      : kind === 'lore'
                        ? false
                        : active[kind as 'persona' | 'world'] === item.id
                  const dirty = kind === 'scene' && isActive && activeSceneDirty
                  return (
                    <Row
                      key={item.id}
                      kind={kind}
                      item={item}
                      isActive={isActive}
                      dirty={dirty}
                      onPrimary={() =>
                        kind === 'lore' ? push('lorebook-editor', item.id) : void apply(kind, item.id)
                      }
                      onEdit={() =>
                        kind === 'lore'
                          ? push('lorebook-editor', item.id)
                          : push('preset-editor', `${kind}:${item.id}`)
                      }
                      onCapture={dirty ? () => void captureActive(item.id) : undefined}
                    />
                  )
                })}

                <button
                  type="button"
                  onClick={() => void add(kind)}
                  className="flex w-full items-center justify-center gap-1 rounded-full bg-[var(--mint)] py-2 text-xs text-[var(--text)]"
                >
                  <MonoIcon name="plus" className="h-3.5 w-3.5" />
                  新增{LABELS[kind]}
                </button>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * 清單列：左邊點名稱編輯、右邊大標籤套用（owner 2026-08-08）。
 *
 * 套用／加入比編輯常用，所以動作標籤放右邊、做得稍大；編輯只留名稱可點＋小鉛筆。
 * 用語解說沒有「套用」，整列都是進編輯，不顯示右側 chip（避免「點此編輯」廢話）。
 */
function Row({
  kind,
  item,
  isActive,
  dirty,
  onPrimary,
  onEdit,
  onCapture
}: {
  kind: Kind
  item: PresetListItem
  isActive: boolean
  dirty?: boolean
  onPrimary: () => void
  onEdit: () => void
  onCapture?: () => void
}): JSX.Element {
  const applyLabel = isActive
    ? dirty
      ? '使用中 *'
      : '使用中'
    : '套用'

  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 ${
        isActive ? 'border-[var(--mint)] bg-[var(--mint)]/25' : 'border-[var(--border)] bg-[var(--bg)]'
      }`}
    >
      <div className="flex items-center gap-3">
        {/*
          名稱一整塊可點進編輯；小鉛筆放名稱*下方*，與右側套用拉開距離
          （owner 2026-08-09：鉛筆貼在套用旁邊太近）。
        */}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}>
          <p className="truncate text-sm text-[var(--text)]">
            {item.name}
            {dirty ? ' *' : ''}
          </p>
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-[var(--text-sub)]">
            <MonoIcon name="edit" className="h-3 w-3" />
            編輯
          </span>
        </button>
        {kind !== 'lore' && (
          <StatusChip
            active={isActive}
            onClick={onPrimary}
            ariaLabel={isActive ? `${item.name}目前使用中` : `套用${item.name}`}
          >
            {applyLabel}
          </StatusChip>
        )}
      </div>
      {onCapture && (
        <button
          type="button"
          onClick={onCapture}
          className="mt-2 w-full rounded-full border border-[var(--border)] py-1.5 text-[11px] text-[var(--text)] active:bg-[var(--surface)]"
        >
          存回目前狀態
        </button>
      )}
    </div>
  )
}
