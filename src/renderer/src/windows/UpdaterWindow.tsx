import { useEffect, useState } from 'react'

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

export default function UpdaterWindow() {
  const [plan, setPlan] = useState<UpdatePlan | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void window.api.invoke('updates:plan').then(p => setPlan(p as UpdatePlan))
    const unsub = window.api.on('updates:progress', (p) => setProgress(p as UpdateProgress))
    return () => { unsub() }
  }, [])

  // 關視窗＝取消（主行程那邊也會再保險呼叫一次），不然下載會在背景跑完後突然重啟程式
  const handleClose = () => {
    if (running) void window.api.invoke('updates:cancel')
    window.close()
  }

  const handleStart = async () => {
    setRunning(true)
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
      <div style={{ ...styles.card, ...noDrag }}>
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
              {plan.kind === 'unpacked-dir'
                ? `會下載 ${plan.assetName}（${formatMB(plan.assetSize)}）覆蓋安裝資料夾，然後自動重新啟動。`
                : `會下載 ${plan.assetName}（${formatMB(plan.assetSize)}）換掉目前的執行檔，然後自動重新啟動。`}
              <br />
              你的角色、對話與設定放在另一個資料夾，不會被動到。
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
                      ? `下載中 ${pct}%（${formatMB(progress.receivedBytes)} / ${formatMB(progress.totalBytes)}）`
                      : progress?.phase === 'extract'
                        ? '解壓縮中…'
                        : progress?.phase === 'verify'
                          ? '驗證檔案…'
                          : progress?.phase === 'apply'
                            ? '即將關閉並安裝，請稍候…'
                            : '準備中…'}
                </div>
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
    overflowY: 'auto' as const,
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
