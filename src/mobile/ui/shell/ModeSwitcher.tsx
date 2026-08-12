import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import MonoIcon from '@shared/MonoIcon'
import { useConnectionStore } from '../stores/connectionStore'
import { useUiStore } from '../stores/uiStore'
import { useAppStore } from '../stores/appStore'
import { resolveLiveRemote, type Connection, type ModePref } from '../connection'
import { isScannerAvailable, parsePairingUrl, scanQr } from '../../adapters/scannerAdapter'
import * as keys from '@core/store/keys'
import { capacitorAdapters } from '../../adapters'
import { computeDiff, isDiffEmpty } from '@core/sync/diff'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import { bootStandaloneSession, type StandaloneSession } from '../../runtime/session'
import { buildLocalManifest, fetchRemoteManifest } from '../../runtime/syncManifest'
import { readBaseline } from '../../runtime/syncBaseline'
import { pushSync } from '../../runtime/syncPush'
import { formatDiffMessage, formatFirstRunMessage } from './syncDiffMessage'
import type { SyncSource } from '../../runtime/syncTransport'
import type { SyncDiff } from '@core/sync/types'

/**
 * 模式切換（S2 M1，`docs/mobile-mode-switch-sync.md` §4）。
 *
 * 這一版**完全不同步資料**——切換就是切換，跟已完成的 S1「從電腦匯入」是
 * 兩件事。放在「關於」頁而不是主選單新開一項，因為這裡本來就在講「目前連線」，
 * 使用者會在同一個地方問「我在跟誰講話」跟「我要換一個」。
 *
 * ⚠️ **只在原生殼顯示**：網頁版永遠是遙控模式（拓樸限制，`connection.ts` 已有說明），
 * 給它一顆「切換」按鈕只會讓人切到一個空的獨立模式資料庫。
 */
