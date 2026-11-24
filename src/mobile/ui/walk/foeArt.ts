import type { FoeFormId } from '@core/walk/battle'

/** 對手的形。**佔位圖**：等 Codex 畫好六張後換成 `./art/foe-*.svg?raw`。 */

const INK = '#3D5A52'
const eyes = (y: number): string =>
  `<circle cx="46" cy="${y}" r="5" fill="${INK}"/><circle cx="74" cy="${y}" r="5" fill="${INK}"/><path d="M54 ${y + 13}q6 5 12 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`

const BODY: Record<FoeFormId, string> = {
  tangle: `<circle cx="60" cy="62" r="40" fill="#F6C9D4"/><g fill="none" stroke="#C98A9C" stroke-width="5" stroke-linecap="round"><path d="M24 48q36-30 72 4"/><path d="M24 78q36 30 72-6"/><path d="M96 74q14 8 14 26"/></g>${eyes(62)}`,
  spike: `<path d="M60 12l11 16 18-9 1 20 20 3-10 17 12 15-19 7 1 20-20-5-14 15-14-15-20 5 1-20-19-7 12-15-10-17 20-3 1-20 18 9z" fill="#FFD9A8" stroke="#D9A566" stroke-width="5" stroke-linejoin="round"/>${eyes(60)}`,
  slab: `<rect x="10" y="44" width="100" height="56" rx="24" fill="#C9CFC8"/><path d="M26 56q8-6 18-4M84 90q10-1 14-8" fill="none" stroke="#97A199" stroke-width="5" stroke-linecap="round"/>${eyes(70)}`,
  fog: `<path d="M28 92a20 20 0 0 1-2-40 34 34 0 0 1 64-6 24 24 0 0 1 4 46z" fill="#D3DDF2"/><path d="M28 106h26M68 106h26" stroke="#D3DDF2" stroke-width="7" stroke-linecap="round"/>${eyes(64)}`,
  pile: `<rect x="22" y="84" width="76" height="22" rx="9" fill="#BFE3D0"/><rect x="30" y="60" width="72" height="24" rx="9" fill="#FFF0B8"/><rect x="20" y="36" width="70" height="24" rx="9" fill="#F6C9D4"/><rect x="36" y="14" width="62" height="22" rx="9" fill="#CFE4F7"/>${eyes(62)}`,
  bounce: `<circle cx="60" cy="50" r="36" fill="#BFE0F5"/><path d="M34 30q10-12 24-12" fill="none" stroke="#FFFDF4" stroke-width="6" stroke-linecap="round"/><path d="M42 100h36M50 112h20" stroke="#97B9CF" stroke-width="5" stroke-linecap="round"/>${eyes(48)}`
}

const svg = (body: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`)}`

export const FOE_ART = Object.fromEntries(Object.entries(BODY).map(([id, body]) => [id, svg(body)])) as Record<FoeFormId, string>
