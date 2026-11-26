import type { FoeFormId } from '@core/walk/battle'
import tangle from './art/foe-tangle.svg?raw'
import spike from './art/foe-spike.svg?raw'
import slab from './art/foe-slab.svg?raw'
import fog from './art/foe-fog.svg?raw'
import pile from './art/foe-pile.svg?raw'
import bounce from './art/foe-bounce.svg?raw'

/** 對手的形（Codex 繪製，2026-11-27 owner 定稿；設計稿 `out/design/walk-foes.html`）。 */

const uri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`

export const FOE_ART: Record<FoeFormId, string> = {
  tangle: uri(tangle),
  spike: uri(spike),
  slab: uri(slab),
  fog: uri(fog),
  pile: uri(pile),
  bounce: uri(bounce)
}
