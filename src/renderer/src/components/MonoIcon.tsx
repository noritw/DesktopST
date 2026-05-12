export type MonoIconName =
  | 'close'
  | 'check'
  | 'edit'
  | 'trash'
  | 'prompt'
  | 'log'
  | 'image'
  | 'send'
  | 'save'
  | 'folder'
  | 'settings'
  | 'user'
  | 'import'
  | 'screenshot'
  | 'screenshot-character'
  | 'notes'
  | 'pin'

export default function MonoIcon({ name, className = 'w-4 h-4' }: { name: MonoIconName; className?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {name === 'check' && (
        <path {...common} d="M4 13l5 5L20 7" />
      )}
      {name === 'close' && (
        <>
          <path {...common} d="M6 6l12 12" />
          <path {...common} d="M18 6L6 18" />
        </>
      )}
      {name === 'edit' && (
        <>
          <path {...common} d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path {...common} d="M13.5 7.5l3 3" />
        </>
      )}
      {name === 'trash' && (
        <>
          <path {...common} d="M5 7h14" />
          <path {...common} d="M9 7V5h6v2" />
          <path {...common} d="M8 10v8" />
          <path {...common} d="M12 10v8" />
          <path {...common} d="M16 10v8" />
          <path {...common} d="M7 7l1 14h8l1-14" />
        </>
      )}
      {name === 'prompt' && (
        <>
          <path {...common} d="M8 9l-4 3 4 3" />
          <path {...common} d="M16 9l4 3-4 3" />
          <path {...common} d="M14 5l-4 14" />
        </>
      )}
      {name === 'log' && (
        <>
          <path {...common} d="M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path {...common} d="M8 8h8" />
          <path {...common} d="M8 12h8" />
          <path {...common} d="M8 16h5" />
        </>
      )}
      {name === 'image' && (
        <>
          <rect {...common} x="4" y="5" width="16" height="14" rx="2" />
          <path {...common} d="M8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          <path {...common} d="M20 16l-5-5-4 4-2-2-5 5" />
        </>
      )}
      {name === 'send' && (
        <>
          <path {...common} d="M4 12l16-8-5 16-3-7-8-1Z" />
          <path {...common} d="M12 13l8-9" />
        </>
      )}
      {name === 'save' && (
        <>
          <path {...common} d="M5 4h12l2 2v14H5V4Z" />
          <path {...common} d="M8 4v6h8V4" />
          <path {...common} d="M8 20v-6h8v6" />
        </>
      )}
      {name === 'folder' && (
        <>
          <path {...common} d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
          <path {...common} d="M4 7V6a2 2 0 0 1 2-2h4l2 3" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path {...common} d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <path {...common} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </>
      )}
      {name === 'user' && (
        <>
          <path {...common} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          <path {...common} d="M4 21a8 8 0 0 1 16 0" />
        </>
      )}
      {name === 'import' && (
        <>
          <path {...common} d="M12 3v10" />
          <path {...common} d="M8 9l4 4 4-4" />
          <path {...common} d="M5 17v3h14v-3" />
        </>
      )}
      {name === 'screenshot' && (
        <>
          <path {...common} d="M5 10V5h5" />
          <path {...common} d="M14 5h5v5" />
          <path {...common} d="M5 14v5h5" />
          <path {...common} d="M19 14v5h-5" />
          <circle {...common} cx="12" cy="12" r="2.5" />
        </>
      )}
      {name === 'screenshot-character' && (
        <>
          <path {...common} d="M5 10V5h5" />
          <path {...common} d="M14 5h5v5" />
          <path {...common} d="M5 14v5h5" />
          <path {...common} d="M19 14v5h-5" />
          <circle {...common} cx="12" cy="10.5" r="2" />
          <path {...common} d="M8.5 17c.9-2 2.2-3 3.5-3s2.6 1 3.5 3" />
        </>
      )}
      {name === 'notes' && (
        <>
          <rect {...common} x="8" y="6" width="10" height="12" rx="2" />
          <path {...common} d="M5 9v8a2 2 0 0 0 2 2h8" />
          <path {...common} d="M10 6l1.4-2h3.2L16 6" />
        </>
      )}
      {name === 'pin' && (
        <>
          {/* 圖釘針身 */}
          <line {...common} x1="12" y1="12" x2="6" y2="20" />
          {/* 圖釘頭（圓形） */}
          <circle {...common} cx="15" cy="9" r="4" />
          {/* 限位桿 */}
          <line {...common} x1="12" y1="12" x2="18" y2="6" />
        </>
      )}
    </svg>
  )
}
