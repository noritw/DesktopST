import { useEffect } from 'react'
import { useAppStore } from './stores/useAppStore'
import CharacterWindow from './windows/CharacterWindow'
import InputWindow from './windows/InputWindow'
import SettingsWindow from './windows/SettingsWindow'
import LogWindow from './windows/LogWindow'

const w = typeof window !== 'undefined' && window.windowParams
  ? window.windowParams.get('w')
  : new URLSearchParams(window.location.search).get('w')

export default function App() {
  const loadAll = useAppStore(s => s.loadAll)
  const subscribeToEvents = useAppStore(s => s.subscribeToEvents)

  useEffect(() => {
    loadAll()
    const unsub = subscribeToEvents()
    return unsub
  }, [])

  if (w === 'character') {
    const id = window.windowParams?.get('id') ?? new URLSearchParams(window.location.search).get('id')
    return <CharacterWindow characterId={id ?? ''} />
  }
  if (w === 'input') return <InputWindow />
  if (w === 'settings') return <SettingsWindow />
  if (w === 'log') return <LogWindow />

  // Fallback: show nothing (should not happen)
  return null
}
