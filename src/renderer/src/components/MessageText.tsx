import type { ReactNode } from 'react'

interface Props {
  text: string
  className?: string
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    nodes.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function stripLeadingEmotionTag(text: string): string {
  return String(text ?? '').replace(/^\s*\[[a-z_]+\]\s*/i, '')
}

function normalizeVisibleText(text: string): string {
  return stripLeadingEmotionTag(text).replace(/\\n/g, '\n')
}

export default function MessageText({ text, className }: Props) {
  const lines = normalizeVisibleText(text).split(/\r?\n/)
  const blocks: ReactNode[] = []
  let listItems: ReactNode[][] = []

  const flushList = () => {
    if (listItems.length === 0) return
    const items = listItems
    listItems = []
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-1 list-disc pl-5 space-y-0.5">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    )
  }

  lines.forEach((line, index) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      listItems.push(renderInline(bullet[1]))
      return
    }

    flushList()
    if (line.trim().length === 0) {
      blocks.push(<div key={`blank-${index}`} className="h-2" />)
    } else {
      blocks.push(<div key={`line-${index}`}>{renderInline(line)}</div>)
    }
  })

  flushList()

  return <div className={className}>{blocks}</div>
}
