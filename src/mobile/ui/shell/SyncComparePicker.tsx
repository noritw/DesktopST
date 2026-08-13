import { useEffect, useMemo, useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import {
  KINDS,
  actionFor,
  applyPreset,
  countPlan,
  defaultChoices,
  listDeletions,
  type ChoiceMap,
  type PairChoice,
  type PairKind,
  type PairPlanCounts,
  type PairRow
} from '@core/sync/pair'
import {
  applySettingsPreset,
  countSettingsPlan,
  defaultSettingsChoices,
  type SettingsChoice,
  type SettingsChoiceMap,
  type SettingsFieldRow,
  type SettingsGroup,
  type SettingsPlanCounts
} from '@core/sync/settingsPair'
import { useUiStore } from '../stores/uiStore'

/** 分頁籤：五類資料 ＋ 一個「設定」。用字面量聯集而不是塞進 `PairKind`，
 * 因為設定走完全不同的比對系統（`core/sync/settingsPair.ts`），沒有 id 配對。 */
type Tab = PairKind | 'settings'

const SETTINGS_GROUP_LABEL: Record<SettingsGroup, string> = {
  llm: 'AI 模型',
  chat: '對話',
  memory: '記憶',
  appearance: '外觀',
  modules: '模組'
}

/** 底部那一行「這次會做什麼」。 */
function summary(plan: PairPlanCounts, settingsPlan: SettingsPlanCounts): string {
  const parts: string[] = []
  const push = plan.push + settingsPlan.push
  const pull = plan.pull + settingsPlan.pull
  if (push > 0) parts.push(`${push} 筆送到電腦`)
  if (pull > 0) parts.push(`${pull} 筆帶回手機`)
  if (plan.deleteLocal > 0) parts.push(`從手機刪掉 ${plan.deleteLocal} 筆`)
  if (plan.deleteRemote > 0) parts.push(`從電腦刪掉 ${plan.deleteRemote} 筆`)
  return parts.length === 0 ? '這樣不會搬動任何資料' : `會${parts.join('、')}`
}

/**
 * 切換模式前的逐項比對（S2 M4，owner 2026-08-13 指定）。
 *
 * ## 為什麼取代 M3 的三選一對話框
 *
 * M3 只能整包決定「帶過去／不帶」，而且「兩邊是不是同一筆」是問壞掉的基準表
 * （`core/sync/pair.ts` 檔頭有完整說明）。實測結果是每切換一次兩邊就多一批
 * 重複資料：owner 的電腦上長出 23 個情境（真正只有 7 個）、各 10 份的世界觀
 * 與使用者設定。owner 的原話：「應該要所有有變動的部分列出來一項項比對，
 * 左邊手機版，右邊電腦版，名稱／ID 相同視為同個物件，勾選要留哪個。」
 *
 * ## 版型
 *
 * 左手機、右電腦，點哪一邊就選哪一邊，中間那顆是「都不動」。
 * **內容相同的列預設收起來**——兩邊一模一樣的東西佔滿畫面只會讓真正要決定的
 * 那幾列被埋掉。
 */
const KIND_LABEL: Record<PairKind, string> = {
  characters: '角色',
  personas: '使用者',
  worlds: '世界觀',
  scenes: '情境',
  lorebooks: '用語解說'
}

export function SyncComparePicker(): JSX.Element | null {
  const box = useUiStore((s) => s.syncCompare)
  const close = useUiStore((s) => s.closeSyncCompare)
  const confirm = useUiStore((s) => s.confirm)

  const [choices, setChoices] = useState<ChoiceMap | null>(null)
  const [settingsChoices, setSettingsChoices] = useState<SettingsChoiceMap | null>(null)
  const [tab, setTab] = useState<Tab>('characters')
  const [showSame, setShowSame] = useState(false)

  // 每次開啟都從預設決定重新開始，不沿用上一趟（上一趟的資料早就不同了）
  useEffect(() => {
    if (!box) return
    setChoices(defaultChoices(box.table))
    setSettingsChoices(defaultSettingsChoices(box.settingsRows))
    // 預設停在第一個「有東西要決定」的分頁，不要開在空的角色頁
    const firstBusy = KINDS.find((k) => box.table[k].some((r) => r.compare !== 'same'))
    const settingsBusy = box.settingsRows.some((r) => r.differs)
    setTab(firstBusy ?? (settingsBusy ? 'settings' : 'characters'))
    setShowSame(false)
  }, [box])

  const table = box?.table
  const settingsRows = box?.settingsRows
  const plan = useMemo(
    (): PairPlanCounts =>
      table && choices ? countPlan(table, choices) : { push: 0, pull: 0, deleteLocal: 0, deleteRemote: 0, untouched: 0 },
    [table, choices]
  )
  const settingsPlan = useMemo(
    (): SettingsPlanCounts =>
      settingsRows && settingsChoices ? countSettingsPlan(settingsRows, settingsChoices) : { push: 0, pull: 0, untouched: 0 },
    [settingsRows, settingsChoices]
  )

  if (!box || !choices || !table || !settingsChoices || !settingsRows) return null

  const setOne = (kind: PairKind, key: string, choice: PairChoice): void => {
    setChoices((prev) => (prev ? { ...prev, [kind]: { ...prev[kind], [key]: choice } } : prev))
  }
  const setOneSetting = (key: string, choice: SettingsChoice): void => {
    setSettingsChoices((prev) => (prev ? { ...prev, [key]: choice } : prev))
  }

  const deleteCount = plan.deleteLocal + plan.deleteRemote
  const nothingToDo =
    plan.push === 0 && plan.pull === 0 && deleteCount === 0 && settingsPlan.push === 0 && settingsPlan.pull === 0

  /**
   * 送出前的第二道關卡（owner 2026-08-14 要求）。
   *
   * 只有真的要刪東西時才多問一次，而且**逐筆列出名字**——只講數量的話使用者
   * 沒辦法發現自己選錯了哪一列。純複製不問，否則每次同步都多按一下很煩。
   */
  const onConfirm = async (): Promise<void> => {
    const deletions = listDeletions(table, choices)
    if (deletions.length > 0) {
      const lines = deletions.map(
        (d) => `・${KIND_LABEL[d.kind]}「${d.name}」← ${d.side === 'local' ? '從這支手機刪掉' : '從電腦刪掉'}`
      )
      const ok = await confirm({
        title: '確定要刪掉這些嗎？',
        message: [`以下 ${deletions.length} 筆會被永久刪除，無法復原：`, '', ...lines].join('\n'),
        confirmLabel: '確定刪除'
      })
      if (!ok) return
    }
    close({ choices, settingsChoices })
  }

  const isSettingsTab = tab === 'settings'
  const rows = isSettingsTab ? [] : table[tab]
  const visible = showSame ? rows : rows.filter((r) => r.compare !== 'same')
  const sameCount = rows.length - rows.filter((r) => r.compare !== 'same').length
  const visibleSettings = showSame ? settingsRows : settingsRows.filter((r) => r.differs)
  const sameSettingsCount = settingsRows.length - settingsRows.filter((r) => r.differs).length

  return (
    <div className="anim-fade-in fixed inset-0 z-[62] flex flex-col bg-black/45" role="dialog" aria-label="比對手機與電腦的資料">
      <button type="button" aria-label="取消" className="h-10 shrink-0" onClick={() => close(null)} />

      <div
        className="flex min-h-0 flex-1 flex-col rounded-t-[18px] border-t border-[var(--border)] bg-[var(--bg)]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--text)]">比對手機與電腦的資料</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-sub)]">
            名稱或編號相同的視為同一筆。點左邊用手機那份、點右邊用電腦那份，
            中間的「不動」是兩邊各自維持原狀。
          </p>
        </div>

        {/* 三顆快捷（只影響目前分頁：資料分頁動 table，設定分頁動設定欄位） */}
        <div className="flex gap-2 border-b border-[var(--border)] px-4 py-2">
          <PresetButton
            label="全部用手機"
            onClick={() =>
              isSettingsTab ? setSettingsChoices(applySettingsPreset(settingsRows, 'local')) : setChoices(applyPreset(table, 'local'))
            }
          />
          <PresetButton
            label="全部用電腦"
            onClick={() =>
              isSettingsTab
                ? setSettingsChoices(applySettingsPreset(settingsRows, 'remote'))
                : setChoices(applyPreset(table, 'remote'))
            }
          />
          <PresetButton
            label="保留差異"
            onClick={() =>
              isSettingsTab ? setSettingsChoices(applySettingsPreset(settingsRows, 'keep')) : setChoices(applyPreset(table, 'keep'))
            }
          />
        </div>

        {/* 分頁籤 */}
        <div className="scroll-x flex shrink-0 gap-1 border-b border-[var(--border)] px-2 py-2">
          {KINDS.map((kind) => {
            const todo = table[kind].filter((r) => r.compare !== 'same').length
            const on = tab === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setTab(kind)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${
                  on ? 'bg-[var(--mint)] text-[var(--text)]' : 'border border-[var(--border)] text-[var(--text-sub)]'
                }`}
              >
                {KIND_LABEL[kind]}
                {todo > 0 && <span className="ml-1 text-[10px]">{todo}</span>}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${
              isSettingsTab ? 'bg-[var(--mint)] text-[var(--text)]' : 'border border-[var(--border)] text-[var(--text-sub)]'
            }`}
          >
            設定
            {settingsRows.filter((r) => r.differs).length > 0 && (
              <span className="ml-1 text-[10px]">{settingsRows.filter((r) => r.differs).length}</span>
            )}
          </button>
        </div>

        <div className="scroll-y min-h-0 flex-1 px-2 py-2">
          {isSettingsTab ? (
            <>
              {visibleSettings.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-[var(--text-sub)]">
                  設定兩邊完全相同，沒有要決定的。
                </p>
              )}
              {groupedSettingsRows(visibleSettings).map(([group, groupRows]) => (
                <div key={group}>
                  <p className="px-1 pb-1 pt-2 text-[11px] font-medium text-[var(--text-sub)]">
                    {SETTINGS_GROUP_LABEL[group]}
                  </p>
                  {groupRows.map((row) => (
                    <SettingsCompareRow
                      key={row.key}
                      row={row}
                      choice={settingsChoices[row.key] ?? 'keep'}
                      onChoose={(c) => setOneSetting(row.key, c)}
                    />
                  ))}
                </div>
              ))}
              {sameSettingsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSame((v) => !v)}
                  className="mt-2 w-full rounded-[12px] py-2 text-[11px] text-[var(--text-sub)] active:bg-[var(--surface)]"
                >
                  {showSame ? '收起' : `另有 ${sameSettingsCount} 項兩邊相同`}
                </button>
              )}
            </>
          ) : (
            <>
              {visible.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-[var(--text-sub)]">
                  {rows.length === 0 ? '兩邊都沒有這類資料。' : '這類資料兩邊完全相同，沒有要決定的。'}
                </p>
              )}

              {visible.map((row) => (
                <CompareRow
                  key={row.key}
                  row={row}
                  choice={choices[tab as PairKind][row.key] ?? 'keep'}
                  onChoose={(c) => setOne(tab as PairKind, row.key, c)}
                />
              ))}

              {sameCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSame((v) => !v)}
                  className="mt-2 w-full rounded-[12px] py-2 text-[11px] text-[var(--text-sub)] active:bg-[var(--surface)]"
                >
                  {showSame ? '收起' : `另有 ${sameCount} 筆兩邊相同`}
                </button>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-4 py-3">
          <p className="mb-2 text-center text-[11px] text-[var(--text-sub)]">{summary(plan, settingsPlan)}</p>
          {deleteCount > 0 && (
            <p className="mb-2 rounded-[8px] bg-[var(--danger)] px-2 py-1 text-center text-[11px] text-[var(--danger-text)]">
              ⚠️ 其中 {deleteCount} 筆會被刪掉，按下去之後會再問一次
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => close(null)}
              className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text)]"
            >
              取消切換
            </button>
            <button
              type="button"
              onClick={() => void onConfirm()}
              className={`flex-1 rounded-full py-2.5 text-sm font-medium ${
                deleteCount > 0
                  ? 'bg-[var(--danger)] text-[var(--danger-text)]'
                  : 'bg-[var(--mint)] text-[var(--text)]'
              }`}
            >
              {nothingToDo ? '直接切換' : deleteCount > 0 ? '同步並刪除' : '照這樣同步'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-full border border-[var(--border)] py-1.5 text-[11px] text-[var(--text)] active:bg-[var(--surface)]"
    >
      {label}
    </button>
  )
}

