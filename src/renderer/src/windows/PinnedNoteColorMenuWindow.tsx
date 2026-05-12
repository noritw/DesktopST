const NOTE_COLORS = [
  { label: '奶油黃', value: '#FFE8AA', swatch: '#FFE8AA' },
  { label: '粉橘', value: '#FFD6B8', swatch: '#FFD6B8' },
  { label: '薄荷綠', value: '#CBFBC4', swatch: '#CBFBC4' },
  { label: '粉藍綠', value: '#B8F4EA', swatch: '#B8F4EA' },
  { label: '天藍', value: '#AAEEFF', swatch: '#AAEEFF' },
  { label: '粉紅', value: '#FFBBBB', swatch: '#FFBBBB' },
  { label: '薰衣草', value: '#F0BBFF', swatch: '#F0BBFF' },
  { label: '純白', value: '#FFFFFF', swatch: '#FFFFFF' },
  { label: '黑底白字', value: '#1F2423', swatch: '#FFFFFF', dark: true },
]

export default function PinnedNoteColorMenuWindow() {
  const params = window.windowParams ?? new URLSearchParams(window.location.search)
  const noteId = params.get('noteId') ?? ''
  const currentColor = (params.get('color') ?? '#FFE8AA').toUpperCase()

  const chooseColor = async (color: string) => {
    await window.api.invoke('pinned-note:update-color', noteId, color)
    window.close()
  }

  return (
    <div className="h-screen w-screen bg-transparent p-1">
      <div className="no-drag h-full overflow-hidden rounded-2xl border border-border bg-white shadow-panel">
        <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
          {NOTE_COLORS.map(c => {
            const selected = currentColor === c.value.toUpperCase()
            const dark = c.dark === true
            return (
              <button
                key={c.value}
                type="button"
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs font-medium transition-colors"
                style={{
                  background: dark ? '#1F2423' : selected ? '#E8FBF4' : '#FFFFFF',
                  color: dark ? '#F7FFFC' : '#3D5A52',
                  border: selected ? '1px solid #AAEEDD' : '1px solid transparent'
                }}
                onClick={() => chooseColor(c.value)}
              >
                <span className="w-4 shrink-0 text-center text-[11px] leading-none">
                  {selected ? '✓' : ''}
                </span>
                <span
                  className="h-4 w-4 shrink-0 rounded-full border"
                  style={{
                    background: c.swatch,
                    borderColor: '#A9DED2'
                  }}
                />
                <span className="truncate">{c.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
