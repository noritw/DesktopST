import { useEffect, useRef, useState } from 'react'
import { expandRandomTokens, hasRandomTokens } from '@core/prompt/randomTokens'
import MonoIcon from '@shared/MonoIcon'
import { useAppStore } from '../stores/appStore'
import { useComposerStore } from '../stores/composerStore'
import { useUiStore } from '../stores/uiStore'
import { AttachmentStrip } from './AttachmentStrip'
import { ImageCompressError, compressImage } from './imageCompress'
import { PersonaIdentity } from '../context/PersonaIdentity'

/**
 * 輸入框（清單 A2、A5）＋ 圖片附件（B1、B3、B5）。
 *
 * 兩個手機上的細節，少了都會被立刻察覺：
 *
 *   - **自動長高**：固定一行的話打長訊息看不到自己在寫什麼；
 *     但要設上限，否則鍵盤一彈出來畫面就只剩輸入框
 *   - **Enter 一律換行，送出靠按鈕**：owner 2026-08-10 實機回報「打長訊息不知道
 *     怎麼換行」——原本設計假設軟體鍵盤的 Enter 不會觸發 `keydown`，實機上
 *     Gboard 等鍵盤其實會，導致打字打到一半被送出去。`enterKeyHint` 仍設成
 *     enter（純粹是鍵盤上顯示的圖示提示，不影響行為）。外接鍵盤留
 *     Ctrl/Cmd+Enter 當送出捷徑，純 Enter／Shift+Enter 都只換行
 */

const MAX_HEIGHT_PX = 140
const DEFAULT_MAX_IMAGES = 5

