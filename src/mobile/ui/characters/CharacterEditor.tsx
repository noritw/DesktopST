import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, TextareaHTMLAttributes } from 'react'
import type { Character } from '@core/types'
import type { PresetListItem } from '@core/data'
import type { FaceCropRect } from '@core/character/displayImage'
import { EMOTION_OPTIONS, emotionLabel } from '@core/character/emotionCatalog'
import MonoIcon from '@shared/MonoIcon'
import { getData, isAttached, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeCharacterError } from './characterErrors'
import { extOf, prepareAvatar } from './avatarFile'
import { invalidateAvatar, useAvatarUrl, useCharacterDisplayImage, invalidateAllCharacterDisplayImages } from './useAvatarUrl'
import { downloadBytes, mimeForFilename, pickFile } from '../shell/fileTransfer'

/**
 * 角色卡編輯器（決議④ 的最大單項）。
 *
 * 欄位與用語**逐項對齊桌面版**（`components/tabs/BasicInfoTab.tsx`／`AdvancedTab.tsx`）：
 * 同一張卡在兩邊看到的名字不一樣，使用者會以為是兩種東西。
 *
 * 排版上把桌面的四個分頁壓成「一路往下捲 ＋ 一塊進階摺疊區」——
 * 手機上分頁要先猜東西藏在哪個標籤底下，而這裡的欄位少到不需要分。
 *
 * ⚠️ **「顯示設定」區塊（框選臉部範圍／表情圖片）已於 2026-08-22 補上**——
 * 舊決議「情緒圖片那一頁不做」（roadmap §3.1／§5.1）已被 owner 推翻，
 * 見 `docs/mobile-character-expression-plan.md` 開頭的說明。
 */
