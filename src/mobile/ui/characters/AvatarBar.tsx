import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

/**
 * 頂端角色頭像列（清單 D1）。
 *
 * 點頭像 → 該角色的選單（說點什麼／禁言，D2、D3）。
 * 最右邊固定一顆 ＋ 進「這次對話有誰在場」（D4）——
 * 沒有這個入口的話，把角色全部移出之後就再也加不回來了。
 *
 * 一個人都沒有時整條列仍要在（只剩 ＋），否則畫面會少一塊、
 * 使用者不知道去哪裡找角色。
 */
export function AvatarBar(): JSX.Element {
  const characters = useAppStore((s) => s.snapshot?.presentCharacters ?? [])
  const thinkingIds = useAppStore((s) => s.thinkingIds)
  const push = useUiStore((s) => s.push)

  return (
    <div className="scroll-x flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      {characters.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => push('character-menu', c.id)}
          aria-label={c.name}
          className="flex shrink-0 flex-col items-center gap-0.5"
        >
          <span className={thinkingIds.includes(c.id) ? 'anim-breathe block' : 'block'}>
            <Avatar characterId={c.id} muted={c.muted} size={40} />
          </span>
          <span className="max-w-[56px] truncate text-[10px] text-[var(--text-sub)]">{c.name}</span>
        </button>
      ))}

      <button
        type="button"
        onClick={() => push('presence')}
        aria-label="這次對話有誰在場"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border)] text-lg text-[var(--text-sub)] active:bg-[var(--bg)]"
      >
        ＋
      </button>
    </div>
  )
}
