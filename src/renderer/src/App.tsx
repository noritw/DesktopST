import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'
import CharacterWindow from './windows/CharacterWindow'
import InputWindow from './windows/InputWindow'
import SettingsWindow from './windows/SettingsWindow'
import CharacterLibraryWindow from './windows/CharacterLibraryWindow'
import LogWindow from './windows/LogWindow'
import BubbleWindow from './windows/BubbleWindow'
import PreviewWindow from './windows/PreviewWindow'
import UserBubbleWindow from './windows/UserBubbleWindow'
import PinnedNoteWindow from './windows/PinnedNoteWindow'
import PinnedNoteColorMenuWindow from './windows/PinnedNoteColorMenuWindow'
import PinnedNotesManagerWindow from './windows/PinnedNotesManagerWindow'
import EmojiPickerWindow from './windows/EmojiPickerWindow'
import ErrorBoundary from './components/ErrorBoundary'

const w = typeof window !== 'undefined' && window.windowParams
  ? window.windowParams.get('w')
  : new URLSearchParams(window.location.search).get('w')

const FONT_SIZE_MAP: Record<string, string> = {
  xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '18px'
}

export default function App() {
  const loadAll = useAppStore(s => s.loadAll)
  const subscribeToEvents = useAppStore(s => s.subscribeToEvents)
  const chatFontSize = useAppStore(s => s.settings?.ui.chatFontSize ?? 'md')
  const colorTheme = useAppStore(s => s.settings?.ui.colorTheme ?? 'mint')

  useEffect(() => {
    loadAll().catch(e => console.error('[DesktopST] loadAll failed:', e))
    const unsub = subscribeToEvents()
    return unsub
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', chatFontSize)
    document.documentElement.style.fontSize = FONT_SIZE_MAP[chatFontSize] ?? '14px'
  }, [chatFontSize])

  useEffect(() => {
    localStorage.setItem('desktopst.colorTheme', colorTheme)
    if (colorTheme === 'mint') {
      document.documentElement.removeAttribute('data-color-theme')
    } else {
      document.documentElement.setAttribute('data-color-theme', colorTheme)
    }
  }, [colorTheme])

  if (w === 'character') {
    const id = window.windowParams?.get('id') ?? new URLSearchParams(window.location.search).get('id')
    return <ErrorBoundary><CharacterWindow characterId={id ?? ''} /></ErrorBoundary>
  }
  if (w === 'bubble') {
    const id = window.windowParams?.get('id') ?? new URLSearchParams(window.location.search).get('id')
    return <ErrorBoundary><BubbleWindow characterId={id ?? ''} /></ErrorBoundary>
  }
  if (w === 'pinned-note') return <ErrorBoundary><PinnedNoteWindow /></ErrorBoundary>
  if (w === 'pinned-note-color-menu') return <ErrorBoundary><PinnedNoteColorMenuWindow /></ErrorBoundary>
  if (w === 'pinned-notes-manager') return <ErrorBoundary><PinnedNotesManagerWindow /></ErrorBoundary>
  if (w === 'user-bubble') return <ErrorBoundary><UserBubbleWindow /></ErrorBoundary>
  if (w === 'input') return <ErrorBoundary><InputWindow /></ErrorBoundary>
  if (w === 'settings') return <ErrorBoundary><SettingsWindow /></ErrorBoundary>
  if (w === 'library') return <ErrorBoundary><CharacterLibraryWindow /></ErrorBoundary>
  if (w === 'log') return <ErrorBoundary><LogWindow /></ErrorBoundary>
  if (w === 'preview') return <ErrorBoundary><PreviewWindow /></ErrorBoundary>
  if (w === 'emoji-picker') return <ErrorBoundary><EmojiPickerWindow /></ErrorBoundary>

  // Fallback: show nothing (should not happen)
  return (
    <div style={{ padding: 16, color: '#9B3535', fontFamily: 'monospace', fontSize: 12 }}>
      Unknown window type: &quot;{w}&quot;
    </div>
  )
}
