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
import { countPlan, pairManifests, type PairTable } from '@core/sync/pair'
import { countSettingsPlan, pairSettings, type SettingsFieldRow } from '@core/sync/settingsPair'
import { countConvPlan, pairConversations, type ConvRow } from '@core/sync/convPair'
import { getStandaloneSession, setPendingStandaloneSession } from '../../runtime/sessionHolder'
import { bootStandaloneSession, type StandaloneSession } from '../../runtime/session'
import {
  MANIFEST_TIMEOUT_MS,
  buildLocalManifest,
  buildLocalSettingsSnapshot,
  fetchRemoteManifest,
  fetchRemoteSettingsSnapshot
} from '../../runtime/syncManifest'
import { applySync } from '../../runtime/syncApply'
import { applySettingsSync } from '../../runtime/syncSettingsApply'
import { applyConversationSync } from '../../runtime/syncConversations'
import { formatApplyMessage } from './syncDiffMessage'
import { countdownLabel, useCountdown } from './useCountdown'
import type { SyncSource } from '../../runtime/syncTransport'

/**
 * 切換的三種結果。**取消一定要跟失敗分開**——兩者合成一個 boolean 的話，
 * 使用者在比對畫面按取消會被當成「電腦連不上」（見 `goRemote` 的註解）。
 */
type SwitchOutcome = 'ok' | 'cancelled' | 'failed'

