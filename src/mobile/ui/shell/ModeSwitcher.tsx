import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import MonoIcon from '@shared/MonoIcon'
import { useConnectionStore } from '../stores/connectionStore'
import { useUiStore } from '../stores/uiStore'
import { useAppStore } from '../stores/appStore'
import { PROBE_TIMEOUT_MS, resolveLiveRemote, type Connection, type ModePref } from '../connection'
import { isScannerAvailable, parsePairingUrl, scanQr } from '../../adapters/scannerAdapter'
import * as keys from '@core/store/keys'
import { capacitorAdapters, initCapacitorSecrets } from '../../adapters'
import { computeDiff, isDiffEmpty } from '@core/sync/diff'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import { bootStandaloneSession, type StandaloneSession } from '../../runtime/session'
import { MANIFEST_TIMEOUT_MS, buildLocalManifest, fetchRemoteManifest } from '../../runtime/syncManifest'
import { readBaseline } from '../../runtime/syncBaseline'
import { pullRemoteToLocal as pullRemoteToLocalSync, pushLocalToRemote as pushLocalToRemoteSync } from '../../runtime/modeSwitchSync'
import { PushCancelled } from '../../runtime/syncPush'
import { formatDiffMessage, formatFirstRunMessage, formatPullSummaryMessage, formatPushSummaryMessage } from './syncDiffMessage'
import { countdownLabel, useCountdown } from './useCountdown'
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
  /**
   * 記住的那台電腦（`null` ＝ 從沒成功連過）。
   *
   * UI 要用它決定「連上次那台」這顆按鈕該不該出現 —— 沒有記憶時那顆按鈕
   * 按下去只會什麼都不做，不如不要畫。
   */
  const [remembered, setRemembered] = useState<{ baseUrl: string; token: string } | null>(null)
  /**
   * 正在等電腦回應的那一段（給倒數用）。`busy` 涵蓋整趟切換（含使用者在對話框
   * 上思考的時間），倒數只能對應**真的有逾時**的那幾步，否則數字會對不上。
   */
  const [waiting, setWaiting] = useState<{ label: string; totalMs: number } | null>(null)
  const secondsLeft = useCountdown(waiting?.totalMs ?? 0, !!waiting)

  useEffect(() => {
    if (Capacitor.isNativePlatform()) void isScannerAvailable().then(setScannerOk)
    void readRememberedRemote().then(setRemembered)
  }, [])

  if (!Capacitor.isNativePlatform() || !conn) return null

  /**
   * 拿一份可以讀寫本機資料的 session。
   *
   * ⚠️ **一定要先 `initCapacitorSecrets()`。** 遙控模式下 `App.tsx` 從來沒有
   * 初始化過 secrets（它只在獨立模式分支呼叫），沒解封就 boot 的話
   * `hydrateSettings()` 解不開 `enc:v1:…`，會把記憶體裡的 API Key 設成空字串；
   * 之後任何一次 `saveSettings()` 都會把磁碟上的密文蓋成空的 ——
   * owner 2026-08-13 回報「獨立版的 API Key 不見了」就是這樣沒的
   * （`session.saveSettings` 現在另外有一道保險絲，但別依賴它）。
   */
  const localSessionForSync = async (): Promise<StandaloneSession> => {
    await initCapacitorSecrets()
    return getStandaloneSession() ?? (await bootStandaloneSession(capacitorAdapters, { skipPackFetch: true }))
  }

  const guardSending = (): boolean => {
    if (!sending) return true
    toast('請先等這則訊息產生完，或按停止再切換模式', 'error')
    return false
  }

  /**
   * S2 M3 切換前預覽并提供三選項（`docs/mobile-sync-m3-kickoff.md` §4）。
   *
   * 這支只負責「算差異、問使用者要不要帶」，**不管方向**——方向（推或拉）
   * 由呼叫端根據「現在要切去哪個模式」決定，見 `mobile-mode-switch-sync.md` §2：
   * 獨立 → 遙控是手機 → 電腦，遙控 → 獨立是電腦 → 手機。
   *
   * 回傳 object 或 null：
   * - `{ choice: 'bring', diff }`：帶過去並切換
   * - `{ choice: 'switch', diff }`：直接切換不帶（基準保持不動）
   * - `null`：取消切換
   */
  const previewBeforeSwitchWithChoice = async (remoteSrc: SyncSource): Promise<{ choice: 'bring' | 'switch'; diff: SyncDiff } | null> => {
    let localSession: StandaloneSession
    try {
      localSession = await localSessionForSync()
      setWaiting({ label: '讀取電腦資料', totalMs: MANIFEST_TIMEOUT_MS })
      let baseline, local, remote
      try {
        ;[baseline, local, remote] = await Promise.all([
          readBaseline(capacitorAdapters.storage),
          buildLocalManifest(localSession),
          fetchRemoteManifest(remoteSrc)
        ])
      } finally {
        setWaiting(null)
      }
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
   * 獨立 → 遙控：把手機資料推到電腦（`docs/mobile-mode-switch-sync.md` §2）。
   * 呼叫端已經跑過 `previewBeforeSwitchWithChoice` 並確認 `choice === 'bring'`。
   */
  const pushLocalToRemote = async (remoteSrc: SyncSource, diff: SyncDiff): Promise<void> => {
    const session = await localSessionForSync()
    const summary = await pushLocalToRemoteSync(
      remoteSrc,
      session,
      diff,
      (msg) => toast(msg),
      // 電腦上有同名角色時，讓使用者逐一勾選要覆蓋哪幾隻（預設全選）
      (conflicts) => useUiStore.getState().openNameConflicts(conflicts)
    )
    // 推送成功但沒東西真的推過去（例如全部都是衝突）——不用彈結果對話框。
    const pushedAnything = Object.values(summary).some((names) => names.length > 0)
    if (pushedAnything) {
      await confirm({ title: '推送完成', message: formatPushSummaryMessage(summary), confirmLabel: '好' })
    } else {
      toast('沒有東西需要推送')
    }
  }

  /**
   * 遙控 → 獨立：把電腦資料拉回手機（`docs/mobile-mode-switch-sync.md` §2）。
   * 沿用既有 S1 匯入邏輯（`syncPull.ts` 的 `pullFromDesktop`），不重新設計。
   */
  const pullRemoteToLocal = async (remoteSrc: SyncSource): Promise<void> => {
    const session = await localSessionForSync()
    toast('正在從電腦帶回資料⋯⋯')
    const result = await pullRemoteToLocalSync(remoteSrc, session)
    await confirm({ title: '帶回完成', message: formatPullSummaryMessage(result), confirmLabel: '好' })
  }

  const goStandalone = async (): Promise<void> => {
    if (!guardSending()) return
    setBusy(true)
    try {
      if (conn.mode === 'remote') {
        const remoteSrc = { baseUrl: conn.baseUrl, token: conn.token }
        const result = await previewBeforeSwitchWithChoice(remoteSrc)
        if (!result) return // 取消
        const { choice } = result

        if (choice === 'bring') {
          try {
            await pullRemoteToLocal(remoteSrc)
          } catch (err) {
            toast(`從電腦帶回資料失敗：${err instanceof Error ? err.message : String(err)}`, 'error')
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
      setWaiting({ label: '連線中', totalMs: PROBE_TIMEOUT_MS })
      let resolved
      try {
        resolved = await resolveLiveRemote(baseUrl, token)
      } finally {
        setWaiting(null)
      }
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
      const result = await previewBeforeSwitchWithChoice(remoteSrc)
      if (!result) return false // 取消
      const { choice, diff } = result

      if (choice === 'bring') {
        try {
          await pushLocalToRemote(remoteSrc, diff)
        } catch (err) {
          // 使用者在同名清單按了取消 → 安靜留在原模式，不是錯誤
          if (err instanceof PushCancelled) return false
          toast(`推送失敗：${err instanceof Error ? err.message : String(err)}`, 'error')
          return false
        }
      }
      // choice === 'switch'：直接切換，不帶資料
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
  const confirmWithChoice = (opts: { title: string; message: string }): Promise<'bring' | 'switch' | null> => {
    return new Promise((resolve) => {
      confirm({
        title: opts.title,
        message: opts.message,
        confirmLabel: '直接切換（不帶資料）',
        extraActions: [
          {
            label: '帶過去並切換',
            onClick: () => resolve('bring'),
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
        remembered && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void goRemote()}
            className="w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
          >
            {waiting ? countdownLabel(waiting.label, secondsLeft) : busy ? '處理中⋯⋯' : '切換到遙控（連上次那台）'}
          </button>
        )
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void goStandalone()}
          className="w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          {waiting ? countdownLabel(waiting.label, secondsLeft) : busy ? '處理中⋯⋯' : '切換到本機（獨立版）'}
        </button>
      )}

      {/*
        本機模式**一律**顯示掃 QR，不管有沒有記住上一台（owner 2026-08-13）。
        原本只有「連上次那台」失敗時才會冒出來，於是已經配對過的人**永遠找不到
        換一台電腦的入口**——記憶反而把功能藏起來了。
      */}
      {(showPair || conn.mode === 'standalone') && (
        <div className="space-y-2 border-t border-[var(--border)] pt-3">
          <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
            {remembered && conn.mode === 'standalone'
              ? '要改連別台電腦，掃那台的 QR 就會換過去。電腦請開啟「手機連線」。'
              : '電腦請開啟「手機連線」，畫面上會出現一張 QR。'}
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
