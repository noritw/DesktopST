interface Props {
  src: string
  name: string
  size?: number
}

export default function CharacterSprite({ src, name, size = 1 }: Props) {
  const w = Math.round(180 * size)
  const h = Math.round(260 * size)

  if (!src) {
    return (
      <div
        className="rounded-full bg-mint flex items-center justify-center text-4xl shadow-soft"
        style={{ width: w, height: h }}
      >
        👤
        <span className="sr-only">{name}</span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      draggable={false}
      style={{ width: w, height: h, objectFit: 'contain' }}
      className="select-none pointer-events-none"
    />
  )
}
