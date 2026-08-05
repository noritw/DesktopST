import MonoIcon, { type MonoIconName } from '@shared/MonoIcon'
import { useUiStore, type ViewKind } from '../stores/uiStore'

/**
 * 主選單（owner 2026-08-06）。
 *
 * 原本 header 上有六顆 emoji 按鈕（💬📰👥🗂️🎨⚙️），項目越加越多、
 * 而且「圖案代表什麼」全靠猜。改成一顆 ☰ 展開這份清單，每一列都有
 * **圖示＋名稱＋一句說明**，第一次用的人不必再靠猜。
 *
 * ⚠️ **點選單項目用 `replace` 不是 `push`**：選單本身不該留在返回堆疊裡，
 * 否則從「設定」按返回會回到選單、要再按一次才回聊天。
 */

interface MenuItemDef {
  kind: ViewKind
  icon: MonoIconName
  label: string
  hint: string
}

const ITEMS: MenuItemDef[] = [
  { kind: 'conversations', icon: 'chat', label: '對話', hint: '切換、新增或重新命名對話' },
  { kind: 'characters', icon: 'users', label: '角色庫', hint: '管理角色卡，加入或移出這次對話' },
  { kind: 'presets', icon: 'folder', label: '情境與設定組', hint: '情境、使用者設定、世界觀、用語解說' },
  // ⚠️ 階段 6 才實作，點進去目前是「還在開發中」。說明不可寫成好像已經能用，
  // 否則使用者會以為是壞掉而不是還沒做。
  { kind: 'news', icon: 'news', label: '個人新聞報', hint: '還在開發中' },
  { kind: 'reminders', icon: 'alarm', label: '提醒', hint: '設定時間，讓角色主動開口提醒你' },
  { kind: 'theme-picker', icon: 'palette', label: '色彩主題', hint: '換一組配色，會同步到所有裝置' },
  { kind: 'settings', icon: 'settings', label: '設定', hint: 'API Key、模型、記憶與模組開關' }
]

export function MainMenu(): JSX.Element {
  const replace = useUiStore((s) => s.replace)

  return (
    <div className="space-y-1.5 pb-2">
      {ITEMS.map((item) => (
        <button
          key={item.kind}
          type="button"
          onClick={() => replace(item.kind)}
          className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left active:bg-[var(--surface)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)]">
            <MonoIcon name={item.icon} className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--text)]">{item.label}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">{item.hint}</span>
          </span>
          <MonoIcon name="chevron-right" className="h-4 w-4 shrink-0 text-[var(--text-sub)]" />
        </button>
      ))}
    </div>
  )
}
