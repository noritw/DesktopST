import MonoIcon from '@shared/MonoIcon'
import { formatRelativeTime } from '@shared/relativeTimeLabel'
import type { NewsItem } from '@core/news/types'
import type { DisplayMode } from './newsStore'

/**
 * 一則新聞（清單 F9／F10／F7／F8 的四顆動作）。
 *
 * ⚠️ **觸控目標 ≥ 44×44**（規劃書 §4.3）。四顆按鈕擠在一張卡片上，
 * 小一格就會按到隔壁的「不看了」——那是唯一一個按錯會讓內容消失的動作。
 */
export interface NewsCardProps {
  item: NewsItem
  pinned: boolean
  displayMode: DisplayMode
  onOpen: () => void
  onTogglePin: () => void
  onChat: () => void
  onDismiss: () => void
}

export function NewsCard({
  item, pinned, displayMode, onOpen, onTogglePin, onChat, onDismiss
}: NewsCardProps): JSX.Element {
  const meta = [item.source, formatRelativeTime(item.publishedAt)].filter(Boolean).join(' · ')

  return (
    <div
      className={`rounded-[14px] border px-3 py-2.5 ${
        pinned
          ? 'border-[var(--mint2)] bg-[var(--mint)]/30'
          : 'border-[var(--border)] bg-[var(--bg)]'
      }`}
    >
      <p className="text-sm leading-relaxed text-[var(--text)]">{item.title}</p>
      {displayMode === 'title-summary' && item.summary && (
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-sub)]">{item.summary}</p>
      )}
      {meta && <p className="mt-1 text-[11px] text-[var(--text-sub)]">{meta}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.url && (
          <CardAction icon="external-link" label="原文" onClick={onOpen} />
        )}
        <CardAction icon="pin" label={pinned ? '已釘' : '釘選'} active={pinned} onClick={onTogglePin} />
        <CardAction icon="chat" label="聊這個" onClick={onChat} />
        <CardAction icon="close" label="不看了" onClick={onDismiss} />
      </div>
    </div>
  )
}

function CardAction({
  icon, label, active, onClick
}: {
  icon: Parameters<typeof MonoIcon>[0]['name']
  label: string
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border px-3 text-[12px] ${
        active
          ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-sub)] active:bg-[var(--border)]'
      }`}
    >
      <MonoIcon name={icon} className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
