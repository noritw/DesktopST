import { useEffect, useState } from 'react'

/**
 * 新聞 Prompt 上下文檢視／編輯面板（設計稿 §3.7）。
 * 聊天泡泡只顯示標題；這裡才是「會進／已進 Prompt」的那段。
 */
export interface NewsContextPanelProps {
  open: boolean
  title: string
  url?: string
  source?: string
  promptContext: string
  /** enrich 失敗／退回時的提示（給使用者看的短句） */
  hint?: string
  /** 整理中（enrich 進行中） */
  loading?: boolean
  loadingLabel?: string
  /** 確認前（聊這個）用「確認放入輸入框」；已送出用「儲存」 */
  mode: 'confirm' | 'edit'
  onClose: () => void
  onSave: (promptContext: string) => void | Promise<void>
  onRefresh?: () => void | Promise<void>
  onOpenOriginal?: () => void
  /**
   * 清除摘要：之後每一輪都不再把這整段帶進 prompt，標題仍留著。
   * 只有已送出的訊息（`mode='edit'`）需要——「聊這個」還沒送出，直接取消就好。
   */
  onClear?: () => void | Promise<void>
}

export default function NewsContextPanel({
  open,
  title,
  url,
  source,
  promptContext,
  hint,
  loading,
  loadingLabel = '整理中…',
  mode,
  onClose,
  onSave,
  onRefresh,
  onOpenOriginal,
  onClear
}: NewsContextPanelProps): JSX.Element | null {
  const [draft, setDraft] = useState(promptContext)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (open) setDraft(promptContext)
  }, [open, promptContext])

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft.trim())
    } finally {
      setSaving(false)
    }
  }

  const handleRefresh = async () => {
    if (!onRefresh) return
    if (draft.trim() && draft.trim() !== promptContext.trim()) {
      if (!window.confirm('目前有手動修改，重抓會覆蓋。確定？')) return
    }
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[min(80vh,560px)] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface shadow-sm"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="新聞上下文"
      >
        <div className="flex items-start gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-primary break-words">{title || '（無標題）'}</p>
            {source && <p className="mt-0.5 text-xs text-secondary">來源：{source}</p>}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-1 text-secondary hover:bg-mint-20"
            title="關閉"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
          <p className="text-xs leading-relaxed text-secondary">
            這段會寫進角色看到的背景，不會整段出現在聊天泡泡裡。
          </p>
          {hint && !loading && (
            <p className="rounded-xl bg-butter/50 px-2.5 py-1.5 text-[11px] leading-relaxed text-secondary">
              {hint}
            </p>
          )}
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-10 text-sm text-secondary">
              {loadingLabel}
            </div>
          ) : (
            <textarea
              className="input-field min-h-[160px] flex-1 resize-y text-sm leading-relaxed"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="（僅標題，尚無可用摘要）"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {url && onOpenOriginal && (
            <button
              type="button"
              className="rounded-full border border-border px-3 py-1.5 text-xs text-primary hover:bg-mint-20"
              onClick={onOpenOriginal}
            >
              開原文 ↗
            </button>
          )}
          {onRefresh && (
            <button
              type="button"
              disabled={loading || refreshing}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-primary hover:bg-mint-20 disabled:opacity-50"
              onClick={() => void handleRefresh()}
            >
              {refreshing ? '重抓中…' : '重新整理'}
            </button>
          )}
          {onClear && (
            <button
              type="button"
              disabled={loading || saving}
              title="之後不再把這段帶進 Prompt；標題仍留在聊天紀錄"
              className="rounded-full border border-border px-3 py-1.5 text-xs text-secondary hover:bg-mint-20 disabled:opacity-50"
              onClick={() => void onClear()}
            >
              清除摘要
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1.5 text-xs text-secondary hover:bg-mint-20"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={loading || saving}
            className="rounded-full bg-mint px-4 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
            onClick={() => void handleSave()}
          >
            {saving ? '儲存中…' : mode === 'confirm' ? '確認放入輸入框' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
