import { useEffect, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useUiStore } from '../stores/uiStore'
import { useAppStore } from '../stores/appStore'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import {
  fetchSyncConversations,
  fetchSyncPreview,
  runSyncImport,
  SyncError,
  type SyncConflictPolicy,
  type SyncConversationItem,
  type SyncPreview,
  type SyncResult
} from '../../runtime/syncImport'
import { isScannerAvailable, parsePairingUrl, scanQr } from '../../adapters/scannerAdapter'

/**
 * S1 初始化匯入（roadmap §4.7）。
 *
 * 流程刻意分成三步，**動手前一定先給預覽**：
 *   1. 配對：掃 QR，或手動貼上電腦顯示的網址
 *   2. 預覽：拉幾隻角色、哪些同名、金鑰會不會帶過來 → 使用者決定同名怎麼處理
 *   3. 匯入 → 結果摘要
 *
 * 金鑰能不能傳**由電腦端判定**，這裡只顯示它的判定結果，
 * 不提供「我知道風險仍要傳」的覆寫 —— 那等於要使用者做安全判斷（§2 目標④）。
 */

type Step = 'pair' | 'preview' | 'running' | 'done'

export function SyncImportView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const pop = useUiStore((s) => s.pop)
  const refresh = useAppStore((s) => s.refresh)

  const [step, setStep] = useState<Step>('pair')
  const [scannerOk, setScannerOk] = useState(false)
  const [manual, setManual] = useState('')
  const [src, setSrc] = useState<{ baseUrl: string; token: string } | null>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [policy, setPolicy] = useState<SyncConflictPolicy>('skip')
  const [result, setResult] = useState<SyncResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  /** `null` ＝ 這台電腦的 DeST 還沒有這支端點（舊版）。 */
  const [convs, setConvs] = useState<SyncConversationItem[] | null>(null)
  /**
   * 勾選的對話。**預設一則都不勾**（owner 2026-08-08 指定）——
   * 對話是所有資料裡最私密也最佔空間的，要帶哪些應該是明確的決定，不是預設值。
   */
  const [pickedConvs, setPickedConvs] = useState<Set<string>>(new Set())

  useEffect(() => {
    void isScannerAvailable().then(setScannerOk)
  }, [])

  const session = getStandaloneSession()
  if (!session) {
    return (
      <p className="px-2 py-6 text-center text-sm leading-relaxed text-[var(--text-sub)]">
        這台裝置目前正在讀電腦上的資料，不需要匯入。
      </p>
    )
  }

  const describe = (e: unknown): string => {
    if (e instanceof SyncError) {
      switch (e.code) {
        case 'unreachable':
          return '連不上那台電腦。請確認電腦已開機、DeST 正在執行，而且兩台在同一個網路。'
        case 'unauthorized':
          return '權杖不正確。請重新掃一次電腦上的 QR（重開手機連線功能後權杖會換新）。'
        case 'empty':
          return '那台電腦上沒有角色可以匯入。'
        default:
          return `電腦回了非預期的結果（${e.code}）。`
      }
    }
    return e instanceof Error ? e.message : String(e)
  }

  const startPreview = async (next: { baseUrl: string; token: string }): Promise<void> => {
    setBusy(true)
    try {
      const p = await fetchSyncPreview(next, session)
      // 用 preview 回報的來源：可能已從 relay 自動升級成區網直連
      setSrc(p.src)
      setPreview(p)
      /*
       * 對話清單只有後設資料，跟預覽一起抓不會慢。
       * 抓不到就當這台電腦是舊版（沒有這支端點）——**不要讓整個匯入失敗**，
       * 角色與設定照樣可以帶過來。
       */
      setConvs(await fetchSyncConversations(p.src, session).catch(() => null))
      setPickedConvs(new Set())
      setStep('preview')
    } catch (e) {
      toast(describe(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onScan = async (): Promise<void> => {
    try {
      const out = await scanQr()
      if (!out) return // 使用者自己取消，不要跳提示
      const parsed = parsePairingUrl(out.value)
      if (!parsed) {
        toast('這不是 DeST 的連線碼。請掃電腦上「手機連線」視窗顯示的那一張。', 'error')
        return
      }
      await startPreview(parsed)
    } catch (e) {
      toast(describe(e), 'error')
    }
  }

  const onManual = async (): Promise<void> => {
    const parsed = parsePairingUrl(manual)
    if (!parsed) {
      toast('請貼上完整網址，含結尾的 ?token=⋯⋯', 'error')
      return
    }
    await startPreview(parsed)
  }

  const onRun = async (): Promise<void> => {
    if (!src || !preview) return
    setStep('running')
    try {
      const r = await runSyncImport(src, session, {
        onConflict: policy,
        bundle: preview.bundle,
        conversationIds: [...pickedConvs],
        onProgress: (done, total) => setProgress({ done, total })
      })
      setResult(r)
      setStep('done')
      await refresh()
    } catch (e) {
      toast(describe(e), 'error')
      setStep('preview')
    }
  }

  if (step === 'running') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-[var(--text-sub)]">
        <MonoIcon name="download" className="h-7 w-7 animate-pulse" />
        {progress.total > 0 ? `正在取得資料 ${progress.done} / ${progress.total}` : '匯入中⋯⋯'}
        <span className="text-[11px]">角色與對話一份一份抓，請不要關掉 app</span>
      </div>
    )
  }

  if (step === 'done' && result) {
    return (
      <div className="space-y-4 py-2">
        <div className="flex flex-col items-center gap-2 py-4">
          <MonoIcon name="check" className="h-8 w-8 text-[var(--text)]" />
          <p className="text-sm text-[var(--text)]">匯入完成</p>
        </div>
        <ul className="space-y-1.5 rounded-[14px] bg-[var(--bg)] p-3 text-[13px] text-[var(--text-sub)]">
          <li>
            角色：新增 {result.charactersImported} 隻
            {result.charactersSkipped > 0 && `，略過 ${result.charactersSkipped} 隻同名的`}
            {result.charactersFailed > 0 && `，${result.charactersFailed} 隻沒抓成功（可以再匯入一次補齊）`}
          </li>
          <li>設定組：新增 {result.presetsImported} 組</li>
          <li>
            {result.lorebooksImported > 0
              ? `用語解說：帶回 ${result.lorebooksImported} 本`
              : '用語解說：這次角色／世界觀沒有掛任何一本'}
          </li>
          <li>
            {result.conversationsImported > 0 || result.conversationsFailed > 0
              ? `對話：帶回 ${result.conversationsImported} 則${
                  result.conversationsFailed > 0
                    ? `，${result.conversationsFailed} 則沒抓成功（可以再匯入一次補齊）`
                    : ''
                }`
              : '對話：這次沒有勾選任何一則'}
          </li>
          <li>設定：配色、模型、記憶參數已套用</li>
          <li>
            {result.apiKeysImported > 0
              ? `API Key：帶回 ${result.apiKeysImported} 組`
              : 'API Key：這次沒有帶過來，請在設定裡手動填入'}
          </li>
        </ul>
        <button
          type="button"
          onClick={pop}
          className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)]"
        >
          回聊天
        </button>
      </div>
    )
  }

  if (step === 'preview' && preview) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-[14px] bg-[var(--bg)] p-3 text-[13px] leading-relaxed text-[var(--text-sub)]">
          <p className="text-[var(--text)]">找到電腦上的 {preview.characterCount} 隻角色。</p>
          <p className="mt-1.5">
            {preview.apiKeysIncluded
              ? preview.upgradedToLan
                ? '🟢 已自動改用家用網路直接連線 —— 設定與 API Key 都會帶過來。'
                : '🟢 已透過家用網路直接連線 —— 設定與 API Key 都會帶過來。'
              : '🟡 這條連線不會傳輸 API Key（為了保護你的金鑰）。匯入後請在設定裡填一次；等回到跟電腦同一個網路時再匯入一次，金鑰就會自動帶過來。'}
          </p>
          <p className="mt-1.5">手機上原有的對話不會被動到。</p>
        </div>

        {preview.conflictNames.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] text-[var(--text)]">
              有 {preview.conflictNames.length} 隻同名角色（{preview.conflictNames.join('、')}），要怎麼處理？
            </p>
            <ChoiceRow
              label="保留手機上的"
              hint="略過同名的那幾隻，其餘照樣新增"
              checked={policy === 'skip'}
              onSelect={() => setPolicy('skip')}
            />
            <ChoiceRow
              label="換成電腦上的"
              hint="用電腦那份取代，手機上的那隻會被刪掉"
              checked={policy === 'overwrite'}
              onSelect={() => setPolicy('overwrite')}
            />
          </div>
        )}

        <ConversationPicker
          items={convs}
          picked={pickedConvs}
          onChange={setPickedConvs}
        />

        <button
          type="button"
          onClick={() => void onRun()}
          className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)]"
        >
          開始匯入
        </button>
        <button
          type="button"
          onClick={() => setStep('pair')}
          className="w-full rounded-full py-2 text-[13px] text-[var(--text-sub)]"
        >
          換一台電腦
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      <p className="text-[13px] leading-relaxed text-[var(--text-sub)]">
        把電腦上的角色、設定組與設定拉一份到這台手機。電腦端請開啟「手機連線」，
        畫面上會出現一張 QR。
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

      <div className="space-y-2">
        <p className="text-[11px] text-[var(--text-sub)]">
          {scannerOk ? '或者，手動貼上電腦顯示的網址：' : '這台裝置不支援掃碼，請手動貼上電腦顯示的網址：'}
        </p>
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
          {busy ? '連線中⋯⋯' : '連線'}
        </button>
      </div>
    </div>
  )
}

