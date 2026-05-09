import { useAppStore } from '../stores/useAppStore'

interface Props {
  characterId: string
  visible: boolean
  canRemove: boolean
  isMuted: boolean
  onButtonsEl?: (el: HTMLDivElement | null) => void
}

export default function HoverMenu({ characterId, visible, canRemove, isMuted, onButtonsEl }: Props) {
  const forceSpeak = useAppStore(s => s.forceSpeak)
  const toggleMute = useAppStore(s => s.toggleMute)
  const removeFromDesktop = useAppStore(s => s.removeFromDesktop)
  const addToDesktop = useAppStore(s => s.addToDesktop)
  const characters = useAppStore(s => s.characters)
  const desktopCharacters = useAppStore(s => s.desktopCharacters)

  const availableChars = characters.filter(c => !desktopCharacters.some(d => d.characterId === c.id))

  const buttons = [
    {
      label: '💬',
      title: '強制發話',
      onClick: () => forceSpeak(characterId)
    },
    {
      label: isMuted ? '🔊' : '🔇',
      title: isMuted ? '取消禁言' : '禁言',
      onClick: () => toggleMute(characterId)
    },
    ...(availableChars.length > 0 ? [{
      label: '➕',
      title: `追加角色：${availableChars[0].name}`,
      onClick: () => addToDesktop(availableChars[0].id)
    }] : []),
    {
      label: '⚙️',
      title: '角色設定',
      onClick: () => window.api.invoke('window:open-settings', 'character')
    },
    ...(canRemove ? [{
      label: '❌',
      title: '移除角色',
      onClick: () => removeFromDesktop(characterId)
    }] : [])
  ]

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease' }}
    >
      {/* Buttons anchored to right side of sprite, within the container */}
      <div
        ref={onButtonsEl}
        className="absolute top-2 right-0 translate-x-full flex flex-col gap-2 pointer-events-auto no-drag pl-1"
      >
        {buttons.map((btn, i) => (
          <button
            key={i}
            title={btn.title}
            onClick={btn.onClick}
            className="btn-round text-base"
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  )
}