export function Composer(): JSX.Element {
  const send = useAppStore((s) => s.send)
  const stop = useAppStore((s) => s.stop)
  const sending = useAppStore((s) => s.sending)
  const restoreDraft = useAppStore((s) => s.restoreDraft)
  const maxImages = useAppStore((s) => s.snapshot?.maxImagesPerMessage ?? DEFAULT_MAX_IMAGES)
  // 清單 C6：設定關閉時整個入口消失，而不是 disabled ——
  // 灰掉的按鈕會讓使用者以為壞了（計畫書 §5 對 API Key 欄位的同一條判斷）。
  const randomToolsEnabled = useAppStore((s) => s.snapshot?.randomToolsEnabled ?? false)
  const toast = useUiStore((s) => s.toast)
  const push = useUiStore((s) => s.push)

  const text = useComposerStore((s) => s.text)
  const caret = useComposerStore((s) => s.caret)
  const setText = useComposerStore((s) => s.setText)
  const setCaret = useComposerStore((s) => s.setCaret)
  const clearDraft = useComposerStore((s) => s.clear)
  const respond = useComposerStore((s) => s.respond)
  const pendingNewsLink = useComposerStore((s) => s.pendingNewsLink)
  const setPendingNewsLink = useComposerStore((s) => s.setPendingNewsLink)

  const [images, setImages] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [newsSheetOpen, setNewsSheetOpen] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const grow = (): void => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  /** 使用者自己打的最後一版。用來分辨「文字是從外面塞進來的」。 */
  const typed = useRef('')

  /**
   * 外部塞進來的文字（隨機工具 token、之後的「聊這個」）要接手兩件事：
   * 把游標移到插入內容之後，並讓輸入框重新算高度。
   *
   * ⚠️ 不 `focus()` —— 手機上叫出軟體鍵盤會把畫面推上去半個螢幕，
   * 而使用者剛從面板回來、通常是想先看看插進去的東西長什麼樣。
   */
  useEffect(() => {
    if (text === typed.current) return
    typed.current = text
    const el = areaRef.current
    if (el && caret != null) el.setSelectionRange(caret, caret)
    grow()
  }, [text, caret])

  /** 停止生成後把草稿還回輸入框（對齊桌面 input:restore-draft）。 */
  useEffect(() => {
    if (!restoreDraft) return
    const next = restoreDraft.content
    typed.current = next
    setText(next, next.length)
    if (restoreDraft.images?.length) setImages(restoreDraft.images)
    useAppStore.setState({ restoreDraft: null })
    requestAnimationFrame(grow)
  }, [restoreDraft, setText])

  /** 選圖（清單 B1）：多選、夾在上限內、逐張壓縮（B2）。 */
  const pickFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const room = maxImages - images.length
    if (room <= 0) {
      toast(`最多只能附 ${maxImages} 張圖片`)
      return
    }
    if (files.length > room) toast(`最多只能附 ${maxImages} 張，只加入前 ${room} 張`)

    setPicking(true)
    try {
      // 一張一張處理：中途有一張壞掉時，其餘照樣加進來，
      // 而不是整批失敗讓使用者重選。
      for (const file of files.slice(0, room)) {
        try {
          const dataUri = await compressImage(file)
          setImages((prev) => [...prev, dataUri])
        } catch (e) {
          toast(`無法讀取圖片：${e instanceof ImageCompressError ? e.fileName : file.name}`, 'error')
        }
      }
    } finally {
      setPicking(false)
    }
  }

  const submit = async (): Promise<void> => {
    const raw = text.trim()
    // 只有圖片、或只掛了新聞標題泡泡，也可以送。
    if ((!raw && images.length === 0 && !pendingNewsLink) || sending) return

    /**
     * 內嵌 token 在**送出的這一刻**才擲（清單 C3）。
     *
     * 展開後的文字才是訊息內容，`randomResults` 另外帶著給徽章與 prompt 用。
     * 展開走 `@core/prompt/randomTokens` —— 措辭與機率表都在那裡，
     * 手機不得自己算一份（`mobile.html` 就是那樣長歪的，見 inventory §4）。
     */
    let content = raw
    let randomResults: ReturnType<typeof expandRandomTokens>['results'] | undefined
    if (hasRandomTokens(raw)) {
      const expanded = expandRandomTokens(raw)
      content = expanded.expandedText
      if (expanded.results.length) randomResults = expanded.results
    }

    const sentImages = images
    const sentNews = pendingNewsLink
    // 先清空再送：送出後畫面立刻回到空白才像即時通訊。
    // 失敗時不把文字放回去 —— 那則訊息會以系統錯誤留在串裡，
    // 內容看得到，使用者要重試可以複製。放回去反而會與錯誤訊息重複。
    clearDraft()
    typed.current = ''
    setImages([])
    setNewsSheetOpen(false)
    requestAnimationFrame(grow)
    try {
      await send({
        content,
        images: sentImages.length ? sentImages : undefined,
        randomResults,
        // 清單 A7：勾選框問的是「要不要回應」，送出去的旗標是它的反面。
        skipLlm: respond ? undefined : true,
        newsLink: sentNews ?? undefined
      })
    } catch {
      toast('訊息送出失敗', 'error')
      // 圖片則相反，一定要放回去（清單 B5）：文字重打只是麻煩，
      // 圖要重新從相簿一張張找回來，而且未必記得選了哪幾張。
      // 只在使用者還沒選新的圖時放回，避免蓋掉他重選的內容。
      if (sentImages.length) setImages((prev) => (prev.length === 0 ? sentImages : prev))
      if (sentNews) setPendingNewsLink(sentNews)
    }
  }

  const canSend = (text.trim().length > 0 || images.length > 0 || !!pendingNewsLink) && !sending

  const onPrimary = (): void => {
    if (sending) void stop()
    else void submit()
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)]">
      <PersonaIdentity />
      {pendingNewsLink && (
        <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 pt-2">
          <button
            type="button"
            onClick={() => setNewsSheetOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--mint)]/50 px-3 py-1.5 text-left active:bg-[var(--mint)]"
          >
            <MonoIcon name="news" className="h-4 w-4 shrink-0 text-[var(--mint2)]" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">
              {pendingNewsLink.title}
            </span>
          </button>
          <button
            type="button"
            aria-label="取消這則新聞"
            onClick={() => {
              setPendingNewsLink(null)
              setNewsSheetOpen(false)
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--bg)]"
          >
            <MonoIcon name="close" className="h-4 w-4" />
          </button>
        </div>
      )}
      {newsSheetOpen && pendingNewsLink && (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/30"
          onClick={() => setNewsSheetOpen(false)}
        >
          {/*
            ⚠️ 底部要留手勢列安全區，不能只靠 `p-4`——Android 手勢列會吃掉畫面下緣，
            「關閉」鈕原本擠在捲動內容最下面按不到（owner 2026-08-16 真機回報，
            跟 `NewsContextSheet.tsx` 那次是同一個坑：見它檔頭的說明）。
            高度也比照那邊改用 `dvh`：`vh` 不含網址列／手勢列的動態高度。
          */}
          <div
            className="max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[var(--text)]">{pendingNewsLink.title}</p>
            <p className="mt-1 text-[12px] text-[var(--text-sub)]">
              角色會看到這段背景；聊天泡泡只顯示標題。
            </p>
            <div className="mt-3 whitespace-pre-wrap rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-relaxed text-[var(--text)]">
              {pendingNewsLink.promptContext || pendingNewsLink.summary || '（沒有摘要）'}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-full border border-[var(--border)] py-2.5 text-sm"
              onClick={() => setNewsSheetOpen(false)}
            >
              關閉
            </button>
          </div>
        </div>
      )}
      <AttachmentStrip
        images={images}
        onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))}
      />

      <div
        className="flex items-end gap-2 px-3 pt-2"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            // 先清值再處理：不清的話「連選同一張圖兩次」不會觸發 change。
            e.target.value = ''
            void pickFiles(files)
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={picking || images.length >= maxImages}
          aria-label="附加圖片"
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] transition-opacity active:bg-[var(--bg)] disabled:opacity-40"
        >
          {/* 選檔中用轉圈的重送圖示代替沙漏 emoji，維持單色風格 */}
          <MonoIcon name={picking ? 'resend' : 'image'} className={picking ? 'h-5 w-5 anim-breathe' : 'h-5 w-5'} />
        </button>

        {randomToolsEnabled && (
          <button
            type="button"
            onClick={() => push('random-tools')}
            aria-label="隨機工具"
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--bg)]"
          >
            <MonoIcon name="dice" className="h-5 w-5" />
          </button>
        )}

        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          placeholder="說點什麼⋯⋯"
          enterKeyHint="enter"
          onChange={(e) => {
            typed.current = e.target.value
            setText(e.target.value, e.target.selectionStart)
            grow()
          }}
          /*
           * 游標位置要跟著使用者跑，插 token 才會插在他停留的地方（見 composerStore）。
           *
           * 三個事件都要接：`select` 涵蓋不到「用點的移動游標」與方向鍵，
           * 而手機上「點一下句子中間再插一顆骰子」正是最常見的用法。
           * 三者重複觸發沒有代價（設同一個值）。
           */
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
              // 純 Enter／Shift+Enter 都是換行；只有外接鍵盤的 Ctrl/Cmd+Enter 送出。
              // isComposing 檢查是注音／拼音選字中，不可攔截。
              e.preventDefault()
              void submit()
            }
          }}
          disabled={sending}
          className="scroll-y max-h-[140px] flex-1 resize-none rounded-[18px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--mint2)] disabled:opacity-70"
        />
        <button
          type="button"
          onClick={onPrimary}
          disabled={!sending && !canSend}
          aria-label={sending ? '停止' : '送出'}
          title={sending ? '停止回應' : '送出訊息'}
          className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)] transition-opacity disabled:opacity-40"
        >
          <MonoIcon name={sending ? 'stop' : 'send'} className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}
