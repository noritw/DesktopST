import { useCallback, useEffect, useState } from 'react'
import type { WidgetConfig } from '@core/character/widgetSnapshot'
import { THEMES, THEME_IDS, THEME_LABELS, type ThemeVars } from '@shared/colorThemes'
import {
  normalizeWidgetAppearance,
  resolveWidgetColors,
  widgetColorsToCss,
  type WidgetColors
} from '@shared/widgetAppearance'
import MonoIcon from '@shared/MonoIcon'
import { getData, isAttached, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { useWidgetStore } from '../stores/widgetStore'
import { computeWidgetLines, countPlacedWidgets, type ResolvedWidgetLine } from '../../runtime/widgetBridge'
import { useCharacterDisplayImage } from '../characters/useAvatarUrl'

/**
 * 桌面小工具設定（`docs/mobile-android-widget-plan.md` §11.3）。
 *
 * owner 2026-08-23 實機回報三件事，這一頁就是答案：
 * ①「不知道要怎麼把設定好的訊息改掉」②「不知道為什麼會顯示那一則」
 * ③「希望可預覽小工具會顯示的對話」。
 *
 * ⚠️ **預覽一定要走 `computeWidgetLines()`**，不要在這裡重寫一份挑選規則——
 * 那樣預覽跟小工具實際顯示的內容會慢慢漂移，而使用者只會看到「預覽騙人」。
 */
export function WidgetSettingsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const pop = useUiStore((s) => s.pop)
  const push = useUiStore((s) => s.push)
  const config = useWidgetStore((s) => s.config)
  const unpin = useWidgetStore((s) => s.unpin)
  const setShowAvatar = useWidgetStore((s) => s.setShowAvatar)
  const setAppearance = useWidgetStore((s) => s.setAppearance)
  // 對話換了、有新訊息進來，預覽都要跟著變。
  const messages = useAppStore((s) => s.messages)
  /** 「跟隨 App 配色」時要用哪一組。 */
  const appTheme = useAppStore((s) => s.snapshot?.colorTheme) ?? 'mint'

  const [lines, setLines] = useState<ResolvedWidgetLine[] | null>(null)
  /** 一則版（3x1／4x1）顯示的那一則——不是 `lines[0]`，見 `widgetBridge.ts`。 */
  const [single, setSingle] = useState<ResolvedWidgetLine | null>(null)
  /** 兩則是不同角色 → 各自顯示頭像與名字（§13）。 */
  const [perLineSpeaker, setPerLineSpeaker] = useState(false)
  const [placed, setPlaced] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  /** 拖曳中的透明度（放開才寫檔，見底下 range 的說明）。 */
  const [opacityDraft, setOpacityDraft] = useState(config.appearance.bgOpacity)
  useEffect(() => { setOpacityDraft(config.appearance.bgOpacity) }, [config.appearance.bgOpacity])

  /**
   * 預覽用的色票——跟 Bridge 寫給原生層的是同一支換算，預覽不會騙人。
   *
   * ⚠️ **一定要過 `widgetColorsToCss()`**：`resolveWidgetColors()` 回的是
   * Android 的 `#AARRGGBB`，CSS 的八碼是 `#RRGGBBAA`（alpha 在後面）。
   * 兩種都是合法的十六進位，塞錯不會噴任何錯誤，只會安靜地把 alpha 當成紅色
   * ——owner 2026-08-23 回報「改顏色和透明度沒有正確在預覽顯示」就是這個。
   */
  const previewColors = widgetColorsToCss(
    resolveWidgetColors(normalizeWidgetAppearance({ ...config.appearance, bgOpacity: opacityDraft }), appTheme)
  )

  const applyAppearance = async (patch: Partial<WidgetConfig['appearance']>): Promise<void> => {
    setBusy(true)
    try {
      await setAppearance({ ...config.appearance, ...patch })
    } catch {
      toast('設定失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  const reload = useCallback(async (): Promise<void> => {
    if (!isAttached()) return
    try {
      const r = await computeWidgetLines(getData(), config)
      setLines(r.lines)
      setSingle(r.single)
      setPerLineSpeaker(r.perLineSpeaker)
    } catch {
      setLines([])
    }
  }, [config])

  useEffect(() => { void reload() }, [reload, messages])
  useEffect(() => { void countPlacedWidgets().then(setPlaced) }, [])

  const removePin = async (messageId: string): Promise<void> => {
    setBusy(true)
    try {
      await unpin(messageId)
      toast('已取消釘選')
    } catch {
      toast('取消釘選失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggleAvatar = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      await setShowAvatar(next)
    } catch {
      toast('設定失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  const first = lines?.[0]

  return (
    <div className="space-y-4 pb-2">
      {/* 現在到底有沒有在用——`placed` 是 null 代表這不是原生殼（網頁版沒有小工具）。 */}
      <p className="rounded-[14px] bg-[var(--bg)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-sub)]">
        {placed === null
          ? '桌面小工具只有安裝版（APK）才有。'
          : placed === 0
            ? '主畫面上還沒有放小工具。長按主畫面空白處 →「小工具」→ 找到 DeST 就能加上去。'
            : `主畫面上有 ${placed} 個小工具，顯示的內容如下。`}
      </p>

      {/*
        ── 外觀：預覽 ＋ 所有會改變預覽的控制項 ──

        ⚠️ **配色／透明度／頭像開關一定要跟預覽放在同一段、而且就在預覽底下**
        （owner 2026-08-23：「應該放在預覽旁邊，才不用一直上下來回拉看結果」）。
        分開放的話每調一次顏色都要捲回去看效果，等於預覽白做了。
        「顯示哪幾則」放在這一段後面——那個改的是內容不是外觀，
        而且點進去看訊息會離開這一頁，本來就不是邊看邊調的東西。
      */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-[var(--text)]">外觀</h3>
        {/*
          底色透明度要看得出效果，所以預覽外面墊一層棋盤格（代表桌布）。
          文字顏色也套用小工具的配色，不然選了深色配色卻看到淺色預覽。
        */}
        <div className="rounded-[18px] p-2" style={{ background: CHECKERBOARD, backgroundSize: '16px 16px' }}>
          <div className="rounded-[18px] p-3" style={{ background: previewColors.bg }}>
            {lines === null ? (
              <p className="text-[13px]" style={{ color: previewColors.textSub }}>載入中⋯⋯</p>
            ) : lines.length === 0 ? (
              <p className="text-[13px]" style={{ color: previewColors.textSub }}>還沒有對話</p>
            ) : perLineSpeaker ? (
              // 兩則是不同角色：各自一張頭像與名字（§13）
              lines.map((line, i) => (
                <div key={line.messageId ?? i}>
                  {i > 0 && <div className="my-2 h-px" style={{ background: previewColors.border }} />}
                  <PreviewRow line={line} showAvatar={config.showAvatar} colors={previewColors} />
                </div>
              ))
            ) : (
              // 同一個角色連講兩句：共用一張臉、一個名字
              <div className="flex items-start gap-2.5">
                {config.showAvatar && first?.characterId && (
                  <WidgetAvatarPreview characterId={first.characterId} emotion={first.emotion} colors={previewColors} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px]" style={{ color: previewColors.textSub }}>{first?.name || 'DeST'}</p>
                  {lines.map((line, i) => (
                    <div key={line.messageId ?? i}>
                      {i > 0 && <div className="my-1.5 h-px" style={{ background: previewColors.border }} />}
                      <PreviewText line={line} colors={previewColors} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
          新的發言在下面，跟對話記錄一樣。小工具矮的時候（3x1／4x1）只顯示
          {single?.pinned ? '你釘選的第一則' : '最新那一則'}，拉高之後（3x2／4x2）兩則都會顯示
          {perLineSpeaker ? '，這兩則是不同角色所以各自顯示頭像與名字' : ''}。
        </p>

        {/* 配色：四欄讓 13 個選項只佔四列，跟預覽一起留在同一個畫面裡 */}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {/* 「跟隨 App 配色」放第一個並且是預設：多數人只想讓小工具跟 App 長得一樣，
              而 App 的配色會被情境切換改動，固定成某一組之後就對不起來了。 */}
          <ThemeSwatch
            label="跟隨 App"
            colors={THEMES[appTheme] ?? THEMES.mint}
            active={config.appearance.theme === null}
            disabled={busy}
            onClick={() => void applyAppearance({ theme: null })}
          />
          {THEME_IDS.map((id) => (
            <ThemeSwatch
              key={id}
              label={THEME_LABELS[id] ?? id}
              colors={THEMES[id]}
              active={config.appearance.theme === id}
              disabled={busy}
              onClick={() => void applyAppearance({ theme: id })}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="shrink-0 text-[13px] text-[var(--text)]">底色透明度</span>
          {/*
            拖曳中只更新本地 state（`onChange`），放開才寫檔＋刷小工具（`onPointerUp`／
            `onTouchEnd`）——每動一格就寫一次檔又叫一次原生重繪的話，拖起來會卡，
            而且原生層會被灌一堆重繪。預覽吃的是 `opacityDraft`，所以拖的當下
            上面的預覽就跟著變，不必等放開。
          */}
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={opacityDraft}
            disabled={busy}
            onChange={(e) => setOpacityDraft(Number(e.target.value))}
            onPointerUp={() => void applyAppearance({ bgOpacity: opacityDraft })}
            onTouchEnd={() => void applyAppearance({ bgOpacity: opacityDraft })}
            className="min-w-0 flex-1 accent-[var(--mint2)]"
          />
          <span className="w-9 shrink-0 text-right text-[13px] tabular-nums text-[var(--text-sub)]">{opacityDraft}%</span>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleAvatar(!config.showAvatar)}
          className="mt-2 flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-left disabled:opacity-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-[var(--text)]">顯示角色頭像</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">
              關掉就只剩名字與對白，文字可以放得更多
            </span>
          </span>
          <span
            className={`ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
              config.showAvatar ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]' : 'border-[var(--border)] text-transparent'
            }`}
          >
            <MonoIcon name="check" className="h-3.5 w-3.5" />
          </span>
        </button>

        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
          透明度調到 0% 就只剩文字浮在桌布上（文字顏色不受影響）。頭像用的是該則
          發言者的表情圖；框選臉部顯示範圍請到
          <button type="button" onClick={() => push('characters')} className="mx-0.5 underline">
            角色庫
          </button>
          的角色編輯畫面設定。
        </p>
      </section>

      {/* ── 顯示哪幾則：這一段回答「為什麼會顯示那一則」 ── */}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-[var(--text)]">顯示哪幾則</h3>
        <div className="space-y-2">
          {config.pinnedMessages.map((p, i) => (
            <div key={p.messageId} className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-sub)]">
                <MonoIcon name="pin" className="h-3 w-3" />
                第{i === 0 ? '一' : '二'}則 · 你釘選的
              </div>
              <p className="mt-1 line-clamp-2 text-[13px] text-[var(--text)]">{p.text || '（沒有文字內容）'}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    // 跳去那則訊息，使用者才看得到上下文（跟小工具點對白同一個行為）。
                    useUiStore.getState().setPendingScrollMessageId(p.messageId)
                    pop()
                  }}
                  className="flex-1 rounded-full border border-[var(--border)] py-1.5 text-[12px] text-[var(--text-sub)] disabled:opacity-50"
                >
                  在對話中查看
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removePin(p.messageId)}
                  className="flex-1 rounded-full border border-[var(--border)] py-1.5 text-[12px] text-[var(--text-sub)] disabled:opacity-50"
                >
                  取消釘選
                </button>
              </div>
            </div>
          ))}

          {/* 沒釘滿的那幾格自動顯示最新對話——把這件事明講出來 */}
          {config.pinnedMessages.length < 2 && (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--bg)] p-2.5">
              <p className="text-[11px] text-[var(--text-sub)]">
                {config.pinnedMessages.length === 0 ? '第一、二則' : '第二則'} · 自動顯示目前這個對話最新的發言
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-sub)]">
                想固定顯示某一句的話，到聊天畫面點那則訊息旁邊的「⋯」→「釘選到小工具」。
              </p>
            </div>
          )}
        </div>
      </section>

    </div>
  )
}

/**
 * 透明度預覽的底：用 CSS 漸層畫的棋盤格，代表桌布。
 * 沒有這層的話底色調到 0% 看起來就只是「變成 App 的背景色」，看不出是透明。
 */
const CHECKERBOARD =
  'repeating-conic-gradient(rgba(0,0,0,0.10) 0% 25%, rgba(0,0,0,0.02) 0% 50%)'

/** 一組配色的小色票。直接把顏色畫出來——名字（「腮紅」）看不出實際長相。 */
function ThemeSwatch({ label, colors, active, disabled, onClick }: {
  label: string
  colors: ThemeVars
  active: boolean
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[14px] border-2 p-2 transition-transform active:scale-95 disabled:opacity-50 ${
        active ? 'border-[var(--text-sub)]' : 'border-transparent'
      }`}
      style={{ background: colors.bg }}
    >
      <div className="flex justify-center gap-1">
        {[colors.mint, colors.mint2, colors.userBubble].map((c, i) => (
          <span key={i} className="h-4 w-4 rounded-full" style={{ background: c }} />
        ))}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: colors.text }}>{label}</div>
    </button>
  )
}

/** 一則對白的文字（含釘選圖釘）。 */
function PreviewText({ line, colors }: { line: ResolvedWidgetLine; colors: WidgetColors }): JSX.Element {
  return (
    <p className="flex items-start gap-1 text-[13px] leading-relaxed" style={{ color: colors.text }}>
      {/* MonoIcon 用 `currentColor`，包一層把顏色帶進去（它沒有 style prop）。 */}
      {line.pinned && (
        <span className="mt-0.5 shrink-0" style={{ color: colors.textSub }}>
          <MonoIcon name="pin" className="h-3 w-3" />
        </span>
      )}
      <span className="line-clamp-3 min-w-0">{line.text}</span>
    </p>
  )
}

/** 「不同角色」版面的一列：自己的頭像＋自己的名字＋對白。 */
function PreviewRow({ line, showAvatar, colors }: {
  line: ResolvedWidgetLine
  showAvatar: boolean
  colors: WidgetColors
}): JSX.Element {
  return (
    <div className="flex items-start gap-2.5">
      {showAvatar && line.characterId && (
        <WidgetAvatarPreview characterId={line.characterId} emotion={line.emotion} colors={colors} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px]" style={{ color: colors.textSub }}>{line.name || 'DeST'}</p>
        <PreviewText line={line} colors={colors} />
      </div>
    </div>
  )
}

/**
 * 預覽用的頭像：跟小工具一樣套用框選臉部範圍與表情圖。
 *
 * 底色圓要吃**小工具的配色**（`colors.accentStrong`）而不是 App 的 `--mint2`
 * ——角色圖多半是去背 PNG，那顆圓會透出來，用錯顏色的話預覽就跟實機對不上（§17）。
 */
function WidgetAvatarPreview({ characterId, emotion, colors }: {
  characterId: string
  emotion?: string
  colors: WidgetColors
}): JSX.Element {
  const url = useCharacterDisplayImage(characterId, emotion)
  return (
    <div
      className="h-12 w-12 shrink-0 overflow-hidden rounded-full"
      style={{ background: colors.accentStrong }}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  )
}
