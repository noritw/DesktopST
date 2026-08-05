/**
 * 清單列的狀態標籤（使用中／在場／點此套用……）。
 *
 * 統一用一個有框線／底色的小圓角標籤，不要用純文字——名稱跟狀態疊在一起
 * 兩行純文字會糊成一團看不清楚（owner 2026-08-05 實機回報）。四個清單畫面
 * （對話／情境世界觀使用者設定／角色庫／在場角色）共用同一顆，樣式才不會各自漂移。
 */
export function StatusChip({ active, children }: { active: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <span
      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${
        active
          ? 'bg-[var(--mint2)] font-semibold text-[var(--text)]'
          : 'border border-[var(--border)] text-[var(--text-sub)]'
      }`}
    >
      {children}
    </span>
  )
}
