import type { Character } from '../types'
import MonoIcon from './MonoIcon'

interface Props {
  character: Character
  isOnDesktop: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export default function CharacterCard({ character, isOnDesktop, onClick, onContextMenu }: Props) {
  const avatarSrc = character.avatar ? `local://${encodeURIComponent(character.avatar)}` : ''

  return (
    <button
      type="button"
      className="flex flex-col items-stretch rounded-2xl border border-border bg-white/90 p-2 shadow-soft transition-transform hover:scale-[1.02] hover:border-teal/40 text-left min-w-[120px] h-[160px]"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="flex justify-center mb-1">
        <div className="w-20 h-20 rounded-2xl overflow-hidden bg-mint flex items-center justify-center shrink-0">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <MonoIcon name="user" className="w-10 h-10 text-primary" />
          )}
        </div>
      </div>
      <span className="text-xs font-semibold text-primary text-center line-clamp-2 px-1">{character.name}</span>
      {isOnDesktop && (
        <span className="mt-auto mx-auto text-[10px] px-2 py-0.5 rounded-full bg-teal/25 text-primary font-medium">
          桌面中
        </span>
      )}
    </button>
  )
}
