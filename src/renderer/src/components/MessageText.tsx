import type { ReactNode } from 'react'

interface Props {
  text: string
  className?: string
}

const KNOWN_EMOTION_MARKERS = new Set([
  'admiration', 'admire', 'admired',
  'amusement', 'amused',
  'anger', 'angry',
  'annoyance', 'annoyed',
  'approval', 'approving',
  'caring',
  'confusion', 'confused',
  'curiosity', 'curious',
  'desire',
  'disappointment', 'disappointed',
  'disapproval', 'disapproving',
  'disgust', 'disgusted',
  'embarrassment', 'embarrassed',
  'excitement', 'excited',
  'fear', 'fearful', 'afraid',
  'gratitude', 'grateful',
  'grief', 'grieving',
  'joy', 'joyful',
  'love', 'loving',
  'nervousness', 'nervous',
  'optimism', 'optimistic',
  'pride', 'proud',
  'realization', 'realized',
  'relief', 'relieved',
  'remorse', 'remorseful',
  'sadness', 'sad',
  'surprise', 'surprised',
  'neutral', 'calm', 'normal'
])

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Combined regex: **bold** or ｛random result｝
  const re = /\*\*([^*]+)\*\*|｛([^｝]+)｝/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[1] != null) {
      // **bold**
      nodes.push(<strong key={`b-${match.index}`}>{match[1]}</strong>)
    } else if (match[2] != null) {
      // ｛random result｝ — inline badge using theme-aware CSS variables
      nodes.push(
        <span
          key={`r-${match.index}`}
          className="inline-flex items-center rounded px-1 py-0.5 text-[0.85em] italic leading-tight bg-surface border border-border text-secondary"
        >
          {match[2]}
        </span>
      )
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function stripLeadingEmotionMarker(text: string): string {
  let out = String(text ?? '').trimStart()

  for (let i = 0; i < 3; i++) {
    const before = out
    out = out.replace(/^\[\s*(?:(?:emotion|mood|feeling|情緒)\s*[:=：]\s*)?([a-z_]+)\s*\]\s*/i, (all, raw: string) => (
      KNOWN_EMOTION_MARKERS.has(raw.toLowerCase()) ? '' : all
    ))
    out = out.replace(/^(?:emotion|mood|feeling|情緒)\s*[:=：]\s*([a-z_]+)\s*(?:\r?\n|$)/i, (all, raw: string) => (
      KNOWN_EMOTION_MARKERS.has(raw.toLowerCase()) ? '' : all
    ))
    out = out.replace(/^([a-z_]+)(?=$|[\s:：,，.。!！?？;；\-]|[\u3400-\u9fff])/i, (all, raw: string) => (
      KNOWN_EMOTION_MARKERS.has(raw.toLowerCase()) ? all.slice(raw.length).replace(/^\s*[:=：,，.。!！?？;；\-]?\s*/, '') : all
    ))
    out = out.trimStart()
    if (out === before) break
  }

  return out
}

function unwrapDialogueQuotes(line: string): string {
  let out = line.trim()
  const quotePairs: Array<[string, string]> = [
    ['「', '」'],
    ['『', '』'],
    ['“', '”'],
    ['"', '"'],
    ["'", "'"]
  ]

  while (out.length > 1) {
    const pair = quotePairs.find(([open, close]) => out.startsWith(open) && out.endsWith(close))
    if (!pair) break
    out = out.slice(pair[0].length, out.length - pair[1].length).trim()
  }

  return out
}

function normalizeVisibleText(text: string): string {
  const normalized = stripLeadingEmotionMarker(text)
    .replace(/\\n/g, '\n')
    .replace(/[」』”"]\s*[「『“"]/g, '\n')

  return normalized
    .split(/\r?\n/)
    .map(unwrapDialogueQuotes)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
