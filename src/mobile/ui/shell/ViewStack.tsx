import { Sheet } from './Sheet'
import { useUiStore } from '../stores/uiStore'
import type { ViewEntry, ViewKind } from '../stores/uiStore'
import { ThemePicker } from './ThemePicker'
import { RandomToolsSheet } from '../chat/RandomToolsSheet'
import { MessageMenu } from '../chat/MessageMenu'
import { MessageAvatarPanel } from '../chat/MessageAvatarPanel'
import { MessagePromptView } from '../chat/MessagePromptView'
import { MessageEmotionPicker } from '../chat/MessageEmotionPicker'
import { CharacterMenu } from '../characters/CharacterMenu'
import { PresenceSheet } from '../characters/PresenceSheet'
import { CharacterLibrary } from '../characters/CharacterLibrary'
import { CharacterEditor } from '../characters/CharacterEditor'
import { SettingsView } from '../settings/SettingsView'
import { RemindersView } from '../settings/RemindersView'
import { ReminderEditor } from '../settings/ReminderEditor'
import { ReminderHistoryView } from '../settings/ReminderHistoryView'
import { PresetsView } from '../presets/PresetsView'
import { PresetEditor } from '../presets/PresetEditor'
import { ConversationsView } from '../conversations/ConversationsView'
import { ConversationEditor } from '../conversations/ConversationEditor'
import { LorebookEditor } from '../lorebooks/LorebookEditor'
import { NewsView } from '../news/NewsView'
import { NewsSettingsView } from '../news/NewsSettingsView'
import { RemoteControlView } from '../remote/RemoteControlView'
import { MainMenu } from './MainMenu'
import { AboutView } from './AboutView'
import { SyncImportView } from '../sync/SyncImportView'

/**
 * 畫面堆疊的渲染端（清單 G3）。
 *
 * 只有**最上面那層**會被畫出來。手機螢幕小，同時疊兩層 sheet 既看不清也點不準；
 * 下層保留在 state 裡是為了返回時能回到原本的位置，不是為了同時顯示。
 */

const TITLES: Record<ViewKind, string> = {
  conversations: '對話',
  'conversation-editor': '編輯對話',
  presence: '這次對話有誰在場',
  'character-menu': '角色',
  'message-avatar-panel': '角色',
  'message-menu': '訊息',
  'message-prompt': '完整 Prompt',
  'message-emotion': '換表情',
  characters: '角色庫',
  'character-editor': '編輯角色',
  presets: '情境與設定組',
  'preset-editor': '編輯預設組',
  settings: '設定',
  reminders: '提醒',
  'reminder-editor': '編輯提醒',
  'reminder-history': '提醒紀錄',
  news: '個人新聞報',
  'news-settings': '新聞設定',
  'random-tools': '隨機工具',
  'theme-picker': '色彩主題',
  'lorebook-editor': '編輯用語解說',
  'sync-import': '從電腦匯入',
  remote: '遙控電腦',
  menu: '選單',
  about: '關於'
}

export function ViewStack(): JSX.Element | null {
  const stack = useUiStore((s) => s.stack)
  // ⚠️ 用 `requestPop` 不是 `pop`：有些畫面要先問過才准關（例如角色卡編輯器
  // 有未儲存的改動）。直接 pop 會讓 ✕ 與返回手勢的行為不一致。
  const requestPop = useUiStore((s) => s.requestPop)

  const top = stack[stack.length - 1]
  if (!top) return null

  return (
    <Sheet
      key={top.id}
      title={TITLES[top.kind]}
      onClose={requestPop}
      // 新聞報自己有分頁列、內容區與底部的「換一批」三段式版面，
      // 捲動要發生在中間那段；交給 Sheet 統一捲會讓底部按鈕跟著跑掉。
      // 遙控畫面同理：截圖區要固定高度接手勢，交給 Sheet 統一捲會讓觸控被捲動搶走。
      scrollable={top.kind !== 'news' && top.kind !== 'remote'}
    >
      <ViewBody entry={top} />
    </Sheet>
  )
}

function ViewBody({ entry }: { entry: ViewEntry }): JSX.Element {
  if (entry.kind === 'conversations') return <ConversationsView />
  if (entry.kind === 'conversation-editor' && entry.param) return <ConversationEditor conversationId={entry.param} />
  if (entry.kind === 'theme-picker') return <ThemePicker />
  if (entry.kind === 'random-tools') return <RandomToolsSheet />
  if (entry.kind === 'presence') return <PresenceSheet />
  if (entry.kind === 'characters') return <CharacterLibrary />
  if (entry.kind === 'character-editor' && entry.param) return <CharacterEditor characterId={entry.param} />
  if (entry.kind === 'settings') return <SettingsView />
  if (entry.kind === 'about') return <AboutView />
  if (entry.kind === 'menu') return <MainMenu />
  // param 選填：header 的狀態標籤點「情境」就帶 'scene' 進來直接展開那一組。
  if (entry.kind === 'presets') return <PresetsView id={entry.id} openParam={entry.param} />
  if (entry.kind === 'preset-editor' && entry.param) return <PresetEditor presetKey={entry.param} />
  if (entry.kind === 'reminders') return <RemindersView />
  if (entry.kind === 'reminder-editor' && entry.param) return <ReminderEditor reminderId={entry.param} />
  if (entry.kind === 'reminder-history') return <ReminderHistoryView />
  if (entry.kind === 'lorebook-editor' && entry.param) return <LorebookEditor bookId={entry.param} />
  if (entry.kind === 'news') return <NewsView />
  if (entry.kind === 'news-settings') return <NewsSettingsView />
  if (entry.kind === 'sync-import') return <SyncImportView />
  if (entry.kind === 'remote') return <RemoteControlView />
  // param 是必要的：沒有它不知道在講哪個角色／哪則訊息。
  // 缺了就當成程式錯誤讓它顯示「尚未實作」，不要靜靜地畫一個空選單。
  if (entry.kind === 'character-menu' && entry.param) return <CharacterMenu characterId={entry.param} />
  if (entry.kind === 'message-avatar-panel' && entry.param) return <MessageAvatarPanel messageId={entry.param} />
  if (entry.kind === 'message-menu' && entry.param) return <MessageMenu messageId={entry.param} />
  if (entry.kind === 'message-prompt' && entry.param) return <MessagePromptView messageId={entry.param} />
  if (entry.kind === 'message-emotion' && entry.param) return <MessageEmotionPicker messageId={entry.param} />

  // 走到這裡就是 param 缺了（例如點角色選單卻沒帶角色 id）。
  // 刻意寫得很明顯，避免看到空白畫面時誤以為是壞掉。
  return (
    <div className="py-10 text-center text-sm text-[var(--text-sub)]">
      <p>「{TITLES[entry.kind]}」開不起來（缺少參數）</p>
    </div>
  )
}
