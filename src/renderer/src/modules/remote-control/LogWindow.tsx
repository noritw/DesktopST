import { useEffect, useState, useCallback } from 'react'

interface LogEntry {
  timestamp: number
  ip: string
  deviceNickname: string
  deviceLabel: string
  action: string
  detail: string
}

const ACTION_LABELS: Record<string, string> = {
  click: '點擊',
  type: '輸入',
  key: '按鍵',
  scroll: '滾動',
  launch: '啟動',
  close: '關閉',
  'monitor-off': '關螢幕',
  wake: '喚醒',
  shutdown: '關機',
  restart: '重開機',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function RemoteControlLogWindow() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.invoke('remote:get-log')
      setEntries(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function handleClear() {
    await window.api.invoke('remote:clear-log')
    setEntries([])
  }

  function handleCopy() {
    const lines = entries.map(e =>
      `${formatTime(e.timestamp)}\t${e.deviceNickname}（${e.deviceLabel}）\t${e.ip}\t${actionLabel(e.action)}\t${e.detail}`
    )
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
  }

  function handleClose() {
    window.api.invoke('window:close-remote-control-log').catch(() => {})
  }

  return (
    <div
      className="flex flex-col h-screen bg-base text-primary select-none"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-4 py-3 bg-mint border-b border-border flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-semibold flex-1">遙控操作記錄</span>
        <div className="flex gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={reload}
            className="px-2 py-1 rounded-lg text-xs border bg-surface text-primary border-border hover:bg-mint transition-colors"
            title="重新整理"
          >
            ↻ 重整
          </button>
          <button
            onClick={handleCopy}
            disabled={entries.length === 0}
            className="px-2 py-1 rounded-lg text-xs border bg-surface text-primary border-border hover:bg-mint transition-colors disabled:opacity-40"
          >
            複製全部
          </button>
          <button
            onClick={handleClear}
            disabled={entries.length === 0}
            className="px-2 py-1 rounded-lg text-xs border bg-surface text-danger border-border hover:bg-pink transition-colors disabled:opacity-40"
          >
            清除
          </button>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-surface border border-border text-secondary text-sm flex items-center justify-center hover:bg-pink transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {loading ? (
          <p className="text-center text-secondary text-sm py-8">載入中…</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-secondary text-sm py-8">尚無記錄</p>
        ) : (
          entries.map((e, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-secondary">{formatTime(e.timestamp)}</span>
                <span
                  className="px-1.5 py-0.5 rounded-md font-medium text-white text-[10px]"
                  style={{ background: actionColor(e.action) }}
                >
                  {actionLabel(e.action)}
                </span>
                <span className="font-medium text-primary">{e.deviceNickname}</span>
                <span className="text-secondary">({e.deviceLabel})</span>
                <span className="text-secondary font-mono">{e.ip}</span>
              </div>
              {e.detail && (
                <div className="mt-1 text-primary font-mono break-all">{e.detail}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="px-4 py-2 border-t border-border text-xs text-secondary flex-shrink-0">
          共 {entries.length} 筆（最新在上）
        </div>
      )}
    </div>
  )
}

function actionColor(action: string): string {
  if (action === 'click') return '#5BA4EF'
  if (action === 'type') return '#57C7A0'
  if (action === 'key') return '#A78BFA'
  if (action === 'scroll') return '#F59E0B'
  if (action === 'launch' || action === 'close') return '#EC7C54'
  if (action === 'monitor-off' || action === 'wake') return '#64748B'
  if (action === 'shutdown' || action === 'restart') return '#EF4444'
  return '#9CA3AF'
}
