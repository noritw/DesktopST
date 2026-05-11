import type { ReactNode } from 'react'

interface Props {
  visible: boolean
  onScale?: () => void
  onButtonsEl?: (el: HTMLDivElement | null) => void
}

export type HoverMenuIconName = 'speak' | 'volume' | 'muted' | 'settings' | 'trash' | 'scale' | 'close'

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
          <path {...common} d="M5 7.5h10a4 4 0 0 1 4 4v.5a4 4 0 0 1-4 4H9l-4 3v-3.5a4 4 0 0 1-2-3.5v-.5a4 4 0 0 1 2-3.5Z" />
          <path {...common} d="M8 11h6" />
          <path {...common} d="M8 14h3" />
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
          <path {...common} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path {...common} d="M12 3v2" />
          <path {...common} d="M12 19v2" />
          <path {...common} d="M4.2 7.5l1.7 1" />
          <path {...common} d="M18.1 15.5l1.7 1" />
          <path {...common} d="M19.8 7.5l-1.7 1" />
          <path {...common} d="M5.9 15.5l-1.7 1" />
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
    </svg>
  )
}

export default function HoverMenu({ visible, onScale, onButtonsEl }: Props) {
  const buttons: Array<{
    icon: ReactNode
    title: string
    onClick: () => void
    pressed?: boolean
    danger?: boolean
    disabled?: boolean
  }> = [
    {
      icon: <HoverMenuIcon name="settings" />,
      title: '設定',
      onClick: () => window.api.invoke('window:open-settings', 'character')
    },
    {
      icon: <HoverMenuIcon name="scale" />,
      title: '縮放角色',
      onClick: () => onScale?.()
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
