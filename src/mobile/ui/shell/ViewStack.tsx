import { Sheet } from './Sheet'
import { useUiStore } from '../stores/uiStore'
import type { ViewEntry, ViewKind } from '../stores/uiStore'
import { ThemePicker } from './ThemePicker'
import { RandomToolsSheet } from '../chat/RandomToolsSheet'

/**
 * 畫面堆疊的渲染端（清單 G3）。
 *
 * 只有**最上面那層**會被畫出來。手機螢幕小，同時疊兩層 sheet 既看不清也點不準；
 * 下層保留在 state 裡是為了返回時能回到原本的位置，不是為了同時顯示。
 */

const TITLES: Record<ViewKind, string> = {
  conversations: '對話',
  presence: '這次對話有誰在場',
  characters: '角色',
  'character-editor': '編輯角色',
  presets: '情境與設定組',
  settings: '設定',
  news: '個人新聞報',
  'random-tools': '隨機工具',
  'theme-picker': '色彩主題'
}

export function ViewStack(): JSX.Element | null {
  const stack = useUiStore((s) => s.stack)
  const pop = useUiStore((s) => s.pop)

  const top = stack[stack.length - 1]
  if (!top) return null

  return (
    <Sheet key={top.id} title={TITLES[top.kind]} onClose={pop}>
      <ViewBody entry={top} />
    </Sheet>
  )
}

function ViewBody({ entry }: { entry: ViewEntry }): JSX.Element {
  if (entry.kind === 'theme-picker') return <ThemePicker />
  if (entry.kind === 'random-tools') return <RandomToolsSheet />

  // 階段 1 只做骨架；各畫面的內容在階段 2–6 逐一填入。
  // 這裡刻意寫得很明顯，避免看到空白畫面時誤以為是壞掉。
  return (
    <div className="py-10 text-center text-sm text-[var(--text-sub)]">
      <div className="text-3xl">🚧</div>
      <p className="mt-3">「{TITLES[entry.kind]}」尚未實作</p>
      <p className="mt-1 text-xs opacity-70">B3 階段 2–6 逐步填入</p>
    </div>
  )
}
