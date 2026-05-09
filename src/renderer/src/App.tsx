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
import ErrorBoundary from './components/ErrorBoundary'

const w = typeof window !== 'undefined' && window.windowParams
  ? window.windowParams.get('w')
  : new URLSearchParams(window.location.search).get('w')

export default function App() {
  const loadAll = useAppStore(s => s.loadAll)
  const subscribeToEvents = useAppStore(s => s.subscribeToEvents)

  useEffect(() => {
    loadAll().catch(e => console.error('[DesktopST] loadAll failed:', e))
    const unsub = subscribeToEvents()
    return unsub
  }, [])

  if (w === 'character') {
    const id = window.windowParams?.get('id') ?? new URLSearchParams(window.location.search).get('id')
    return <ErrorBoundary><CharacterWindow characterId={id ?? ''} /></ErrorBoundary>
  }
  if (w === 'bubble') {
    const id = window.windowParams?.get('id') ?? new URLSearchParams(window.location.search).get('id')
    return <ErrorBoundary><BubbleWindow characterId={id ?? ''} /></ErrorBoundary>
  }
  if (w === 'user-bubble') return <ErrorBoundary><UserBubbleWindow /></ErrorBoundary>
  if (w === 'input') return <ErrorBoundary><InputWindow /></ErrorBoundary>
  if (w === 'settings') return <ErrorBoundary><SettingsWindow /></ErrorBoundary>
  if (w === 'library') return <ErrorBoundary><CharacterLibraryWindow /></ErrorBoundary>
  if (w === 'log') return <ErrorBoundary><LogWindow /></ErrorBoundary>
  if (w === 'preview') return <ErrorBoundary><PreviewWindow /></ErrorBoundary>

  // Fallback: show nothing (should not happen)
  return (
    <div style={{ padding: 16, color: '#9B3535', fontFamily: 'monospace', fontSize: 12 }}>
      Unknown window type: &quot;{w}&quot;
    </div>
  )
}
