import { elapsedSince } from '@core/util/relativeTime'

/**
 * 相對時間的中文文字（清單 F12）。
 *
 * 算法在 `core/util/relativeTime.ts`，這裡只負責措辭 ——
 * 分開是因為 core 不得含 UI 文案（roadmap §3.3），
 * 但「剛剛／N 分鐘前」這組措辭桌面與手機要一模一樣，所以放 `src/shared/`。
 */
export function formatRelativeTime(iso: string | undefined | null, now: number = Date.now()): string {
  const span = elapsedSince(iso, now)
  switch (span.kind) {
    case 'unknown': return ''
    case 'just-now': return '剛剛'
    case 'minutes': return `${span.value} 分鐘前`
    case 'hours': return `${span.value} 小時前`
    case 'days': return `${span.value} 天前`
    case 'absolute':
      try {
        return new Date(span.iso).toLocaleString('zh-TW', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
      } catch {
        return span.iso
      }
  }
}