export function ModeSwitcher(): JSX.Element | null {
  const conn = useConnectionStore((s) => s.conn)
  const switchTo = useConnectionStore((s) => s.switchTo)
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const sending = useAppStore((s) => s.sending)

  const [scannerOk, setScannerOk] = useState(false)
  const [showPair, setShowPair] = useState(false)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (Capacitor.isNativePlatform()) void isScannerAvailable().then(setScannerOk)
  }, [])

  if (!Capacitor.isNativePlatform() || !conn) return null

  const guardSending = (): boolean => {
    if (!sending) return true
    toast('請先等這則訊息產生完，或按停止再切換模式', 'error')
    return false
  }

  /**
   * S2 M3 切換前預覽并提供三選項（`docs/mobile-sync-m3-kickoff.md` §4）。
   *
   * 回傳 object 或 null：
   * - `{ choice: 'push', diff }`：帶過去並切換（進行 M3 推送）
   * - `{ choice: 'switch', diff }`：直接切換不帶（基準保持不動）
   * - `null`：取消切換
   */
  const previewBeforeSwitchWithChoice = async (remoteSrc: SyncSource): Promise<{ choice: 'push' | 'switch'; diff: SyncDiff } | null> => {
    let localSession: StandaloneSession
    try {
      localSession = getStandaloneSession() ?? (await bootStandaloneSession(capacitorAdapters, { skipPackFetch: true }))
      const [baseline, local, remote] = await Promise.all([
        readBaseline(capacitorAdapters.storage),
        buildLocalManifest(localSession),
        fetchRemoteManifest(remoteSrc)
      ])
      const diff = computeDiff(baseline, local, remote)
      if (!diff.hasBaseline) {
        const choice = await confirmWithChoice({
          title: '切換前預覽',
          message: formatFirstRunMessage(local, remote)
        })
        return choice ? { choice, diff } : null
      }
      if (isDiffEmpty(diff)) return { choice: 'switch', diff }
      const choice = await confirmWithChoice({ title: '切換前預覽', message: formatDiffMessage(diff) })
      return choice ? { choice, diff } : null
    } catch {
      return { choice: 'switch', diff: { hasBaseline: false, characters: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] }, settingsChanged: false } }
    }
  }

  /**
   * S2 M2 差異預覽（舊版，只有「繼續」和「取消」）——保留給非切換流程用。
   *
   * 抓不到清單（電腦連不上、或本地資料讀取失敗）就直接放行，不擋切換：
   * 「不可以因為同步失敗就把使用者卡在原模式」（§7.7）。
   */
  const previewBeforeSwitch = async (remoteSrc: SyncSource): Promise<boolean> => {
    let localSession: StandaloneSession
    try {
      // 目前在獨立模式時直接用當前 session；在遙控模式時本機沒有活著的
      // session（資料在電腦上），臨時開一份唯讀用來讀本地檔案，不設成
      // 全域 session、也不影響 App.tsx 自己的開機流程。
      localSession = getStandaloneSession() ?? (await bootStandaloneSession(capacitorAdapters, { skipPackFetch: true }))
      const [baseline, local, remote] = await Promise.all([
        readBaseline(capacitorAdapters.storage),
        buildLocalManifest(localSession),
        fetchRemoteManifest(remoteSrc)
      ])
      const diff = computeDiff(baseline, local, remote)
      if (!diff.hasBaseline) {
        return await confirm({
          title: '切換前預覽',
          message: formatFirstRunMessage(local, remote),
          confirmLabel: '繼續切換'
        })
      }
      if (isDiffEmpty(diff)) return true
      return await confirm({ title: '切換前預覽', message: formatDiffMessage(diff), confirmLabel: '繼續切換' })
    } catch {
      return true
    }
  }

  const goStandalone = async (): Promise<void> => {
    if (!guardSending()) return
    setBusy(true)
    try {
      if (conn.mode === 'remote') {
        const result = await previewBeforeSwitchWithChoice({ baseUrl: conn.baseUrl, token: conn.token })
        if (!result) return // 取消
        const { choice, diff } = result

        if (choice === 'push') {
          // M3 推送邏輯：選中所有新增＋修改的項目推送
          const session = getStandaloneSession()
          if (!session) {
            toast('本機 session 不可用', 'error')
            return
          }

          try {
            await pushSync(
              { baseUrl: conn.baseUrl, token: conn.token },
              session,
              diff,
              {
                selectedIds: {
                  characters: new Set([...diff.characters.localNew, ...diff.characters.localModified]),
                  personas: new Set([...diff.personas.localNew, ...diff.personas.localModified]),
                  worlds: new Set([...diff.worlds.localNew, ...diff.worlds.localModified]),
                  scenes: new Set([...diff.scenes.localNew, ...diff.scenes.localModified]),
                  lorebooks: new Set([...diff.lorebooks.localNew, ...diff.lorebooks.localModified])
                },
                onProgress: (msg: string) => {
                  toast(msg)
                }
              }
            )
            toast('已推送資料，切換到遙控模式')
          } catch (err) {
            toast(`推送失敗：${err instanceof Error ? err.message : String(err)}`, 'error')
            return
          }
        }
        // choice === 'switch'：直接切換，不帶資料
      }
      await switchTo({ mode: 'standalone', baseUrl: '', token: '' })
      toast('已切換到本機模式')
    } finally {
      setBusy(false)
    }
  }

  const tryConnect = async (baseUrl: string, token: string): Promise<boolean> => {
    setBusy(true)
    try {
      const resolved = await resolveLiveRemote(baseUrl, token)
      if (!resolved.ok) {
        toast('連不上那台電腦，請確認已開機、DeST 正在執行，而且同一個網路', 'error')
        return false
      }
      if (resolved.relayOnly) {
        // 這裡不切換——切過去只會卡在「連線中斷」（見 connection.ts 的 resolveLiveRemote 註解）。
        toast('這條連線是透過中繼，這個版本還不支援用中繼建立即時遙控。請確認手機和電腦在同一個 Wi-Fi 再試一次', 'error')
        return false
      }
      const remoteSrc = { baseUrl: resolved.baseUrl!, token: resolved.token! }
      const proceed = await previewBeforeSwitch(remoteSrc)
      if (!proceed) return false
      const next: Connection = { mode: 'remote', baseUrl: remoteSrc.baseUrl, token: remoteSrc.token }
      await switchTo(next)
      setShowPair(false)
      toast('已切換到遙控模式')
      return true
    } finally {
      setBusy(false)
    }
  }

  const goRemote = async (): Promise<void> => {
    if (!guardSending()) return
    setBusy(true)
    const remembered = await readRememberedRemote()
    setBusy(false)
    if (remembered && (await tryConnect(remembered.baseUrl, remembered.token))) return
    // 沒有記住的主機，或連不上了（權杖可能已過期）→ 引導重新配對。
    if (remembered) toast('上次那台電腦連不上了，請重新配對', 'error')
    setShowPair(true)
  }

  const onScan = async (): Promise<void> => {
    const out = await scanQr()
    if (!out) return
    const parsed = parsePairingUrl(out.value)
    if (!parsed) {
      toast('這不是 DeST 的連線碼。請掃電腦上「手機連線」視窗顯示的那一張。', 'error')
      return
    }
    await tryConnect(parsed.baseUrl, parsed.token)
  }

  const onManual = async (): Promise<void> => {
    const parsed = parsePairingUrl(manual)
    if (!parsed) {
      toast('請貼上完整網址，含結尾的 ?token=⋯⋯', 'error')
      return
    }
    await tryConnect(parsed.baseUrl, parsed.token)
  }

  /**
   * 三選項對話（M3，§4）：帶過去 ／ 直接切 ／ 取消。
   *
   * confirm 按鈕當「直接切換，不帶」；extraActions 加一顆「帶過去並切換」。
   */
  const confirmWithChoice = (opts: { title: string; message: string }): Promise<'push' | 'switch' | null> => {
    return new Promise((resolve) => {
      confirm({
        title: opts.title,
        message: opts.message,
        confirmLabel: '直接切換（不帶資料）',
        extraActions: [
          {
            label: '帶過去並切換',
            onClick: () => resolve('push'),
            closeAfter: true
          }
        ]
      }).then((result) => {
        if (result) resolve('switch') // confirm 按鈕 → 「直接切」
        else resolve(null) // 取消或背景關閉
      })
    })
  }

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-3">
      <p className="text-[11px] text-[var(--text-sub)]">切換模式</p>

      {conn.mode === 'standalone' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void goRemote()}
          className="w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          {busy ? '連線中⋯⋯' : '切換到遙控（連電腦）'}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void goStandalone()}
          className="w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          切換到本機（獨立版）
        </button>
      )}

      {showPair && (
        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
            電腦請開啟「手機連線」，畫面上會出現一張 QR。
          </p>
          {scannerOk && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onScan()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
            >
              <MonoIcon name="qr" className="h-[18px] w-[18px]" />
              掃描電腦上的 QR
            </button>
          )}
          <input
            className="field w-full"
            inputMode="url"
            placeholder="http://192.168.1.20:3721?token=⋯⋯"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !manual.trim()}
            onClick={() => void onManual()}
            className="w-full rounded-full border border-[var(--border)] py-2 text-sm text-[var(--text)] disabled:opacity-40"
          >
            連線
          </button>
        </div>
      )}
    </div>
  )
}

async function readRememberedRemote(): Promise<{ baseUrl: string; token: string } | null> {
  // 不看 `pref.mode`：目前多半是 standalone（正要切去遙控），但 `remote` 這份
  // 記憶要跨越「切回本機」留下來，見 `connectionStore.switchTo` 的註解。
  const pref = await capacitorAdapters.storage.readJson<ModePref>(keys.MODE_PREF_KEY)
  return pref?.remote ?? null
}
