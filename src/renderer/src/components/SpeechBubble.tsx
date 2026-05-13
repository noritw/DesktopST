import { useEffect, useState } from 'react'

interface Props {
  text: string
  visible: boolean
}

export default function SpeechBubble({ text, visible }: Props) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (visible && text) {
      setShown(true)
    } else {
      setShown(false)
    }
  }, [visible, text])

  if (!shown || !text) return null

  return (
    <div
      className="relative animate-bubble-in max-w-[220px] max-h-[180px] overflow-y-auto
                 whitespace-pre-wrap break-words
                 rounded-2xl rounded-bl-sm
                 bg-surface-90 border border-border shadow-panel
                 px-3 py-2 text-sm text-primary leading-snug
                 pointer-events-none select-none"
    >
      {text}
      {/* Tail */}
      <div
        className="absolute -bottom-2 left-4 w-3 h-3 overflow-hidden"
        style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.05))' }}
      >
        <div className="w-3 h-3 bg-surface border-b border-r border-border rotate-45 -translate-y-1.5" />
      </div>
    </div>
  )
}
