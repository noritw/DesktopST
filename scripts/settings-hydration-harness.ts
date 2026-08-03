/**
 * 設定載入全等比對（B2.7）。
 *
 * 目的與 `prompt-equivalence-harness.ts` 相同，只是對象換成 `fileStore.loadSettings`：
 * 拿一組固定的 settings.json 樣本，在**重構前後**各跑一次，比對產出的設定物件是否逐字相同。
 * 涵蓋舊欄位遷移、DEFAULT_SETTINGS 深層合併、模型 id 改名、API Key 加解密與明文舊金鑰
 * migration、便利貼從舊欄位搬出、onboarding 旗標判定。
 *
 * **不需要 API Key、不連網、不碰使用者真實資料**——樣本全是人造的（owner 2026-08-03 決定）。
 *
 * ## 怎麼跑
 *
 *   npx esbuild scripts/settings-hydration-harness.ts --bundle --platform=node --format=cjs \
 *     --alias:electron=./scripts/_fakeElectron.ts --outfile=.sh.cjs && node .sh.cjs > .sh.json
 *
 * 再與 `scripts/__golden__/settings-hydration.json` 比對。
 *
 * ## 三個必要的細節
 *
 * 1. **`electron` 必須換成假的**（`--alias`）。`fileStore` 在模組載入當下就呼叫
 *    `app.getPath('userData')`，真的 electron 在純 Node 下跑不起來。
 * 2. **加密必須可決定性**。真 DPAPI 對同一明文每次產生不同密文，逐字比對會永遠紅字。
 *    `_fakeElectron.ts` 的 safeStorage 用固定 XOR，加得回也解得開。
 * 3. **時間必須凍結**。preset 的 createdAt/updatedAt 與 uuid 都會進輸出，
 *    不凍結兩次執行必然不同。下方同時凍結 `Date.now` 與 `crypto.randomUUID`。
 *
 * ⚠️ harness 只 import `src/main/fileStore` 的 `loadSettings`，因為重構前後這個簽名相同，
 * 同一份 harness 才能在兩個版本上跑。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'

// ── 1. 凍結時間與 id（必須在 import fileStore 之前）──────────────────

const FROZEN_NOW = 1754179200000 // 2025-08-03T00:00:00Z，固定值
Date.now = () => FROZEN_NOW

/**
 * uuid 沒辦法可靠地在 bundle 後蓋掉（`uuid` 走 `crypto.randomUUID`，
 * esbuild 打包後那個 binding 不可寫）。改成在輸出階段正規化：
 * 把 uuid 形狀的字串依「第一次出現的順序」換成 `uuid#1`、`uuid#2`…
 * 對比對而言效果相同，且不依賴 uuid 套件的內部實作。
 */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
function normalizeUuids(json: string): string {
  const seen = new Map<string, string>()
  return json.replace(UUID_RE, (m) => {
    const key = m.toLowerCase()
    if (!seen.has(key)) seen.set(key, `uuid#${seen.size + 1}`)
    return seen.get(key)!
  })
}

// ── 2. 人造樣本 ──────────────────────────────────────────────────

/** `enc:v1:` ＋ 假加密（必須與 `_fakeElectron.ts` 的 safeStorage 對稱）。 */
function fakeEnc(plain: string): string {
  const body = Buffer.from(Buffer.from(plain, 'utf-8').map(b => b ^ 0x5a))
  return 'enc:v1:' + Buffer.concat([Buffer.from('DESTFAKE', 'utf-8'), body]).toString('base64')
}

interface Sample {
  name: string
  settings: unknown
  /** 另外寫進資料夾的 pinned-notes.json（省略代表不存在） */
  pinnedNotes?: unknown
}

