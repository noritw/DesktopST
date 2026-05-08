import { useAppStore } from '../stores/useAppStore'

interface Props {
  characterId: string
  visible: boolean
  canRemove: boolean
  isMuted: boolean
}

export default function HoverMenu({ characterId, visible, canRemove, isMuted }: Props) {
  const forceSpeak = useAppStore(s => s.forceSpeak)
  const toggleMute = useAppStore(s => s.toggleMute)
  const removeFromDesktop = useAppStore(s => s.removeFromDesktop)

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
      {/* Circular arrangement around character */}
      <div className="absolute top-2 right-0 flex flex-col gap-2 pointer-events-auto no-drag">
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