/** 只給人看的時間，精確到分鐘就夠；用 `toLocaleString` 跟裝置語系一致（CLAUDE.md §5）。 */
function when(ts: number | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CompareRow({
  row,
  choice,
  onChoose
}: {
  row: PairRow
  choice: PairChoice
  onChoose: (c: PairChoice) => void
}): JSX.Element {
  const onlyLocal = !!row.localId && !row.remoteId
  const onlyRemote = !row.localId && !!row.remoteId
  const action = actionFor(row, choice)
  const deleting = action === 'delete-local' || action === 'delete-remote'

  return (
    <div
      className={`mb-2 rounded-[14px] border px-2 py-2 ${
        deleting ? 'border-[var(--danger)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{row.name}</span>
        {row.compare === 'differs' && <span className="shrink-0 text-[10px] text-[var(--text-sub)]">內容不同</span>}
        {row.compare === 'unknown' && <span className="shrink-0 text-[10px] text-[var(--text-sub)]">無法比對</span>}
        {onlyLocal && <span className="shrink-0 text-[10px] text-[var(--text-sub)]">電腦上沒有</span>}
        {onlyRemote && <span className="shrink-0 text-[10px] text-[var(--text-sub)]">手機上沒有</span>}
      </div>

      {/* 電腦端被改過名字時要講出來，否則使用者看不懂為什麼兩邊名稱不一樣 */}
      {row.remoteName && (
        <p className="px-1 pb-1.5 text-[10px] text-[var(--text-sub)]">電腦上叫「{row.remoteName}」</p>
      )}

      <div className="flex items-stretch gap-1">
        <SideButton
          label="手機"
          sub={row.localId ? when(row.localUpdatedAt) : '沒有'}
          empty={!row.localId}
          active={choice === 'local'}
          onClick={() => onChoose('local')}
        />
        <button
          type="button"
          onClick={() => onChoose('keep')}
          className={`shrink-0 rounded-[10px] px-2 text-[11px] ${
            choice === 'keep' ? 'bg-[var(--mint)] text-[var(--text)]' : 'text-[var(--text-sub)]'
          }`}
        >
          不動
        </button>
        <SideButton
          label="電腦"
          sub={row.remoteId ? when(row.remoteUpdatedAt) : '沒有'}
          empty={!row.remoteId}
          active={choice === 'remote'}
          onClick={() => onChoose('remote')}
        />
      </div>

      {/* 選了空的那一邊＝要刪掉另一邊，講清楚刪的是哪一台 */}
      {action === 'delete-local' && <DeleteHint text="會從這支手機刪掉" />}
      {action === 'delete-remote' && <DeleteHint text="會從電腦刪掉" />}
    </div>
  )
}

/** 依 `group` 分段，但保留 `pairSettings()` 原本的欄位順序（不重新排序）。 */
function groupedSettingsRows(rows: SettingsFieldRow[]): [SettingsGroup, SettingsFieldRow[]][] {
  const out: [SettingsGroup, SettingsFieldRow[]][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (last && last[0] === r.group) last[1].push(r)
    else out.push([r.group, [r]])
  }
  return out
}

/** 設定值的顯示字串——布林顯示開／關，空字串顯示「未設定」。 */
function formatSettingsValue(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? '開' : '關'
  if (v === '') return '（未設定）'
  return String(v)
}

/**
 * 設定的比對列。跟資料的 `CompareRow` 平行但簡單得多——設定沒有「單邊獨有」
 * 的狀態（兩邊永遠都有值），所以沒有刪除語意、沒有 empty 警告色，
 * 純粹是「這個數字／選項，要用手機的還是電腦的」。
 */
function SettingsCompareRow({
  row,
  choice,
  onChoose
}: {
  row: SettingsFieldRow
  choice: SettingsChoice
  onChoose: (c: SettingsChoice) => void
}): JSX.Element {
  return (
    <div className="mb-2 rounded-[14px] border border-[var(--border)] px-2 py-2">
      <p className="px-1 pb-1.5 text-[13px] font-medium text-[var(--text)]">{row.label}</p>
      <div className="flex items-stretch gap-1">
        <ValueButton label="手機" value={formatSettingsValue(row.localValue)} active={choice === 'local'} onClick={() => onChoose('local')} />
        <button
          type="button"
          onClick={() => onChoose('keep')}
          className={`shrink-0 rounded-[10px] px-2 text-[11px] ${
            choice === 'keep' ? 'bg-[var(--mint)] text-[var(--text)]' : 'text-[var(--text-sub)]'
          }`}
        >
          不動
        </button>
        <ValueButton label="電腦" value={formatSettingsValue(row.remoteValue)} active={choice === 'remote'} onClick={() => onChoose('remote')} />
      </div>
    </div>
  )
}

function ValueButton({
  label,
  value,
  active,
  onClick
}: {
  label: string
  value: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] py-1.5 ${
        active ? 'bg-[var(--mint)]' : 'border border-[var(--border)]'
      }`}
    >
      <span className="flex items-center gap-1 text-[12px] text-[var(--text)]">
        {active && <MonoIcon name="check" className="h-3 w-3" />}
        {label}
      </span>
      <span className="truncate text-[10px] text-[var(--text-sub)]">{value}</span>
    </button>
  )
}

function DeleteHint({ text }: { text: string }): JSX.Element {
  return (
    <p className="mt-1.5 rounded-[8px] bg-[var(--danger)] px-2 py-1 text-[10px] text-[var(--danger-text)]">
      ⚠️ {text}
    </p>
  )
}

/**
 * 一邊的選擇鈕。
 *
 * `empty` ＝ 這一邊沒有這筆資料。**仍然可以按**（owner 2026-08-14）：
 * 「以這邊為準」而這邊是空的，語意就是「另一邊也該沒有」＝ 刪除。
 * 停用它的話，使用者在電腦上刪掉東西之後，完全沒有辦法讓手機跟著刪。
 *
 * 選中的空邊畫成**警告色**而不是一般的選取色——這是整個畫面唯一會刪資料的
 * 操作，不能跟「複製過去」長得一樣。
 */
function SideButton({
  label,
  sub,
  empty,
  active,
  onClick
}: {
  label: string
  sub: string
  empty: boolean
  active: boolean
  onClick: () => void
}): JSX.Element {
  const danger = empty && active
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] py-1.5 ${
        danger
          ? 'bg-[var(--danger)]'
          : active
            ? 'bg-[var(--mint)]'
            : `border border-[var(--border)] ${empty ? 'opacity-45' : ''}`
      }`}
    >
      <span className={`flex items-center gap-1 text-[12px] ${danger ? 'text-[var(--danger-text)]' : 'text-[var(--text)]'}`}>
        {active && <MonoIcon name="check" className="h-3 w-3" />}
        {label}
      </span>
      <span className={`truncate text-[10px] ${danger ? 'text-[var(--danger-text)]' : 'text-[var(--text-sub)]'}`}>
        {danger ? '刪除另一邊' : sub}
      </span>
    </button>
  )
}
