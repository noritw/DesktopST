import { useEffect, useState } from 'react'
import type { MessageDebug, MessageSnapshot } from '@core/data'
import { renderDebugPrompt, stripImageData } from '@core/prompt/debugPromptView'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 這則訊息實際送出去的完整 prompt（除錯用，從訊息選單的「顯示完整 Prompt」進來）。
 *
 * ⚠️ **只有最近幾則留著**：`core/store/prune.ts` 會把更舊訊息的 prompt 剝掉，
 * 不然對話檔會被撐爆。所以「沒有內容」是正常結果而不是錯誤 —— 這裡顯示說明，
 * 不丟錯誤 toast。排版與圖片剝除跟桌面 Log 視窗共用 `core/prompt/debugPromptView`。
 */

type TabKey = 'main' | 'utility' | 'conv-search' | 'news'

const TAB_LABEL: Record<TabKey, string> = {
  main: '回話',
  utility: '輔助模型',
  'conv-search': '新聞搜尋',
  news: '新聞抽選'
}

/**
 * 這則訊息花掉的 token（與桌面 Log 視窗同一組欄位）。
 *
 * 舊訊息沒有這些欄位就整段不顯示 —— 顯示「0」會被讀成「這次沒花錢」，那是錯的。
 */
function TokenCounts({ message }: { message: MessageSnapshot }): JSX.Element | null {
  const groups: { label: string; input?: number; output?: number }[] = [
    { label: '主模型', input: message.inputTokens, output: message.outputTokens },
    { label: '輔助', input: message.utilityInputTokens, output: message.utilityOutputTokens },
    { label: '對話搜尋', input: message.convSearchInputTokens, output: message.convSearchOutputTokens }
  ].filter((g) => g.input != null || g.output != null)

  if (groups.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-[var(--text-sub)]">
      {groups.map((g) => (
        <span key={g.label}>
          {g.label} in {g.input?.toLocaleString() ?? '—'} / out {g.output?.toLocaleString() ?? '—'}
        </span>
      ))}
    </div>
  )
}

export function MessagePromptView({ messageId }: { messageId: string }): JSX.Element {
  const message = useAppStore((s) => s.messages.find((m) => m.id === messageId))
  const toast = useUiStore((s) => s.toast)
  const [debug, setDebug] = useState<MessageDebug | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('main')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const d = await getData().messages.getDebug(messageId)
        if (alive) setDebug(d)
      } catch {
        if (alive) toast('讀取失敗', 'error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [messageId, toast])

  const textOf = (key: TabKey): string | null => {
    if (!debug) return null
    if (key === 'news') return debug.newsDebug ? JSON.stringify(debug.newsDebug, null, 2) : null
    const raw =
      key === 'utility' ? debug.utilityDebugPrompt
      : key === 'conv-search' ? debug.convSearchDebugPrompt
      : debug.debugPrompt
    return raw ? renderDebugPrompt(stripImageData(raw)) : null
  }

  const tabs = (Object.keys(TAB_LABEL) as TabKey[]).filter((k) => textOf(k) != null)
  // 有內容的分頁若不含目前選的那個（例如只有輔助模型留著），就跳到第一個有內容的。
  const activeTab = tabs.includes(tab) ? tab : tabs[0]
  const body = activeTab ? textOf(activeTab) : null

  const copy = async (): Promise<void> => {
    if (!body) return
    try {
      await navigator.clipboard.writeText(body)
      toast('已複製')
    } catch {
      // WebView 沒有剪貼簿權限時會走到這裡；內容本來就看得到，不是嚴重錯誤。
      toast('這台裝置不給複製', 'error')
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">讀取中…</div>
  }

  if (!body) {
    // token 數存在訊息本體、不會被 prune 剝掉，所以 prompt 沒了它仍該看得到。
    return (
      <div className="py-6">
        {message && <TokenCounts message={message} />}
        <p className="px-2 py-2 text-center text-sm leading-relaxed text-[var(--text-sub)]">
          這則訊息沒有保留 prompt。
          <br />
          為了不讓對話檔變太大，只有最近幾則留著完整內容。
        </p>
      </div>
    )
  }

  return (
    <div className="pb-2">
      {message && (
        <p className="mb-3 line-clamp-2 rounded-[12px] bg-[var(--bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-sub)]">
          {message.content || '（沒有文字內容）'}
        </p>
      )}

      {message && <TokenCounts message={message} />}

      {tabs.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tabs.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-full border px-3 py-1 text-xs ${
                k === activeTab
                  ? 'border-transparent bg-[var(--mint)] text-[var(--text)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-sub)]'
              }`}
            >
              {TAB_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {/* 橫向也要能捲：prompt 裡的 JSON 有很長的單行，硬折反而更難讀。 */}
      <pre className="scroll-y max-h-[60vh] overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--text)]">
        {body}
      </pre>

      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm text-[var(--text)]"
      >
        複製
      </button>
    </div>
  )
}