/**
 * 模式切換（S2 M4，`docs/mobile-sync-m4-compare.md`）。
 *
 * 切換前會先**逐項比對**兩邊的資料，讓使用者一列一列決定要留哪一邊
 * （`SyncComparePicker.tsx`）。M1～M3 的「整包帶過去／不帶」三選一已經移除——
 * 那個版本靠壞掉的基準表判斷「兩邊是不是同一筆」，實測結果是每切換一次
 * 兩邊就多一批重複資料。
 *
 * 放在「關於」頁而不是主選單新開一項，因為這裡本來就在講「目前連線」，
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
  const openSyncCompare = useUiStore((s) => s.openSyncCompare)
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
    const existing = getStandaloneSession()
    if (existing) return existing
    /*
     * 這個分支只有「目前在遙控模式」會走到（standalone→remote 方向
     * `getStandaloneSession()` 一定已經有值，上面就 return 了）。
     * **不能傳 `skipPackFetch: true`**：這裡 boot 出來的 session 現在會被
     * `App.tsx` 接手當成真正在用的那份（見下面），如果這台裝置從沒用過
     * 獨立模式（角色庫全空），跳過 fetch 會讓使用者第一次切過去看到的是
     * 一張空白角色卡，而不是正常的預設角色包——這種裝置不多，但也不該
     * 為了省一次 fetch 讓使用者踩到「怎麼只有一張空白卡」。真正有資料的
     * 裝置這個 fetch 一定會被 `seedDefaultCharactersIfEmpty` 的
     * `existingKeys.length > 0` 短路掉，不會多花任何時間。
     */
    const session = await bootStandaloneSession(capacitorAdapters)
    /*
     * 這裡是**新 boot 的、還沒人在用**的 session（B-6）——同步接下來會把改動
     * （例如對面改過的對話標題）寫進它。留給 `App.tsx` 接手，不然切完模式後
     * `App.tsx` 會另外重新 boot 一份只認磁碟的新 session，白白多讀一次磁碟，
     * 還可能因為時序而暫時看到舊資料。細節見 `sessionHolder.ts` 的
     * `setPendingStandaloneSession` 檔頭。
     */
    setPendingStandaloneSession(session)
    return session
  }

  const guardSending = (): boolean => {
    if (!sending) return true
    toast('請先等這則訊息產生完，或按停止再切換模式', 'error')
    return false
  }

  /**
   * S2 M4 切換前的逐項比對與同步。
   *
   * **兩個切換方向共用這一支**，而且它本身不管方向——比對畫面上每一列各自
   * 決定要用手機那份還是電腦那份，同一趟裡兩個方向可以同時發生。
   *
   * 這也順手消滅了 M3 最容易犯的一整類錯：那時推與拉是兩條分開的程式路徑，
   * 掛錯呼叫端就整個反了（`docs/mobile-sync-m3-kickoff.md` §0.1 就是這個）。
   * 現在方向是資料（每列一個 choice），不是程式分支。
   */
  const syncBeforeSwitch = async (remoteSrc: SyncSource): Promise<SwitchOutcome> => {
    let localSession: StandaloneSession
    let table: PairTable
    let settingsRows: SettingsFieldRow[]
    let convRows: ConvRow[]
    try {
      localSession = await localSessionForSync()
      setWaiting({ label: '讀取電腦資料', totalMs: MANIFEST_TIMEOUT_MS })
      try {
        const [local, remote, localSettings, remoteSettings] = await Promise.all([
          buildLocalManifest(localSession),
          fetchRemoteManifest(remoteSrc),
          buildLocalSettingsSnapshot(localSession),
          fetchRemoteSettingsSnapshot(remoteSrc)
        ])
        table = pairManifests(local, remote)
        settingsRows = pairSettings(localSettings, remoteSettings)
        /*
         * 對話走完全不同的比對模型（訊息層聯集，不是二選一），所以獨立配對。
         * 清單裡的 `messageIdsHash` 只雜湊 id、不含內容，抓這一份不會把
         * 幾十 MB 的圖片一起拉下來。
         */
        convRows = pairConversations(local.conversations, remote.conversations)
      } finally {
        setWaiting(null)
      }
    } catch {
      /*
       * 讀不到清單就**問過再切**，不要默默放行。舊版是靜靜當成「這次不帶資料」
       * 直接切過去，使用者完全不知道自己剛剛跳過了一次比對。
       */
      const go = await confirm({
        title: '讀不到電腦上的資料',
        message: '沒辦法跟電腦比對，可能是電腦剛關掉或網路不通。仍要切換嗎？切換後兩邊資料維持各自原樣。',
        confirmLabel: '仍要切換'
      })
      return go ? 'ok' : 'cancelled'
    }

    const result0 = await openSyncCompare(table, settingsRows, convRows)
    if (!result0) return 'cancelled'
    const { choices, settingsChoices, convChoices, convFieldChoices } = result0

    const plan = countPlan(table, choices)
    const settingsPlan = countSettingsPlan(settingsRows, settingsChoices)
    const convPlan = countConvPlan(convRows, convChoices, convFieldChoices)
    // 使用者選了全部不動 → 不必跑 apply，直接切
    if (
      plan.push + plan.pull + plan.deleteLocal + plan.deleteRemote +
      settingsPlan.push + settingsPlan.pull +
      convPlan.merge + convPlan.push + convPlan.pull + convPlan.deleteLocal + convPlan.deleteRemote + convPlan.fieldEdits === 0
    ) {
      return 'ok'
    }

    try {
      /*
       * 依序跑，不要 `Promise.all`：兩支都會呼叫 `session.saveSettings()` 寫同一份
       * 檔案，並在記憶體裡改同一個 `session.settings` 物件——平行執行時兩邊的
       * 寫入可能交錯，輕則一方的改動被蓋掉，重則檔案寫壞。順序本身不影響結果
       * （兩支動的欄位不重疊：一個是資料實體、一個是設定），只是求安全。
       */
      const dataResult = await applySync(remoteSrc, localSession, { table, choices, onProgress: (m) => toast(m) })
      const settingsResult = await applySettingsSync(remoteSrc, localSession, settingsRows, settingsChoices, (m) => toast(m))
      /*
       * 對話**一定要排在資料之後**：訊息裡的 `characterId` 要靠角色的 id 對應表
       * 翻譯，而那張表有一部分是這一趟推送當下才由電腦回應決定的（新建角色時
       * 電腦會發新 uuid）。先跑對話的話，剛推過去的角色一律翻不出來。
       * 所以拿的是 `dataResult.idMaps`，不是比對畫面上那張表。
       */
      const convResult = await applyConversationSync(
        remoteSrc,
        localSession,
        {
          rows: convRows,
          choices: convChoices,
          fieldChoices: convFieldChoices,
          characterIds: { l2r: dataResult.idMaps.l2r.characters, r2l: dataResult.idMaps.r2l.characters },
          onProgress: (m) => toast(m)
        }
      )
      await confirm({
        title: '同步完成',
        message: formatApplyMessage(dataResult, settingsResult, convResult),
        confirmLabel: '好'
      })
      return 'ok'
    } catch (err) {
      toast(`同步失敗：${err instanceof Error ? err.message : String(err)}`, 'error')
      return 'failed'
    }
  }


  const goStandalone = async (): Promise<void> => {
    if (!guardSending()) return
    setBusy(true)
    try {
      if (conn.mode === 'remote') {
        const outcome = await syncBeforeSwitch({ baseUrl: conn.baseUrl, token: conn.token })
        if (outcome !== 'ok') return
      }
      await switchTo({ mode: 'standalone', baseUrl: '', token: '' })
      toast('已切換到本機模式')
    } finally {
      setBusy(false)
    }
  }

  const tryConnect = async (baseUrl: string, token: string): Promise<SwitchOutcome> => {
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
        return 'failed'
      }
      if (resolved.relayOnly) {
        // 這裡不切換——切過去只會卡在「連線中斷」（見 connection.ts 的 resolveLiveRemote 註解）。
        toast('這條連線是透過中繼，這個版本還不支援用中繼建立即時遙控。請確認手機和電腦在同一個 Wi-Fi 再試一次', 'error')
        return 'failed'
      }
      const remoteSrc = { baseUrl: resolved.baseUrl!, token: resolved.token! }
      const outcome = await syncBeforeSwitch(remoteSrc)
      if (outcome !== 'ok') return outcome

      const next: Connection = { mode: 'remote', baseUrl: remoteSrc.baseUrl, token: remoteSrc.token }
      await switchTo(next)
      setShowPair(false)
      toast('已切換到遙控模式')
      return 'ok'
    } finally {
      setBusy(false)
    }
  }

  const goRemote = async (): Promise<void> => {
    if (!guardSending()) return
    setBusy(true)
    const remembered = await readRememberedRemote()
    setBusy(false)
    if (!remembered) {
      setShowPair(true)
      return
    }
    const outcome = await tryConnect(remembered.baseUrl, remembered.token)
    if (outcome === 'ok') return
    /*
     * ⚠️ **取消不是失敗。** 舊版 `tryConnect` 用 boolean 回報，於是「使用者在
     * 比對畫面按了取消」跟「電腦連不上」是同一個 `false`，兩者都會跳出
     * 「上次那台電腦連不上了，請重新配對」並強制彈出配對畫面——使用者明明
     * 只是反悔不想切，卻被告知電腦壞了（owner 2026-08-13 實機回報）。
     * 現在取消就安靜留在原地，什麼都不做。
     */
    if (outcome === 'cancelled') return
    toast('上次那台電腦連不上了，請重新配對', 'error')
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
          <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
            ⚠️ 那張 QR／網址等同能連進那台電腦資料的憑證，請勿轉傳畫面截圖給不信任的人。
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
