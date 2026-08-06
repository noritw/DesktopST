import { useMemo, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import {
  groupSourcesByKeywordGroup,
  withNewKeyword,
  withSourceEnabled,
  withSourceGroup,
  withSourceLabel,
  withSourceWeight,
  withoutSource
} from '@core/news/reader'
import { DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId, withNewGroup, withoutGroup } from '@core/news/keywordGroups'
import type { NewsKeywordGroup, NewsSource, NewsWeight } from '@core/news/types'
import { useNewsStore } from './newsStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 興趣關鍵字管理（owner 2026-08-06 回報後重做；同一天再回報後加上關鍵字組 CRUD）。
 *
 * 原本「排序」在這裡、「新增／刪除／改權重／改分組」要另外跑一趟「設定」畫面——
 * owner 覺得應該合在一起，而且要一眼看出每個關鍵字在哪一組（不要靠下拉選單）。
 * 現在只有這一個地方能動 `sources` 或 `keywordGroups`，`NewsSettingsView` 的
 * 興趣關鍵字區塊已移除，兩處各自送出全量陣列互相蓋過去正是舊版
 * 「頻率一按全部跟著變」的成因（見 `newsStore.keywordsBusy`）。
 *
 * 每組摺疊成一個手風琴標頭（名稱 ＋ 則數），點了才展開內容——組一多，
 * 全部攤開會逼你在一長串清單裡找關鍵字在哪組；現在點開哪組就只看哪組。
 */
export function NewsKeywordsPanel(): JSX.Element {
  const keywordGroups = useNewsStore((s) => s.keywordGroups)
  const selectedReadGroups = useNewsStore((s) => s.readerKeywordGroupIds)
  const setKeywordGroups = useNewsStore((s) => s.setKeywordGroups)
  const sources = useNewsStore((s) => s.sources)
  const keywordsBusy = useNewsStore((s) => s.keywordsBusy)
  const mutateSources = useNewsStore((s) => s.mutateSources)
  const mutateGroups = useNewsStore((s) => s.mutateGroups)
  const moveSource = useNewsStore((s) => s.moveSource)
  const toggleOptions = useNewsStore((s) => s.toggleOptions)

  const buckets = useMemo(() => groupSourcesByKeywordGroup(sources, keywordGroups), [sources, keywordGroups])
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)
  const [expandedKeywordId, setExpandedKeywordId] = useState<string | null>(null)
  const [addingGroup, setAddingGroup] = useState(false)

  const addGroup = (name: string): void => {
    const prevIds = new Set(keywordGroups.map((g) => g.id))
    setAddingGroup(false)
    void mutateGroups((g) => withNewGroup(g, name), '新增關鍵字組').then(() => {
      // 新組存好後直接展開它，才能馬上往裡面加關鍵字，不必再找一次剛加的是哪組。
      const added = useNewsStore.getState().keywordGroups.find((g) => !prevIds.has(g.id))
      if (added) setExpandedGroupId(added.id)
    })
  }

  return (
    <div className="mb-2 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--text)]">管理關鍵字</span>
        {/* 右上角那顆 ✕ 是關掉整個新聞報，所以這一區要有自己的「完成」 */}
        <button
          type="button"
          onClick={toggleOptions}
          className="rounded-full bg-[var(--mint)] px-3 py-1 text-[12px] text-[var(--text)]"
        >
          完成
        </button>
      </div>

      {keywordGroups.length > 1 && (
        <>
          <p className="mt-3 text-[11px] text-[var(--text-sub)]">要抓哪些關鍵字組</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <GroupChip label="全部組" on={selectedReadGroups.length === 0} onClick={() => void setKeywordGroups([])} />
            {keywordGroups.map((g) => {
              const on = selectedReadGroups.includes(g.id)
              return (
                <GroupChip
                  key={g.id}
                  label={g.name}
                  on={on}
                  onClick={() =>
                    void setKeywordGroups(on ? selectedReadGroups.filter((x) => x !== g.id) : selectedReadGroups.concat([g.id]))
                  }
                />
              )
            })}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] text-[var(--text-sub)]">興趣關鍵字</p>
          {/* 沒有 hover 這種東西可用，存檔中就用文字明講，比靠顏色變化更不會被忽略 */}
          {keywordsBusy && <span className="text-[11px] text-[var(--text-sub)]">儲存中⋯⋯</span>}
        </div>
        <button
          type="button"
          aria-label="新增關鍵字組"
          disabled={keywordsBusy}
          onClick={() => setAddingGroup((v) => !v)}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border disabled:opacity-30 ${
            addingGroup ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-sub)]'
          }`}
        >
          <MonoIcon name="plus" className="h-3.5 w-3.5" />
        </button>
      </div>

      {addingGroup && (
        <NewGroupRow busy={keywordsBusy} onAdd={addGroup} onCancel={() => setAddingGroup(false)} />
      )}

      {buckets.map((bucket) => {
        const isOpen = expandedGroupId === bucket.group.id
        const isDefault = bucket.group.id === DEFAULT_KEYWORD_GROUP_ID
        return (
          <div key={bucket.group.id} className="mt-2 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpandedGroupId((cur) => (cur === bucket.group.id ? null : bucket.group.id))}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left"
              >
                <MonoIcon name={isOpen ? 'chevron-down' : 'chevron-right'} className="h-3.5 w-3.5 shrink-0 text-[var(--text-sub)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{bucket.group.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-sub)]">{bucket.sources.length}</span>
              </button>
              {/* 預設組不能刪（電腦端也會擋），不放這顆按鈕，免得點了才發現沒用 */}
              {!isDefault && (
                <GroupDeleteButton
                  groupName={bucket.group.name}
                  disabled={keywordsBusy}
                  onDelete={() => {
                    void mutateGroups((g) => withoutGroup(g, bucket.group.id), '刪除關鍵字組')
                    if (expandedGroupId === bucket.group.id) setExpandedGroupId(null)
                  }}
                />
              )}
            </div>

            {isOpen && (
              <div className="space-y-1 border-t border-[var(--border)] px-2.5 py-2">
                {bucket.sources.length === 0 && (
                  <p className="text-[12px] text-[var(--text-sub)]">這組還沒有關鍵字。</p>
                )}
                {bucket.sources.map((src, idx) => (
                  <KeywordRow
                    key={src.id}
                    src={src}
                    groups={keywordGroups}
                    disabled={keywordsBusy}
                    expanded={expandedKeywordId === src.id}
                    onToggleExpand={() => setExpandedKeywordId((cur) => (cur === src.id ? null : src.id))}
                    onMoveUp={idx > 0 ? () => void moveSource(src.id, -1) : undefined}
                    onMoveDown={idx < bucket.sources.length - 1 ? () => void moveSource(src.id, 1) : undefined}
                    onCycleWeight={() =>
                      void mutateSources((cur) => withSourceWeight(cur, src.id, nextWeight(src.weight)), '調整權重')
                    }
                    onToggleEnabled={() =>
                      void mutateSources((cur) => withSourceEnabled(cur, src.id, !src.enabled), '切換關鍵字')
                    }
                    onRename={(label) => void mutateSources((cur) => withSourceLabel(cur, src.id, label), '重新命名')}
                    onChangeGroup={(gid) => {
                      void mutateSources((cur) => withSourceGroup(cur, src.id, gid), '調整分組')
                      setExpandedKeywordId(null)
                    }}
                    onDelete={() => {
                      void mutateSources((cur) => withoutSource(cur, src.id), '刪除關鍵字')
                      setExpandedKeywordId(null)
                    }}
                  />
                ))}
                <QuickAddRow
                  busy={keywordsBusy}
                  placeholder={`新增到「${bucket.group.name}」`}
                  onAdd={(text) => void mutateSources((cur) => withNewKeyword(cur, text, bucket.group.id), '新增關鍵字')}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function nextWeight(w: NewsWeight): NewsWeight {
  const order: NewsWeight[] = ['often', 'normal', 'rarely']
  return order[(order.indexOf(w) + 1) % order.length]
}

const WEIGHT_LABELS: Record<NewsWeight, string> = { often: '常聊', normal: '普通', rarely: '偶爾' }

function KeywordRow({
  src, groups, disabled, expanded, onToggleExpand,
  onMoveUp, onMoveDown, onCycleWeight, onToggleEnabled, onRename, onChangeGroup, onDelete
}: {
  src: NewsSource
  groups: NewsKeywordGroup[]
  disabled: boolean
  expanded: boolean
  onToggleExpand: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onCycleWeight: () => void
  onToggleEnabled: () => void
  onRename: (label: string) => void
  onChangeGroup: (groupId: string) => void
  onDelete: () => void
}): JSX.Element {
  const confirm = useUiStore((s) => s.confirm)

  return (
    <div className={`rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 ${!src.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">{src.label}</span>

        <button
          type="button"
          disabled={disabled}
          onClick={onCycleWeight}
          className="shrink-0 rounded-full bg-[var(--mint)] px-2.5 py-1 text-[11px] text-[var(--text)] transition-transform active:scale-90 disabled:opacity-50"
        >
          {WEIGHT_LABELS[src.weight]}
        </button>

        <MoveButton icon="arrow-up" label={`${src.label} 上移`} disabled={disabled || !onMoveUp} onClick={onMoveUp} />
        <MoveButton icon="arrow-down" label={`${src.label} 下移`} disabled={disabled || !onMoveDown} onClick={onMoveDown} />

        {/* 與上面兩顆常用按鈕拉開間距，編輯／刪除藏在這顆後面，不會被誤按到 */}
        <button
          type="button"
          aria-label={`${src.label} 更多`}
          disabled={disabled}
          onClick={onToggleExpand}
          className={`ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[var(--text-sub)] disabled:opacity-30 ${
            expanded ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]' : 'border-[var(--border)]'
          }`}
        >
          <MonoIcon name="more" className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
          <label className="flex items-center gap-2 text-[12px] text-[var(--text)]">
            <input
              type="checkbox"
              checked={src.enabled}
              disabled={disabled}
              onChange={onToggleEnabled}
              className="h-4 w-4 accent-[var(--mint2)]"
            />
            啟用這個關鍵字
          </label>

          <RenameField label={src.label} disabled={disabled} onRename={onRename} />

          {groups.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-sub)]">移到</span>
              {groups
                .filter((g) => g.id !== effectiveGroupId(src.groupId))
                .map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChangeGroup(g.id)}
                    className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-sub)] disabled:opacity-50"
                  >
                    {g.name}
                  </button>
                ))}
            </div>
          )}

          {/* 刪除獨立一行、危險色，跟上面幾顆日常操作的按鈕拉開，降低誤按機率 */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              void confirm({
                title: `刪除「${src.label}」？`,
                message: '之後不會再用這個關鍵字抓新聞。可以再加回來。',
                confirmLabel: '刪除',
                destructive: true
              }).then((ok) => {
                if (ok) onDelete()
              })
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--danger)] py-1.5 text-[12px] text-[var(--danger-text)] disabled:opacity-50"
          >
            <MonoIcon name="trash" className="h-3.5 w-3.5" />
            刪除
          </button>
        </div>
      )}
    </div>
  )
}