/**
 * 要把哪幾則對話帶過來（owner 2026-08-08）。
 *
 * **預設一則都不勾**，另給「全選／取消全選」。對話是所有資料裡最私密、也最佔空間的，
 * 預設全帶會讓人在不知情下把整個聊天記錄複製到另一台裝置。
 *
 * 已經匯入過的照樣列出來但停用 —— 直接濾掉的話使用者會以為那幾則不見了。
 */
function ConversationPicker({
  items,
  picked,
  onChange
}: {
  items: SyncConversationItem[] | null
  picked: Set<string>
  onChange: (next: Set<string>) => void
}): JSX.Element | null {
  if (items === null) {
    return (
      <p className="rounded-[14px] bg-[var(--bg)] p-3 text-[12px] leading-relaxed text-[var(--text-sub)]">
        這台電腦的 DeST 版本還不支援帶對話過來。更新電腦上的 DeST 之後再匯入一次就會出現。
      </p>
    )
  }

  const selectable = items.filter((c) => !c.alreadyImported)
  if (items.length === 0) {
    return (
      <p className="rounded-[14px] bg-[var(--bg)] p-3 text-[12px] text-[var(--text-sub)]">
        那台電腦上沒有對話記錄。
      </p>
    )
  }

  const toggle = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] text-[var(--text)]">
          要帶哪幾則對話？（已選 {picked.size}）
        </p>
        <button
          type="button"
          disabled={selectable.length === 0}
          onClick={() => onChange(new Set(selectable.map((c) => c.id)))}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] disabled:opacity-40"
        >
          全選
        </button>
        <button
          type="button"
          disabled={picked.size === 0}
          onClick={() => onChange(new Set())}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-[11px] text-[var(--text)] disabled:opacity-40"
        >
          取消全選
        </button>
      </div>

      <div className="scroll-y max-h-[45vh] space-y-1.5">
        {items.map((c) => {
          const checked = picked.has(c.id)
          return (
            <button
              key={c.id}
              type="button"
              disabled={c.alreadyImported}
              onClick={() => toggle(c.id)}
              className={`flex w-full items-start gap-2.5 rounded-[14px] border px-3 py-2.5 text-left disabled:opacity-45 ${
                checked ? 'border-[var(--text-sub)] bg-[var(--bg)]' : 'border-[var(--border)]'
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
                  checked ? 'border-[var(--text)] bg-[var(--mint)]' : 'border-[var(--border)]'
                }`}
              >
                {checked && <MonoIcon name="check" className="h-3 w-3 text-[var(--text)]" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[var(--text)]">{c.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[var(--text-sub)]">
                  {c.alreadyImported
                    ? '已經帶過來了'
                    : `${c.messageCount} 則${c.characterNames.length ? ` · ${c.characterNames.join('、')}` : ''}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
        帶過來的對話會以新的一則加進手機，不會覆蓋這裡原有的內容。含圖片的對話比較大，抓起來會慢一些。
      </p>
    </div>
  )
}

function ChoiceRow({
  label,
  hint,
  checked,
  onSelect
}: {
  label: string
  hint: string
  checked: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-[14px] border px-3 py-2.5 text-left ${
        checked ? 'border-[var(--text-sub)] bg-[var(--bg)]' : 'border-[var(--border)]'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-[var(--text)]' : 'border-[var(--border)]'
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-[var(--text)]" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-[var(--text)]">{label}</span>
        <span className="mt-0.5 block text-[11px] text-[var(--text-sub)]">{hint}</span>
      </span>
    </button>
  )
}
