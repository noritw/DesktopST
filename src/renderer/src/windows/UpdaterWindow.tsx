import { useEffect, useRef, useState } from 'react'

/**
 * 一鍵更新視窗（`w=updater`）。
 *
 * 流程刻意是兩段的：先 `updates:plan` 把「能不能更新／要下載哪個附件／多大」問清楚再顯示，
 * 按下按鈕才真的下載。理由是安裝型態（免安裝資料夾／單檔 EXE）與安全檢查
 * （安裝目錄是不是原始碼資料夾、資料夾有沒有在安裝目錄底下）都只有主行程知道，
 * 失敗時要在「還沒動任何檔案」的階段就講清楚。
 */

type Phase = 'download' | 'extract' | 'verify' | 'apply' | 'done' | 'error'

interface UpdatePlan {
  ok: boolean
  reason?: string
  kind: 'portable-exe' | 'unpacked-dir' | 'dev'
  currentVersion: string
  latestVersion: string
  assetName: string
  assetSize: number
  targetPath: string
  releaseNotes: string
}

interface UpdateProgress {
  phase: Phase
  ratio: number
  receivedBytes: number
  totalBytes: number
  message: string
}

function formatMB(bytes: number): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatRate(bytesPerSec: number): string {
  return bytesPerSec >= 1024 * 1024
    ? `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
    : `${Math.round(bytesPerSec / 1024)} KB/s`
}

/** 已經花了多久：2:05 這種讀法，一眼看得出跑多久了 */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** 剩餘時間講人話：不足一分鐘就說秒，超過一小時就說幾小時幾分 */
function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `約剩 ${Math.ceil(seconds)} 秒`
  const mins = Math.ceil(seconds / 60)
  if (mins < 60) return `約剩 ${mins} 分鐘`
  const h = Math.floor(mins / 60)
  return `約剩 ${h} 小時 ${mins % 60} 分`
}

export default function UpdaterWindow() {
  const [plan, setPlan] = useState<UpdatePlan | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [running, setRunning] = useState(false)
  /** 平滑過的下載速率（bytes/秒）；GitHub 附件慢起來差兩百倍，沒有這個看不出還要等多久 */
  const [rate, setRate] = useState<number | null>(null)
  const lastSample = useRef<{ t: number; b: number } | null>(null)
  /** 按下「立即更新」的時間；用來顯示已經花了多久（owner 實測時最想知道的就是這個） */
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.api.invoke('updates:plan').then(p => setPlan(p as UpdatePlan))
    const unsub = window.api.on('updates:progress', (p) => {
      const prog = p as UpdateProgress
      setProgress(prog)
      if (prog.phase !== 'download') return
      const now = Date.now()
      const last = lastSample.current
      if (!last) {
        lastSample.current = { t: now, b: prog.receivedBytes }
      } else if (now - last.t >= 1000) {
        const inst = (prog.receivedBytes - last.b) / ((now - last.t) / 1000)
        setRate(prev => (prev == null ? inst : prev * 0.7 + inst * 0.3))
        lastSample.current = { t: now, b: prog.receivedBytes }
      }
    })
    return () => { unsub() }
  }, [])

  // 秒針：只有在更新進行中才跑，停下來就不再重繪
  useEffect(() => {
    if (startedAt == null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  // 關視窗＝取消（主行程那邊也會再保險呼叫一次），不然下載會在背景跑完後突然重啟程式
  const handleClose = () => {
    if (running) void window.api.invoke('updates:cancel')
    window.close()
  }

  const handleStart = async () => {
    setRunning(true)
    setStartedAt(Date.now())
    setNow(Date.now())
    const res = await window.api.invoke('updates:start') as { ok: boolean; error?: string }
    if (!res.ok) setRunning(false)
  }

  if (!plan) {
    return (
      <div style={styles.root}>
        <div style={styles.spinner}>檢查中…</div>
      </div>
    )
  }

  const failed = progress?.phase === 'error'
  const pct = progress && progress.totalBytes > 0 ? Math.round(progress.ratio * 100) : 0

  return (
    <div style={styles.root}>
      <button style={{ ...styles.closeBtn, ...noDrag }} onClick={handleClose}>✕</button>
      <div style={{ ...styles.card, ...drag }}>
        {/* 看得見的拖曳把手：不給提示的話沒人知道哪裡可以拖（owner 實測回報） */}
        <div style={styles.grabber} />
        {!plan.ok ? (
          <>
            <div style={styles.title}>暫時無法一鍵更新</div>
            <div style={styles.hint}>{plan.reason}</div>
            <div style={styles.btnRow}>
              <button
                style={{ ...styles.btn, ...noDrag }}
                onClick={() => void window.api.invoke('shell:open-external', 'https://github.com/noritw/DesktopST/releases/latest')}
              >
                前往下載頁
              </button>
              <button style={{ ...styles.btnGhost, ...noDrag }} onClick={handleClose}>關閉</button>
            </div>
          </>
        ) : (
          <>
            <div style={styles.title}>有新版本 v{plan.latestVersion}</div>
            <div style={styles.versionRow}>
              目前 v{plan.currentVersion} → 新版 v{plan.latestVersion}
            </div>
            <div style={styles.hint}>
              {`下載 ${formatMB(plan.assetSize)} 後${plan.kind === 'unpacked-dir' ? '覆蓋這個資料夾' : '換掉這個執行檔'}並自動重開。角色與對話不受影響。`}
            </div>
            <div style={styles.pathBox} title={plan.targetPath}>{plan.targetPath}</div>

            {running && (
              <div style={styles.progressBlock}>
                <div style={styles.progressTrack}>
                  <div style={{ ...styles.progressFill, width: `${pct}%` }} />
                </div>
                <div style={styles.progressText}>
                  {failed
                    ? `失敗：${progress?.message}`
                    : progress?.phase === 'download'
                      ? `下載中 ${pct}%　${formatMB(progress.receivedBytes)} / ${formatMB(progress.totalBytes)}`
                      : progress?.phase === 'extract'
                        ? '解壓縮中…'
                        : progress?.phase === 'verify'
                          ? '驗證檔案…'
                          : progress?.phase === 'apply'
                            ? '即將關閉並安裝，請稍候…'
                            : '準備中…'}
                </div>
                {!failed && startedAt != null && (
                  <div style={styles.progressText}>
                    {progress?.phase === 'download' && rate != null && (
                      <>
                        {formatRate(rate)}
                        {progress.totalBytes > 0 &&
                          `　${formatEta((progress.totalBytes - progress.receivedBytes) / rate)}`}
                        {'　'}
                      </>
                    )}
                    {`已用 ${formatDuration((now - startedAt) / 1000)}`}
                  </div>
                )}
                {/* GitHub 的附件下載對某些線路特別慢（實測差到兩百倍），
                    慢到不合理時直接給一條逃生路，不要讓人乾等一小時 */}
                {!failed && progress?.phase === 'download' && rate != null && rate < 400 * 1024 && (
                  <div style={styles.slowNote}>
                    GitHub 這時段偏慢。可以讓它繼續跑，或按「取消」改用瀏覽器下載後手動覆蓋。
                  </div>
                )}
              </div>
            )}

            <div style={styles.btnRow}>
              {failed ? (
                <>
                  <button
                    style={{ ...styles.btn, ...noDrag }}
                    onClick={() => void window.api.invoke('shell:open-external', 'https://github.com/noritw/DesktopST/releases/latest')}
                  >
                    改用手動下載
                  </button>
                  <button style={{ ...styles.btnGhost, ...noDrag }} onClick={handleClose}>關閉</button>
                </>
              ) : (
                <>
                  <button
                    style={{ ...styles.btn, ...noDrag, ...(running ? styles.btnDisabled : {}) }}
                    disabled={running}
                    onClick={() => void handleStart()}
                  >
                    {running ? '更新中…' : '立即更新'}
                  </button>
                  <button style={{ ...styles.btnGhost, ...noDrag }} onClick={handleClose}>
                    {running ? '取消' : '稍後再說'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    maxHeight: '100vh',
    // 內容固定且視窗夠高，關捲軸免得差一兩個像素就冒出一條（owner 實測回報）
    overflowY: 'hidden' as const,
    boxSizing: 'border-box' as const,
    background: 'var(--color-bg)',
    padding: 16,
    ...drag
  },
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 10,
    background: 'var(--color-surface)',
    borderRadius: 20,
    padding: '20px 20px',
    boxShadow: 'var(--shadow-soft)',
    width: '100%',
    maxWidth: 340
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 20,
    background: 'var(--color-border-60)',
    marginBottom: 2,
    flexShrink: 0
  },
  slowNote: {
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const,
    background: 'var(--color-border-60)',
    borderRadius: 10,
    padding: '5px 8px'
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text-primary)'
  },
  versionRow: {
    fontSize: 13,
    color: 'var(--color-text-primary)',
    background: 'var(--color-mint)',
    borderRadius: 20,
    padding: '4px 12px'
  },
  hint: {
    fontSize: 12,
    lineHeight: 1.6,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const
  },
  pathBox: {
    fontSize: 11,
    color: 'var(--color-text-secondary)',
    background: 'var(--color-border-60)',
    borderRadius: 10,
    padding: '5px 10px',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
  },
  progressBlock: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    marginTop: 4
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 20,
    background: 'var(--color-border-60)',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 20,
    background: 'var(--color-mint)',
    transition: 'width 0.2s ease'
  },
  progressText: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const
  },
  btnRow: {
    display: 'flex',
    gap: 8,
    marginTop: 6
  },
  btn: {
    border: 'none',
    borderRadius: 20,
    padding: '8px 18px',
    fontSize: 13,
    cursor: 'pointer',
    background: 'var(--color-mint)',
    color: 'var(--color-text-primary)'
  },
  btnGhost: {
    border: 'none',
    borderRadius: 20,
    padding: '8px 18px',
    fontSize: 13,
    cursor: 'pointer',
    background: 'var(--color-border-60)',
    color: 'var(--color-text-primary)'
  },
  btnDisabled: {
    opacity: 0.6,
    cursor: 'default'
  },
  closeBtn: {
    position: 'fixed' as const,
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--color-border-60)',
    color: 'var(--color-text-primary)',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinner: {
    fontSize: 13,
    color: 'var(--color-text-secondary)'
  }
}