/** 標籤改名：uncontrolled + onBlur，避免打字打到一半就送出（同則數輸入框的理由）。 */
function RenameField({
  label, disabled, onRename
}: {
  label: string
  disabled: boolean
  onRename: (label: string) => void
}): JSX.Element {
  return (
    <input
      key={label}
      className="field text-[13px]"
      defaultValue={label}
      disabled={disabled}
      aria-label="關鍵字名稱"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
      }}
      onBlur={(e) => {
        const next = e.target.value.trim()
        if (next && next !== label) onRename(next)
        else e.target.value = label
      }}
    />
  )
}

function QuickAddRow({
  placeholder, busy, onAdd
}: {
  placeholder: string
  busy: boolean
  onAdd: (text: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setText('')
  }
  return (
    <div className="mt-1.5 flex gap-1.5">
      <input
        className="field flex-1 text-[13px]"
        value={text}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 組字中（注音／拼音）的 Enter 是選字不是送出，不擋會半個詞就送出去
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={submit}
        aria-label="新增關鍵字"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)] transition-transform active:scale-90 disabled:opacity-50"
      >
        <MonoIcon name="plus" className="h-4 w-4" />
      </button>
    </div>
  )
}

/** 新增關鍵字組。放在「興趣關鍵字」小標題旁那顆「+」點開，跟每組底下的
 *  `QuickAddRow`（新增關鍵字）分開，避免「新增組」跟「新增關鍵字」兩個按鈕長得一樣。 */