export function CharacterEditor({ characterId }: { characterId: string }): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const pop = useUiStore((s) => s.pop)
  const push = useUiStore((s) => s.push)
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)
  const openAvatarCrop = useUiStore((s) => s.openAvatarCrop)
  const openFaceCrop = useUiStore((s) => s.openFaceCrop)
  const refresh = useAppStore((s) => s.refresh)
  const attached = useAppStore((s) => s.attached)

  const [draft, setDraft] = useState<Character | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [lorebooks, setLorebooks] = useState<PresetListItem[]>([])
  const [generatingLoreId, setGeneratingLoreId] = useState<string | null>(null)
  const [loreMsg, setLoreMsg] = useState<string | null>(null)
  const [faceCrop, setFaceCropState] = useState<FaceCropRect | null>(null)

  // guard 讀的是「當下」的狀態，所以走 ref —— 用 state 會被 closure 鎖在註冊當時那一刻。
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const markDirty = (): void => {
    dirtyRef.current = true
    setDirty(true)
  }

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      const [card, books, crop] = await Promise.all([
        getData().characters.get(characterId),
        // 沒有用語解說功能的電腦（或還沒建任何一本）不該讓整個編輯器載不出來。
        getData().lorebooks.list().catch(() => []),
        getData().characters.getFaceCrop(characterId).catch(() => null)
      ])
      setDraft(card)
      setLorebooks(books)
      setFaceCropState(crop)
    } catch {
      // B-4：切換模式的空窗期間 getData() 會 throw，不是真的失敗——見
      // SettingsView.tsx 同一套修法的註解。保持 draft === null，下面
      // `if (!draft) 載入中⋯⋯` 會自然接手，`attached` 變 true 後自動重試。
      if (isAttached()) setFailed(true)
    }
  }, [characterId])

  useEffect(() => {
    void load()
  }, [load, attached])

  const save = useCallback(async (): Promise<boolean> => {
    const current = draft
    if (!current) return false
    if (!current.name.trim()) {
      toast('角色名稱不可空白', 'error')
      return false
    }
    setBusy(true)
    try {
      await getData().characters.save(current)
      dirtyRef.current = false
      setDirty(false)
      // 桌面的角色頭像列與名字要跟著變。
      await refresh()
      return true
    } catch (e) {
      toast(describeCharacterError(e, '儲存'), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }, [draft, refresh, toast])

  /**
   * 未儲存就要離開時攔一次（✕、點遮罩、返回手勢三條路共用，見 `uiStore.requestPop`）。
   *
   * 沒有這道的話，在手機上往回滑一下就會把剛打完的人格設定整段丟掉，
   * 而且**沒有任何提示** —— 使用者只會發現「剛剛打的東西不見了」。
   */
  useEffect(() => {
    setCloseGuard(() => {
      if (!dirtyRef.current) return true
      void (async () => {
        const ok = await confirm({
          title: '還沒儲存',
          message: '這張角色卡有還沒儲存的改動，要捨棄嗎？',
          confirmLabel: '捨棄',
          destructive: true
        })
        if (ok) {
          dirtyRef.current = false
          pop()
        }
      })()
      return false
    })
    return () => setCloseGuard(null)
  }, [setCloseGuard, confirm, pop])

  const changeAvatar = async (): Promise<void> => {
    // ⚠️ 一律 `image/*`，不要列具體格式（見 `pickFile` 的說明）。
    // 真正的格式把關在 `prepareAvatar`，不是在選圖器上。
    const file = await pickFile('image/*')
    if (!file || !draft) return

    // GIF 不進裁切畫面：裁切一定要把圖畫到 canvas 上再輸出，只留得住第一格，
    // 動圖就死了——`avatarFile.ts` 的 `prepareAvatar` 本來就會把 GIF 原檔保留，
    // 裁切這步在這裡直接跳過，交給後面既有的邏輯處理。
    const isGif = file.type === 'image/gif' || extOf(file.name) === '.gif'
    const toPrepare = isGif ? file : await openAvatarCrop(file)
    if (!toPrepare) return // 使用者在裁切畫面按了取消

    setBusy(true)
    try {
      const prepared = await prepareAvatar(toPrepare)
      // ⚠️ **圖檔先落地、角色卡後存**（與桌面版同語意）：`saveAvatar` 回來的是
      // 平台自己決定的位址，手機不可以自己編一個路徑塞進卡裡。
      const avatar = await getData().characters.saveAvatar(draft.id, prepared)
      setDraft({ ...draft, avatar })
      markDirty()
      // 位址通常沒變（`/api/avatar/:id`），不清快取的話畫面上還是舊圖。
      invalidateAvatar(draft.id)
    } catch (e) {
      toast(describeCharacterError(e, '更換主圖'), 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 框選臉部顯示範圍（§3.1）：對話記錄與小工具共用同一份設定，只算比例矩形，
   * 不輸出新檔案——所以拿現有的主圖網址去框，不需要先落地一份新圖。
   */
  const pickFaceCrop = async (): Promise<void> => {
    if (!draft) return
    const url = await getData().characters.avatarUrl(draft.id)
    if (!url) {
      toast('請先設定主圖，才能框選顯示範圍', 'error')
      return
    }
    const rect = await openFaceCrop(url)
    if (!rect) return
    try {
      await getData().characters.setFaceCrop(draft.id, rect)
      setFaceCropState(rect)
      invalidateAllCharacterDisplayImages()
      toast('已更新顯示範圍')
    } catch (e) {
      toast(describeCharacterError(e, '框選顯示範圍'), 'error')
    }
  }

  const clearFaceCrop = async (): Promise<void> => {
    if (!draft) return
    try {
      await getData().characters.setFaceCrop(draft.id, null)
      setFaceCropState(null)
      invalidateAllCharacterDisplayImages()
    } catch (e) {
      toast(describeCharacterError(e, '清除顯示範圍'), 'error')
    }
  }

  /** 新增／替換一張表情圖片，直接指定給某個情緒 key（§3.3）。 */
  const pickEmotionSprite = async (emotionKey: string): Promise<void> => {
    const file = await pickFile('image/*')
    if (!file || !draft) return
    setBusy(true)
    try {
      const prepared = await prepareAvatar(file)
      const path = await getData().characters.saveEmotionSprite(draft.id, emotionKey, prepared)
      setDraft((prev) => (prev ? { ...prev, emotions: { ...(prev.emotions ?? {}), [emotionKey]: path } } : prev))
      markDirty()
      invalidateAllCharacterDisplayImages()
    } catch (e) {
      toast(describeCharacterError(e, '新增表情圖片'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportCard = async (kind: 'png' | 'json'): Promise<void> => {
    if (!draft) return
    // 匯出的是**電腦上那張**，所以未儲存的改動不會在裡面 —— 先存起來比較不意外。
    if (dirtyRef.current && !(await save())) return
    setBusy(true)
    try {
      const file = await getData().characters.exportCard(draft.id, kind)
      await downloadBytes(file.bytes, file.filename, mimeForFilename(file.filename))
      toast(`已匯出 ${file.filename}`)
    } catch (e) {
      toast(describeCharacterError(e, '匯出'), 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 從這張角色卡生成一條「這個角色是誰」的用語條目（docs/future-lorebook.md §8）。
   * 讀的是**電腦上已存的那份**（跟桌面版同一個限制），還沒儲存的改動不會被拿去生成。
   */
  const generateLoreEntry = async (lorebookId: string): Promise<void> => {
    setLoreMsg(null)
    setGeneratingLoreId(lorebookId)
    try {
      const r = await getData().lorebooks.generateEntry(characterId, lorebookId)
      setLoreMsg(r.ok ? `已加入：${r.entry.content}` : r.error)
    } catch (e) {
      setLoreMsg(describeCharacterError(e, '生成用語條目'))
    } finally {
      setGeneratingLoreId(null)
    }
  }

  /** 複製這張卡當模板改（新手上手最快的路：先複製、只改名字，其他慢慢填）。 */
  const duplicate = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const char = await getData().characters.duplicate(draft.id)
      await refresh()
      toast(`已複製為「${char.name}」`)
      push('character-editor', char.id)
    } catch (e) {
      toast(describeCharacterError(e, '複製'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!draft) return
    const ok = await confirm({
      title: `刪除「${draft.name}」`,
      message: '這會連同這個角色的圖片一起刪掉，而且不能復原。如果他正在對話裡，也會一起退場。',
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      await getData().characters.remove(draft.id)
      dirtyRef.current = false
      await refresh()
      toast('已刪除角色')
      pop()
    } catch (e) {
      toast(describeCharacterError(e, '刪除'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入角色卡失敗</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </div>
    )
  }

  if (!draft) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  const set = <K extends keyof Character>(key: K, value: Character[K]): void => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    markDirty()
  }

  return (
    <div className="pb-2">
      <AvatarPicker draft={draft} onPick={() => void changeAvatar()} busy={busy} />

      <DisplaySettingsSection
        characterId={draft.id}
        emotions={draft.emotions ?? {}}
        faceCrop={faceCrop}
        busy={busy}
        onPickFaceCrop={() => void pickFaceCrop()}
        onClearFaceCrop={() => void clearFaceCrop()}
        onPickEmotionSprite={(key) => void pickEmotionSprite(key)}
      />

      <Field label="名稱">
        <input
          type="text"
          maxLength={100}
          className="field"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>

      <NicknameField
        values={draft.nicknames ?? []}
        onChange={(next) => set('nicknames', next)}
      />

      <Field label="簡介" hint="角色的基本資料，例如外觀、背景、身份。">
        <AutoTextarea minHeight={72} value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </Field>

      <Field label="個性">
        <AutoTextarea minHeight={88} placeholder="角色的性格特質、說話方式..." value={draft.personality} onChange={(e) => set('personality', e.target.value)} />
      </Field>

      <Field label="招呼語">
        <AutoTextarea minHeight={72} placeholder="開場白，角色第一句話會說什麼" value={draft.firstMessage} onChange={(e) => set('firstMessage', e.target.value)} />
      </Field>

      <Field label="對話範例" hint="可用標籤：{{user}}、{{char}}">
        <AutoTextarea minHeight={88} value={draft.exampleDialogue} onChange={(e) => set('exampleDialogue', e.target.value)} />
      </Field>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-1 flex w-full items-center gap-1.5 border-t border-[var(--border)] pt-3 text-sm text-[var(--text-sub)]"
      >
        <span className={showAdvanced ? 'rotate-90 transition-transform' : 'transition-transform'}>▶</span>
        進階
      </button>

      {showAdvanced && (
        <div className="mt-2">
          <Field label="場景" hint="角色當下的處境、與使用者的關係。可用標籤：{{user}}、{{char}}">
            <AutoTextarea minHeight={72} value={draft.scenario ?? ''} onChange={(e) => set('scenario', e.target.value)} />
          </Field>

          <Field label="作者備註" hint="給模型的額外提示，例如「常忘記今天星期幾」。">
            <AutoTextarea minHeight={64} value={draft.creatorNotes ?? ''} onChange={(e) => set('creatorNotes', e.target.value)} />
          </Field>

          <ChipField
            label="新聞關鍵字"
            hint="這個角色額外感興趣的新聞主題（需啟用新聞陪聊）。輸入後按 Enter。"
            placeholder="例如：太空、考古、貓咪"
            values={draft.newsKeywords ?? []}
            onChange={(next) => set('newsKeywords', next)}
          />

          <div className="mb-4">
            <p className="text-xs font-semibold text-[var(--text)]">用語解說</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
              這個角色要額外帶上哪幾本（會疊加在世界觀那份之前）。內容在「情境與設定組 → 用語解說」編輯；
              「生成用語條目」會用輔助模型從這張角色卡（已儲存的那份）寫一句「這個角色是誰」，加進該本，之後可自行修改。
            </p>
            {lorebooks.length === 0 ? (
              <p className="mt-1 text-[11px] text-[var(--text-sub)]">還沒有任何用語解說。</p>
            ) : (
              <div className="mt-1.5 space-y-1">
                {lorebooks.map((b) => {
                  const checked = (draft.lorebookIds ?? []).includes(b.id)
                  return (
                    <div key={b.id} className="flex items-center gap-2 py-1">
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          className="h-4 w-4 accent-[var(--mint2)]"
                          onChange={(e) =>
                            set(
                              'lorebookIds',
                              e.target.checked
                                ? [...(draft.lorebookIds ?? []), b.id]
                                : (draft.lorebookIds ?? []).filter((x) => x !== b.id)
                            )
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{b.name}</span>
                      </label>
                      <button
                        type="button"
                        disabled={generatingLoreId !== null}
                        onClick={() => void generateLoreEntry(b.id)}
                        className="shrink-0 rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text)] disabled:opacity-50"
                      >
                        {generatingLoreId === b.id ? '生成中…' : '生成用語條目'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {loreMsg && <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-sub)]">{loreMsg}</p>}
          </div>

          <Field label="額外系統指示" hint="一般不需填寫；主要留給 SillyTavern 卡片的 system_prompt 欄位。">
            <AutoTextarea
              minHeight={72}
              value={draft.systemPromptOverride ?? ''}
              onChange={(e) => set('systemPromptOverride', e.target.value)}
            />
          </Field>

          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void exportCard('png')} className="btn-ghost flex-1">
              匯出 PNG 卡
            </button>
            <button type="button" disabled={busy} onClick={() => void exportCard('json')} className="btn-ghost flex-1">
              匯出 JSON
            </button>
          </div>

          <button type="button" disabled={busy} onClick={() => void duplicate()} className="btn-ghost mt-2 w-full">
            複製這個角色
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="mt-2 w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)] disabled:opacity-50"
          >
            刪除這個角色
          </button>
        </div>
      )}

      {/* 儲存固定在底部：欄位一多，捲到最下面才找得到儲存鍵是手機上最常見的抱怨。 */}
      <div className="sticky bottom-0 -mx-5 mt-3 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-1 pt-2">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          {busy ? '處理中⋯⋯' : dirty ? '儲存' : '已儲存'}
        </button>
      </div>
    </div>
  )
}

/**
 * 說明文字放進欄位的 placeholder，而不是標籤下方一整行小字——
 * 手機螢幕窄，小字排版擠在一起很難唸完，placeholder 有內容時自動讓開更省地方（owner 2026-08-05 實機回報）。
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement }): JSX.Element {
  const field = hint && isValidElement(children) ? cloneElement(children, { placeholder: hint } as Partial<{ placeholder: string }>) : children
  return (
    <label className="mb-4 block">
      <span className="text-xs font-semibold text-[var(--text)]">{label}</span>
      <span className="mt-1 block">{field}</span>
    </label>
  )
}

/**
 * 自動撐高的 textarea：內容增加時高度跟著長，不需要使用者手動拖拉。
 * 最低高度由 `minHeight` 決定（對齊原本 min-h-[Npx] 設計）。
 */
function AutoTextarea({
  minHeight = 72,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
  }

  // value 改變時重算高度（受控模式）
  useEffect(() => { grow() })

  return (
    <textarea
      ref={ref}
      rows={1}
      style={{ minHeight, resize: 'none', overflow: 'hidden' }}
      className={`field ${className}`}
      onInput={grow}
      {...props}
    />
  )
}

function AvatarPicker({ draft, onPick, busy }: { draft: Character; onPick: () => void; busy: boolean }): JSX.Element {
  const url = useAvatarUrl(draft.id)
  // ⚠️ **兩種失敗都要落到 🐾**（同清單 D6 的教訓）：
  // 遙控模式的 `avatarUrl()` 永遠回得出一個網址（`/api/avatar/:id`），
  // 沒設主圖時是那個網址回 404 —— 只判斷 `url == null` 的話，
  // 新建的角色會看到一個破圖圖示。
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  const showImage = !!url && !broken

  return (
    <div className="mb-4">
      {/* 不提「電腦桌面」：手機版之後要能獨立運作（不依賴電腦），這段文案不該預設使用者
          背後有一台開著 DeST 的電腦。去背 PNG 的建議也只對桌面（角色浮在桌面上）有意義，
          留在桌面版 BasicInfoTab.tsx（owner 2026-08-05 決議）。 */}
      <span className="text-xs font-semibold text-[var(--text)]">主圖</span>
      <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">對話中代表這個角色的圖片。</p>
      <button
        type="button"
        disabled={busy}
        onClick={onPick}
        className="mt-1.5 flex w-full flex-col items-center gap-2 rounded-[18px] border border-dashed border-[var(--border)] bg-[var(--bg)] py-6 disabled:opacity-50"
      >
        {showImage ? (
          <img src={url} alt="" className="max-h-40 object-contain" onError={() => setBroken(true)} />
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-[var(--text-sub)]">
            <MonoIcon name="paw" className="h-5 w-5" />
            點一下選圖
          </span>
        )}
        {showImage && <span className="text-[11px] text-[var(--text-sub)]">點一下換一張</span>}
      </button>
    </div>
  )
}

/**
 * 「顯示設定」區塊（`docs/mobile-character-expression-plan.md` §3.1／§3.3）：
 * 框選臉部顯示範圍（對話記錄與小工具共用）＋ 新增/替換表情圖片。
 */
function DisplaySettingsSection({
  characterId,
  emotions,
  faceCrop,
  busy,
  onPickFaceCrop,
  onClearFaceCrop,
  onPickEmotionSprite
}: {
  characterId: string
  emotions: Record<string, string>
  faceCrop: FaceCropRect | null
  busy: boolean
  onPickFaceCrop: () => void
  onClearFaceCrop: () => void
  onPickEmotionSprite: (emotionKey: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  /*
   * ⚠️ **只算 `emotions`，不要混進 `spriteIds`。** 兩者是不同的 key 命名空間——
   * `emotions` 才是「情緒 key → 圖片路徑」（跟 `EMOTION_OPTIONS` 對得起來）；
   * `spriteIds` 是「圖片路徑 → 自訂 id」（給桌面版 LLM 輸出比對用），
   * 把兩邊的 key 混進同一個 Set 算數量，desktop 角色若同時有 spriteIds
   * 自訂對應就會被重複計入，數字會超過 28（owner 2026-08-23 實機回報
   * 「星離宸／琉緋璃表情圖變成 36／28」正是這個成因）。
   */
  const spriteCount = Object.values(emotions).filter((p) => p?.trim()).length

  return (
    <div className="mb-4 rounded-[18px] border border-[var(--border)] bg-[var(--bg)] p-3">
      <span className="text-xs font-semibold text-[var(--text)]">顯示設定</span>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
        框選臉部範圍後，換表情時會顯示裁切過的臉部特寫；沒框選就顯示原圖，兩者互不影響。
      </p>

      <div className="mt-2 flex items-center gap-3">
        {/* 框選成功後**一定要有預覽**——不然使用者不知道到底設定成功了沒有
            （owner 2026-08-23 實機回報「框選之後沒有預覽圖」）。這裡直接用
            套用過框選的顯示圖（跟聊天泡泡、角色列表看到的是同一張）。 */}
        {faceCrop && <FaceCropPreview characterId={characterId} />}
        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onPickFaceCrop}
            className="flex-1 rounded-full border border-[var(--border)] py-2 text-xs text-[var(--text)] disabled:opacity-50"
          >
            {faceCrop ? '重新框選臉部顯示範圍' : '框選臉部顯示範圍'}
          </button>
          {faceCrop && (
            <button
              type="button"
              disabled={busy}
              onClick={onClearFaceCrop}
              className="rounded-full border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-sub)] disabled:opacity-50"
            >
              清除
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 flex w-full items-center gap-1.5 border-t border-[var(--border)] pt-2 text-xs text-[var(--text-sub)]"
      >
        <span className={expanded ? 'rotate-90 transition-transform' : 'transition-transform'}>▶</span>
        表情圖片（{spriteCount} / {EMOTION_OPTIONS.length}）
      </button>

      {expanded && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {EMOTION_OPTIONS.map((opt) => (
            <EmotionSpriteRow
              key={opt.en}
              characterId={characterId}
              emotionKey={opt.en}
              hasSprite={!!emotions[opt.en]?.trim()}
              busy={busy}
              onPick={() => onPickEmotionSprite(opt.en)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 框選結果的即時預覽（`emotion` 給 `undefined`＝套用框選後的主圖，跟聊天泡泡預設看到的一致）。 */
function FaceCropPreview({ characterId }: { characterId: string }): JSX.Element {
  const url = useCharacterDisplayImage(characterId, undefined)
  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)]">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  )
}

function EmotionSpriteRow({
  characterId,
  emotionKey,
  hasSprite,
  busy,
  onPick
}: {
  characterId: string
  emotionKey: string
  hasSprite: boolean
  busy: boolean
  onPick: () => void
}): JSX.Element {
  const url = useCharacterDisplayImage(characterId, hasSprite ? emotionKey : undefined)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onPick}
      className="flex flex-col items-center gap-1 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-2 disabled:opacity-50"
    >
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[var(--bg)]">
        {hasSprite && url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <MonoIcon name="paw" className="h-1/2 w-1/2 text-[var(--text-sub)]" />
        )}
      </div>
      <span className="line-clamp-1 text-center text-[10px] text-[var(--text)]">{emotionLabel(emotionKey)}</span>
      <span className="text-[10px] text-[var(--text-sub)]">{hasSprite ? '更換' : '新增'}</span>
    </button>
  )
}

function NicknameField({ values, onChange }: { values: string[]; onChange: (next: string[]) => void }): JSX.Element {
  return (
    <ChipField
      label="暱稱"
      hint="這個角色其他的稱呼、綽號或小名。輸入後按 Enter。"
      placeholder="新增暱稱⋯⋯"
      values={values}
      onChange={onChange}
    />
  )
}

/** 標籤輸入（暱稱與新聞關鍵字共用）。 */
function ChipField({
  label,
  hint,
  placeholder,
  values,
  onChange
}: {
  label: string
  hint: string
  placeholder: string
  values: string[]
  onChange: (next: string[]) => void
}): JSX.Element {
  const [text, setText] = useState('')

  const commit = (): void => {
    // 逗號分隔一次加好幾個 —— 桌面版的新聞關鍵字就是這個行為。
    const parts = text.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
    const additions = parts.filter((p) => !values.includes(p))
    if (additions.length) onChange([...values, ...additions])
    setText('')
  }

  return (
    <div className="mb-4">
      <span className="text-xs font-semibold text-[var(--text)]">{label}</span>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-sub)]">{hint}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-2">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--mint)] px-2.5 py-1 text-xs text-[var(--text)]"
          >
            {v}
            <button
              type="button"
              aria-label={`移除 ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="opacity-60"
            >
              <MonoIcon name="close" className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          maxLength={40}
          value={text}
          placeholder={placeholder}
          className="min-w-[110px] flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commit()
            }
          }}
          // 打完沒按 Enter 就去點別的地方是常態，不收的話那顆標籤等於沒加。
          onBlur={commit}
        />
      </div>
    </div>
  )
}
