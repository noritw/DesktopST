import type { ReactNode } from 'react'

interface Props {
  visible: boolean
  onSettings?: () => void
  onScale?: () => void
  onButtonsEl?: (el: HTMLDivElement | null) => void
}

export type HoverMenuIconName = 'speak' | 'volume' | 'muted' | 'settings' | 'trash' | 'scale' | 'close' | 'person'

export function HoverMenuIcon({ name }: { name: HoverMenuIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5">
      {name === 'speak' && (
        <>
          <path {...common} d="M4 5h13a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7l-3 3v-3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" />
          <path {...common} d="M6 9h9" />
          <path {...common} d="M6 12h5" />
        </>
      )}
      {name === 'volume' && (
        <>
          <path {...common} d="M4 10v4h4l5 4V6l-5 4H4Z" />
          <path {...common} d="M16 9a4 4 0 0 1 0 6" />
          <path {...common} d="M18.5 6.5a8 8 0 0 1 0 11" />
        </>
      )}
      {name === 'muted' && (
        <>
          <path {...common} d="M4 10v4h4l5 4V6l-5 4H4Z" />
          <path {...common} d="M19 9l-5 6" />
          <path {...common} d="M14 9l5 6" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path {...common} d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <path {...common} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </>
      )}
      {name === 'scale' && (
        <>
          <path {...common} d="M8 4H4v4" />
          <path {...common} d="M4 4l6 6" />
          <path {...common} d="M16 20h4v-4" />
          <path {...common} d="M20 20l-6-6" />
          <path {...common} d="M16 4h4v4" />
          <path {...common} d="M20 4l-6 6" />
          <path {...common} d="M8 20H4v-4" />
          <path {...common} d="M4 20l6-6" />
        </>
      )}
      {name === 'trash' && (
        <>
          <path {...common} d="M3 6h18" />
          <path {...common} d="M8 6V4h8v2" />
          <path {...common} d="M19 6l-1 14H6L5 6" />
          <path {...common} d="M10 11v4" />
          <path {...common} d="M14 11v4" />
        </>
      )}
      {name === 'close' && (
        <>
          <path {...common} d="M6 6l12 12" />
          <path {...common} d="M18 6L6 18" />
        </>
      )}
      {name === 'person' && (
        <>
          <path {...common} d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle {...common} cx="12" cy="7" r="4" />
        </>
      )}
    </svg>
  )
}

export default function HoverMenu({ visible, onSettings, onScale, onButtonsEl }: Props) {
  const buttons: Array<{
    icon: ReactNode
    title: string
    onClick: () => void
    pressed?: boolean
    danger?: boolean
    disabled?: boolean
  }> = [
    {
      icon: <HoverMenuIcon name="person" />,
      title: '角色設定',
      onClick: () => (onSettings ? onSettings() : window.api.invoke('character-library:open'))
    },
    {
      icon: <HoverMenuIcon name="scale" />,
      title: '縮放角色',
      onClick: () => onScale?.()
    },
    {
      icon: <HoverMenuIcon name="settings" />,
      title: '共通設定',
      onClick: () => window.api.invoke('window:open-settings')
    }
  ]

  return (
    <div
      ref={onButtonsEl}
      className="flex flex-col gap-2 no-drag pt-2 pl-1"
      style={{
        opacity: visible ? 1 : 0,
        width: visible ? undefined : 0,
        overflow: 'hidden',
        transition: 'opacity 0.2s ease',
        pointerEvents: visible ? 'auto' : 'none'
      }}
    >
      {buttons.map((btn, i) => (
        <button
          key={i}
          type="button"
          title={btn.title}
          aria-label={btn.title}
          aria-pressed={btn.pressed}
          disabled={btn.disabled}
          onClick={btn.onClick}
          className={`btn-round ${btn.danger ? 'btn-danger' : 'text-primary'} ${btn.pressed ? 'opacity-85 ring-1 ring-[#FFB59F]' : ''} ${btn.disabled ? 'opacity-45 cursor-not-allowed pointer-events-none' : ''}`}
        >
          {btn.icon}
        </button>
      ))}
    </div>
  )
}