const SAMPLES: Sample[] = [
  {
    name: '01-空檔案',
    settings: {}
  },
  {
    name: '02-舊版 persona 與 worldSetting 欄位（要遷移成 preset）',
    settings: {
      persona: { displayName: '小明', nickname: '明明', description: '喜歡貓' },
      worldSetting: '現代都市',
      interactionExample: 'A: 你好\nB: 嗨',
      llm: { provider: 'openai' }
    }
  },
  {
    name: '03-舊 persona 但世界觀是空白（不該產生 world preset）',
    settings: {
      persona: { displayName: '小華', nickname: '華華', description: '' },
      worldSetting: '   ',
      interactionExample: ''
    }
  },
  {
    name: '04-舊 persona 缺欄位（走 fallback 名稱）',
    settings: { persona: { displayName: undefined, nickname: undefined, description: undefined } }
  },
  {
    name: '05-已有 activePersonaId 時不該被遷移值蓋掉',
    settings: {
      activePersonaId: 'existing-persona',
      activeWorldId: 'existing-world',
      persona: { displayName: 'X', nickname: 'Y', description: 'Z' },
      worldSetting: '有內容'
    }
  },
  {
    name: '06-已下架／改名的模型 id（應自動換新）',
    settings: {
      llm: {
        model: 'o1-mini',
        models: { openai: 'o1-mini', grok: 'grok-4-1-fast-reasoning', claude: 'claude-opus-4' },
        utilityModels: { openai: 'o1-mini', grok: 'grok-4.20-reasoning' }
      }
    }
  },
  {
    name: '07-明文舊金鑰（應解出明文並標記需要回寫）',
    settings: {
      llm: { apiKeys: { openai: 'sk-plaintext-legacy', claude: '', gemini: '', grok: '' } }
    }
  },
  {
    name: '08-已加密金鑰（應解密成明文）',
    settings: {
      llm: { apiKeys: { openai: fakeEnc('sk-encrypted-ok'), claude: fakeEnc('sk-ant-xyz'), gemini: '', grok: '' } }
    }
  },
  {
    name: '09-解密失敗的金鑰（應清成空字串、不可留密文）',
    settings: {
      llm: { apiKeys: { openai: 'enc:v1:!!!not-valid-base64-at-all!!!', claude: '', gemini: '', grok: '' } }
    }
  },
  {
    name: '10-更舊的單一 apiKey 欄位（應種進 openai）',
    settings: { llm: { apiKey: 'sk-very-old-single-key' } }
  },
  {
    name: '11-便利貼還在 ui.pinnedNotes 舊欄位裡（應搬出來）',
    settings: {
      ui: {
        pinnedNotes: [
          { id: 'n1', title: '記得', content: '買牛奶', color: '#FFE8AA', visible: true, position: { x: 10, y: 20 } },
          { id: 'bad', title: '壞資料' }
        ]
      }
    }
  },
  {
    name: '12-便利貼舊欄位與獨立檔並存（獨立檔優先）',
    settings: {
      ui: {
        pinnedNotes: [
          { id: 'old', title: '舊的', content: 'x', color: '#fff', visible: true, position: { x: 1, y: 2 } }
        ]
      }
    },
    pinnedNotes: [
      { id: 'new', title: '新的', content: 'y', color: '#000', visible: false, position: { x: 3, y: 4 } }
    ]
  },
  {
    name: '13-onboardingCompleted 已存在時不該被重設',
    settings: { ui: { onboardingCompleted: true } }
  },
  {
    name: '14-CWA 天氣金鑰（加密／明文兩種）',
    settings: {
      weather: { realtimeQuery: { enabled: true, cwaApiKey: fakeEnc('CWA-1234'), location: '臺北市' } }
    }
  },
  {
    name: '15-desktopCharacters 缺 flipped 欄位（應補 false）',
    settings: {
      ui: {
        desktopCharacters: [
          { characterId: 'a', position: { x: 1, y: 2 }, size: 1, muted: false, zIndex: 1 },
          { characterId: 'b', position: { x: 3, y: 4 }, size: 2, flipped: true, muted: true, zIndex: 2 }
        ]
      }
    }
  },
  {
    name: '16-memory 只給部分欄位（其餘走預設）',
    settings: { memory: { keepRecentN: 7 } }
  },
  {
    name: '17-完全損毀的 JSON 結構（頂層是陣列）',
    settings: ['not', 'an', 'object']
  },
  {
    name: '18-混合：舊 persona ＋ 明文金鑰 ＋ 舊便利貼 ＋ 舊模型 id',
    settings: {
      persona: { displayName: '綜合', nickname: '綜綜', description: '一次全中' },
      worldSetting: '奇幻世界',
      llm: { model: 'o1-mini', apiKeys: { openai: 'sk-plain', claude: '', gemini: '', grok: '' } },
      ui: {
        pinnedNotes: [
          { id: 'm1', title: 'T', content: 'C', color: '#CBFBC4', visible: true, position: { x: 5, y: 6 } }
        ]
      }
    }
  }
]

// ── 3. 執行 ─────────────────────────────────────────────────────
//
// ⚠️ 每個樣本必須跑在**自己的 process** 裡。
// `fileStore` 在模組載入當下就把 DATA_DIR 等路徑算好存進模組層變數，
// 而 esbuild bundle 之後沒有 `require.cache` 可以清掉重載
// —— 想在同一個 process 內換資料夾是做不到的。
// 因此沒帶參數時，本檔會針對每個樣本自我 spawn 一次再把結果合併。

function runOne(index: number): void {
  const sample = SAMPLES[index]
  const dataDir = path.join(process.env.DEST_HARNESS_USERDATA!, 'DesktopST')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(sample.settings, null, 2), 'utf-8')
  if (sample.pinnedNotes) {
    fs.writeFileSync(path.join(dataDir, 'pinned-notes.json'), JSON.stringify(sample.pinnedNotes, null, 2), 'utf-8')
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fileStore = require('../src/main/fileStore') as typeof import('../src/main/fileStore')
  const settings = fileStore.loadSettings()
  // 讓 debounce 的存檔立刻落地，才能看到「有沒有回寫」的結果。
  fileStore.flushSaveSettings()

  const readAll = (sub: string): unknown[] => {
    const d = path.join(dataDir, sub)
    if (!fs.existsSync(d)) return []
    return fs.readdirSync(d).sort().map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')))
  }
  const readOne = (f: string): unknown => {
    const p = path.join(dataDir, f)
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null
  }

  process.stdout.write(JSON.stringify({
    settings,
    // 遷移產生的 preset 檔（驗證「該建的有建、不該建的沒建」）
    personaFiles: readAll('personas'),
    worldFiles: readAll('worlds'),
    // 回寫後的 settings.json（驗證金鑰有被加密、舊欄位有被清掉）
    persistedSettings: readOne('settings.json'),
    pinnedNotesFile: readOne('pinned-notes.json')
  }))
}

const argIndex = process.argv[2]
if (argIndex !== undefined) {
  runOne(Number(argIndex))
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('child_process') as typeof import('child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-hydration-'))
  const out: Record<string, unknown> = {}
  for (let i = 0; i < SAMPLES.length; i++) {
    const userData = path.join(root, `s${i}`)
    fs.mkdirSync(userData, { recursive: true })
    try {
      const stdout = execFileSync(process.execPath, [process.argv[1], String(i)], {
        env: { ...process.env, DEST_HARNESS_USERDATA: userData },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      out[SAMPLES[i].name] = JSON.parse(stdout)
    } catch (e) {
      out[SAMPLES[i].name] = { harnessError: e instanceof Error ? e.message : String(e) }
    }
  }
  process.stdout.write(normalizeUuids(JSON.stringify(out, null, 2)))
  try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
}
