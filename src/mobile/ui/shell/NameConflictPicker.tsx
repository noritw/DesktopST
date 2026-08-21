import { useEffect, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'

/**
 * 推送前的同名角色勾選（S2 M3，owner 2026-08-13 拍板）。
 *
 * ## 為什麼需要這一關
 *
 * 手機推角色到電腦時，如果電腦上已經有一隻同名、但沒有同步記錄的角色，
 * 舊版一律「當新角色送過去」——於是電腦上每推一次就多一隻同名角色。
 * owner 清理那些重複時留下的是手機推過去的新複本，而所有舊對話指向的是
 * 原本那隻的 id，**五月到八月的角色名字一次全部消失**（見 progress log）。
 *
 * ## 勾選的語意
 *
 * - **打勾＝覆蓋電腦上那隻**。電腦端會用名字對到它並**沿用它原本的 id**
 *   （`importDstPackDirect` 的 nameHit 分支），所以舊對話的連結不會斷。
 * - **沒打勾＝這次不推這隻**（不是「另外建一隻新的」）。
 *   刻意不提供「另建新角色」——那正是出事的那條路。真的想要第二隻同名角色，
 *   在手機上改個名字再推即可。
 *
 * 預設全選（owner 指定）：實際情況幾乎都是「同一隻角色在兩台裝置上」，
 * 全不選會讓大多數人第一次就白按一趟。
 */
export function NameConflictPicker(): JSX.Element | null {
  const box = useUiStore((s) => s.nameConflicts)
  const close = useUiStore((s) => s.closeNameConflicts)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  // 每次開啟都重設成「全選」，不要沿用上一趟的勾選狀態。
  useEffect(() => {
    setChecked(new Set((box?.items ?? []).map((i) => i.id)))
  }, [box])

  if (!box) return null

  const items = box.items
  const allChecked = checked.size === items.length
  const toggle = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-[62] flex flex-col bg-black/45" role="dialog" aria-label="電腦上已有同名角色">
      {/* 上半留白：點一下＝取消（與其他 Sheet 一致） */}
      <button type="button" aria-label="取消" className="flex-1" onClick={() => close(null)} />

      <div
        className="flex max-h-[80%] flex-col rounded-t-[18px] border-t border-[var(--border)] bg-[var(--bg)]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--text)]">電腦上已有同名角色</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-sub)]">
            打勾的會<span className="font-semibold text-[var(--text)]">覆蓋</span>
            電腦上那一隻（電腦上的對話記錄不會受影響）。沒打勾的這次就不推，電腦上維持原樣。
          </p>
        </div>

        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
          <span className="text-[11px] text-[var(--text-sub)]">
            已選 {checked.size} / {items.length}
          </span>
          <button
            type="button"
            onClick={() => setChecked(allChecked ? new Set() : new Set(items.map((i) => i.id)))}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)]"
          >
            {allChecked ? '全不選' : '全選'}
          </button>
        </div>

        <div className="scroll-y min-h-0 flex-1 px-2 py-1">
          {items.map((item) => {
            const on = checked.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-center gap-3 rounded-[12px] px-2 py-2.5 text-left active:bg-[var(--surface)]"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${
                    on ? 'border-[var(--mint)] bg-[var(--mint)]' : 'border-[var(--border)]'
                  }`}
                >
                  {on && <MonoIcon name="check" className="h-3.5 w-3.5 text-[var(--text)]" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{item.name}</span>
                <span className="shrink-0 text-[11px] text-[var(--text-sub)]">{on ? '覆蓋' : '不推'}</span>
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={() => close(null)}
            className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => close(checked)}
            className="flex-1 rounded-full bg-[var(--mint)] py-2.5 text-sm font-medium text-[var(--text)]"
          >
            繼續推送
          </button>
        </div>
      </div>
    </div>
  )
}
