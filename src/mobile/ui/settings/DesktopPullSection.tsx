import { useCallback, useEffect, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import { pullSettingsFromDesktop, SyncError, type SyncSource } from '../../runtime/syncImport'
import { isScannerAvailable, parsePairingUrl, scanQr } from '../../adapters/scannerAdapter'
import { useUiStore } from '../stores/uiStore'
import { useAppStore } from '../stores/appStore'

/**
 * 「從電腦重新拉設定」（owner 2026-08-08：「不用設定兩次」）。
 *
 * S1 是一次性的初始化匯入，電腦之後改了設定手機不會知道。真正解決這件事的是
 * S2 雙向同步，但 S2 貴在合併與差異預覽；**方向固定成電腦 → 手機**就退化成
 * 單純的覆蓋，成本低得多，而且對「我在電腦上設好了，手機照抄」這個實際需求
 * 已經夠用。
 *
 * 按鈕寫的是「覆蓋」不是「同步」—— 手機這邊改過的設定真的會被蓋掉，
 * 這種事不能用含糊的字眼帶過。
 */
export function DesktopPullSection(): JSX.Element | null {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const refresh = useAppStore((s) => s.refresh)

  const [host, setHost] = useState<{ baseUrl: string; lastSyncedAt: number } | null>(null)
  const [scannerOk, setScannerOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const session = getStandaloneSession()

  const loadHost = useCallback(async (): Promise<void> => {
    if (!session) return
    const memo = await session.getSyncHost()
    setHost(memo ? { baseUrl: memo.baseUrl, lastSyncedAt: memo.lastSyncedAt } : null)
  }, [session])

  useEffect(() => {
    void loadHost()
    void isScannerAvailable().then(setScannerOk)
  }, [loadHost])

  // 遙控模式本來就直接讀電腦的資料，沒有「拉一份過來」這回事
  if (!session) return null

  const pull = async (src: SyncSource): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await pullSettingsFromDesktop(src, session)
      await refresh()
      await loadHost()
      setMsg(
        r.apiKeysImported > 0
          ? `已更新設定，並帶回 ${r.apiKeysImported} 把金鑰。情境的在場角色與綁定對話也已對齊電腦。`
          : r.lanDirect
            ? '已更新設定。情境的在場角色與綁定對話也已對齊電腦。'
            : '已更新設定。這條連線不傳金鑰，回到跟電腦同一個網路時再拉一次就會帶過來。'
      )
    } catch (e) {
      if (e instanceof SyncError && e.code === 'unauthorized') {
        /*
         * 權杖在電腦重開「手機連線」時就會換新，所以這是**最常見**的失敗，
         * 不是異常。直接告訴使用者要重掃，不要丟一句「請再試一次」。
         */
        toast('連線權杖已過期，請重新掃一次電腦上的 QR。', 'error')
      } else if (e instanceof SyncError && e.code === 'unreachable') {
        toast('連不上那台電腦。請確認它已開機、DeST 正在執行，而且兩台在同一個網路。', 'error')
      } else {
        toast(e instanceof Error ? e.message : String(e), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const pullFromRemembered = async (): Promise<void> => {
    const memo = await session.getSyncHost()
    if (!memo) return
    const ok = await confirm({
      title: '以電腦的設定覆蓋',
      message:
        '會用電腦上的模型、金鑰、記憶參數與天氣偏好覆蓋這台手機的設定。' +
        '角色、對話與設定組都不會動到。',
      confirmLabel: '覆蓋'
    })
    if (!ok) return
    await pull({ baseUrl: memo.baseUrl, token: memo.token })
  }

  const pullViaScan = async (): Promise<void> => {
    try {
      const out = await scanQr()
      if (!out) return
      const parsed = parsePairingUrl(out.value)
      if (!parsed) {
        toast('這不是 DeST 的連線碼。請掃電腦上「手機連線」視窗顯示的那一張。', 'error')
        return
      }
      await pull(parsed)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
        在電腦上改過設定之後，可以直接拉一份過來，不必兩邊各設一次。
        只會動設定 —— 角色、對話與設定組不受影響。
      </p>

      {host && (
        <p className="text-[12px] text-[var(--text-sub)]">
          上次同步：<span className="text-[var(--text)]">{host.baseUrl}</span>
          {' · '}
          {formatWhen(host.lastSyncedAt)}
        </p>
      )}

      {host && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void pullFromRemembered()}
          className="min-h-[40px] w-full rounded-full bg-[var(--mint)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
        >
          {busy ? '處理中…' : '以電腦的設定覆蓋'}
        </button>
      )}

      {scannerOk && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void pullViaScan()}
          className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
        >
          <MonoIcon name="qr" className="h-[18px] w-[18px]" />
          {host ? '改掃 QR（換一台電腦或權杖過期時）' : '掃電腦上的 QR'}
        </button>
      )}

      {!host && !scannerOk && (
        <p className="text-[11px] text-[var(--text-sub)]">
          這台裝置不支援掃碼，請改用主選單的「從電腦匯入」手動貼上網址。
        </p>
      )}

      {msg && <p className="text-[12px] text-[var(--mint2)]">{msg}</p>}
    </div>
  )
}

function formatWhen(ts: number): string {
  const d = new Date(ts)
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay
    ? `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}
