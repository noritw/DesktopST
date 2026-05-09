export type MonoIconName =
  | 'close'
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
          <path {...common} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path {...common} d="M12 3v2" />
          <path {...common} d="M12 19v2" />
          <path {...common} d="M4.2 7.5l1.7 1" />
          <path {...common} d="M18.1 15.5l1.7 1" />
          <path {...common} d="M19.8 7.5l-1.7 1" />
          <path {...common} d="M5.9 15.5l-1.7 1" />
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
    </svg>
  )
}