function NewGroupRow({
  busy, onAdd, onCancel
}: {
  busy: boolean
  onAdd: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState('')
  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setText('')
  }
  return (
    <div className="mt-1.5 flex gap-1.5">
      <input
        className="field flex-1 text-[13px]"
        value={text}
        placeholder="新增關鍵字組，例如：遊戲"
        disabled={busy}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={submit}
        aria-label="新增關鍵字組"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)] transition-transform active:scale-90 disabled:opacity-50"
      >
        <MonoIcon name="plus" className="h-4 w-4" />
      </button>
    </div>
  )
}

function GroupChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] ${
        on
          ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-sub)]'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * 刪除整組。**兩層防呆**：先要點中這顆遠離主要操作區的小按鈕，
 * 再過一次確認對話框才會真的刪——組是比單一關鍵字影響範圍更大的操作
 * （owner 原話「危險操作要藏得深一點」）。
 */
function GroupDeleteButton({
  groupName, disabled, onDelete
}: {
  groupName: string
  disabled: boolean
  onDelete: () => void
}): JSX.Element {
  const confirm = useUiStore((s) => s.confirm)
  return (
    <button
      type="button"
      aria-label={`刪除「${groupName}」組`}
      disabled={disabled}
      onClick={() => {
        void confirm({
          title: `刪除「${groupName}」組？`,
          message: '組內的關鍵字不會一起刪掉，會歸回預設組。',
          confirmLabel: '刪除',
          destructive: true
        }).then((ok) => {
          if (ok) onDelete()
        })
      }}
      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--border)] disabled:opacity-30"
    >
      <MonoIcon name="more" className="h-4 w-4" />
    </button>
  )
}

function MoveButton({
  icon, label, disabled, onClick
}: {
  icon: 'arrow-up' | 'arrow-down'
  label: string
  disabled: boolean
  onClick?: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-sub)] transition-transform active:scale-90 active:bg-[var(--mint)] disabled:opacity-30 disabled:active:scale-100 disabled:active:bg-transparent"
    >
      <MonoIcon name={icon} className="h-4 w-4" />
    </button>
  )
}
