import { THEMES, THEME_IDS } from '../theme'
import { useUiStore } from '../stores/uiStore'
import { getData } from '../stores/appStore'

/** 主題名稱是 UI 文案，所以留在這裡不進 core（roadmap §3.3）。 */
const THEME_LABELS: Record<string, string> = {
  mint: '薄荷',
  butter: '奶油',
  peach: '蜜桃',
  aqua: '水藍',
  sky: '天空',
  blush: '腮紅',
  lavender: '薰衣草',
  white: '純白',
  dark: '暗色'
}

export function ThemePicker(): JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const toast = useUiStore((s) => s.toast)

  /**
   * 主題存在**電腦端的設定**裡（`settings.ui.colorTheme`），不是手機的本機偏好。
   *
   * 先在本機套用給即時回饋，再寫回去。失敗就退回原本那個 ——
   * 留著看起來成功、重新整理卻跳掉，比當場說失敗更難理解
   * （owner 2026-08-04 遇到的正是那種狀態）。
   */
  const pick = async (id: (typeof THEME_IDS)[number]): Promise<void> => {
    const previous = theme
    setTheme(id)
    try {
      await getData().settings.setColorTheme(id)
    } catch {
      setTheme(previous)
      toast('主題沒能存到電腦端', 'error')
    }
  }

  return (
    <div className="grid grid-cols-3 gap-3 pb-2">
      {THEME_IDS.map((id) => {
        const t = THEMES[id]
        const active = id === theme
        return (
          <button
            key={id}
            type="button"
            onClick={() => void pick(id)}
            aria-pressed={active}
            className={`rounded-[16px] border-2 p-2 transition-transform active:scale-95 ${
              active ? 'border-[var(--text-sub)]' : 'border-transparent'
            }`}
            style={{ background: t.bg }}
          >
            {/* 直接把該主題的三個主色畫出來——名字（「腮紅」）看不出實際長相 */}
            <div className="flex justify-center gap-1">
              {[t.mint, t.mint2, t.userBubble].map((c, i) => (
                <span key={i} className="h-5 w-5 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <div className="mt-1.5 text-xs" style={{ color: t.text }}>
              {THEME_LABELS[id] ?? id}
            </div>
          </button>
        )
      })}
    </div>
  )
}
