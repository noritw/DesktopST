import MonoIcon, { type MonoIconName } from '@shared/MonoIcon'
import { useUiStore, type ViewKind } from '../stores/uiStore'
import { getData, isAttached } from '../stores/appStore'
import { getStandaloneSession } from '../../runtime/sessionHolder'

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

/**
 * 獨立版還沒實作、但畫面已經做好的功能。
 *
 * ⚠️ **灰掉而不是拿掉**（owner 2026-08-09）：這些是「還沒做」不是
 * 「這台裝置永遠沒有」——後者（遙控電腦）才用 `.filter()` 整個消失。
 * 直接讓人點進去會看到一個什麼都抓不到的空畫面，比灰掉更難懂。
 *
 * 個人新聞報（缺口 #6）已於 B1 抽 core 全部接完（抓取／設定／釘選／
 * enrich／聊天注入），2026-08-12 解除灰掉。
 */
const STANDALONE_PENDING: Partial<Record<ViewKind, string>> = {}

const ITEMS: MenuItemDef[] = [
  { kind: 'conversations', icon: 'chat', label: '對話', hint: '切換、新增或重新命名對話' },
  { kind: 'characters', icon: 'users', label: '角色庫', hint: '管理角色卡，加入或移出這次對話' },
  { kind: 'presets', icon: 'folder', label: '情境與設定組', hint: '情境、使用者設定、世界觀、用語解說' },
  { kind: 'news', icon: 'news', label: '個人新聞報', hint: '批次看新聞、釘選，挑一則跟角色聊' },
  { kind: 'reminders', icon: 'alarm', label: '提醒', hint: '設定時間，讓角色主動開口提醒你' },
  { kind: 'theme-picker', icon: 'palette', label: '色彩主題', hint: '換一組配色，會同步到所有裝置' },
  { kind: 'settings', icon: 'settings', label: '設定', hint: 'API Key、模型、記憶與模組開關' },
  // 從電腦匯入（S1）：只有獨立模式看得到 —— 遙控模式讀的本來就是電腦那份資料，
  // 「匯入」在那裡沒有意義。下面用 `.filter()` 整個拿掉，不是 disabled。
  { kind: 'sync-import', icon: 'qr', label: '從電腦匯入', hint: '掃 QR，把電腦上的角色與設定拉過來' },
  // 遙控電腦（清單 H1–H11，B6）：只在遙控模式（`RemoteDataSource`）才有意義，
  // 獨立模式的 `capabilities.remoteControl` 恆為 false，下面用 `.filter()` 整個拿掉這一項——
  // 不是渲染出來再 disabled，是「這台裝置根本沒有電腦可控」這件事在 UI 上不存在。
  { kind: 'remote', icon: 'monitor', label: '遙控電腦', hint: '截圖、點擊鍵盤、切換視窗、系統動作' }
]

export function MainMenu(): JSX.Element {
  const replace = useUiStore((s) => s.replace)
  const standalone = getStandaloneSession() !== null
  const items = ITEMS.filter((item) => {
    if (item.kind === 'remote') return isAttached() && getData().capabilities.remoteControl
    if (item.kind === 'sync-import') return standalone
    return true
  })

  return (
    <div className="space-y-1.5 pb-2">
      {items.map((item) => {
        const pending = standalone ? STANDALONE_PENDING[item.kind] : undefined
        return (
          <button
            key={item.kind}
            type="button"
            disabled={!!pending}
            onClick={() => replace(item.kind)}
            className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left active:bg-[var(--surface)] disabled:pointer-events-none disabled:opacity-45"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)]">
              <MonoIcon name={item.icon} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--text)]">
                {item.label}
                {pending && <span className="ml-1.5 text-[11px] font-normal text-[var(--text-sub)]">尚未開放</span>}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">
                {pending ?? item.hint}
              </span>
            </span>
            {!pending && <MonoIcon name="chevron-right" className="h-4 w-4 shrink-0 text-[var(--text-sub)]" />}
          </button>
        )
      })}
    </div>
  )
}
