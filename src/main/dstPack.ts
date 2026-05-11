import * as fs from 'fs'
import * as path from 'path'
import JSZip from 'jszip'
import type { AppSettings, Character, PersonaPreset, WorldPreset } from './types'

export const DST_PACK_FORMAT = 'desktopst-pack' as const
export const DST_PACK_VERSION = 1

export interface DstPackManifest {
  format: typeof DST_PACK_FORMAT
  version: number
  exportedAt: number
  includeGlobalSettings: boolean
  characterIds: string[]
}

export interface DstPackGlobalPartial {
  worldSetting: string
  interactionExample: string
  injectSystemTime: boolean
  persona: {
    displayName: string
    nickname: string
    description: string
  }
}

function addDiskDirToZip(zip: JSZip, diskRoot: string, zipPrefix: string): void {
  if (!fs.existsSync(diskRoot)) return
  const entries = fs.readdirSync(diskRoot, { withFileTypes: true })
  for (const ent of entries) {
    const abs = path.join(diskRoot, ent.name)
    const zpath = `${zipPrefix}/${ent.name}`.replace(/\\/g, '/')
    if (ent.isDirectory()) addDiskDirToZip(zip, abs, zpath)
    else zip.file(zpath, fs.readFileSync(abs))
  }
}

export async function buildDstPackBuffer(opts: {
  charsRoot: string
  characterIds: string[]
  includeGlobalSettings: boolean
  settings: AppSettings
  persona?: PersonaPreset | null
  world?: WorldPreset | null
}): Promise<Buffer> {
  const { charsRoot, characterIds, includeGlobalSettings, settings, persona, world } = opts
  const zip = new JSZip()
  const manifest: DstPackManifest = {
    format: DST_PACK_FORMAT,
    version: DST_PACK_VERSION,
    exportedAt: Date.now(),
    includeGlobalSettings,
    characterIds: [...characterIds]
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  if (includeGlobalSettings) {
    const partial: DstPackGlobalPartial = {
      worldSetting: world?.worldSetting ?? '',
      interactionExample: world?.interactionExample ?? '',
      injectSystemTime: !!settings.injectSystemTime,
      persona: {
        displayName: persona?.displayName ?? '使用者',
        nickname: persona?.nickname ?? '主人',
        description: persona?.description ?? ''
      }
    }
    zip.file('global/settings.partial.json', JSON.stringify(partial, null, 2))
  }

  for (const id of characterIds) {
    const dir = path.join(charsRoot, id)
    if (!fs.existsSync(dir)) continue
    addDiskDirToZip(zip, dir, `characters/${id}`)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export interface ParsedDstPack {
  manifest: DstPackManifest
  globalPartial: DstPackGlobalPartial | null
  /** character id -> relative path prefix inside zip (characters/<id>) */
  characterZipPrefixes: string[]
}

export async function loadDstPackZip(buffer: Buffer): Promise<{ parsed: ParsedDstPack; zip: JSZip }> {
  const zip = await JSZip.loadAsync(buffer)
  const parsed = await parseDstPackZip(zip)
  return { parsed, zip }
}

export async function parseDstPackZip(zip: JSZip): Promise<ParsedDstPack> {
  const mf = zip.file('manifest.json')
  if (!mf) throw new Error('缺少 manifest.json，不是有效的 DesktopST 搬家包')
  const manifest = JSON.parse(await mf.async('string')) as DstPackManifest
  if (manifest.format !== DST_PACK_FORMAT) throw new Error('無法辨識的封裝格式')
  if (manifest.version !== DST_PACK_VERSION) throw new Error(`不支援的封裝版本：${String(manifest.version)}`)

  let globalPartial: DstPackGlobalPartial | null = null
  const gp = zip.file('global/settings.partial.json')
  if (gp) {
    globalPartial = JSON.parse(await gp.async('string')) as DstPackGlobalPartial
  }

  const prefixes = new Set<string>()
  const wanted = new Set((manifest.characterIds ?? []).map(String))
  for (const p of Object.keys(zip.files)) {
    const norm = p.replace(/\\/g, '/')
    const m = /^characters\/([^/]+)\//.exec(norm)
    if (m) {
      const id = m[1]
      if (wanted.size === 0 || wanted.has(id)) prefixes.add(`characters/${id}`)
    }
  }
  if (prefixes.size === 0) {
    for (const p of Object.keys(zip.files)) {
      const norm = p.replace(/\\/g, '/')
      const m = /^characters\/([^/]+)\//.exec(norm)
      if (m) prefixes.add(`characters/${m[1]}`)
    }
  }

  const characterZipPrefixes = [...prefixes].sort()
  if (characterZipPrefixes.length === 0) throw new Error('封裝內沒有任何角色資料')

  return { manifest, globalPartial, characterZipPrefixes }
}

/** @deprecated 單次解析用；匯入流程請用 loadDstPackZip 以避免重複解壓 */
export async function parseDstPack(buffer: Buffer): Promise<ParsedDstPack> {
  const { parsed } = await loadDstPackZip(buffer)
  return parsed
}

export async function readCharacterFromZip(zip: JSZip, prefix: string): Promise<Character> {
  const cardPath = `${prefix}/card.json`.replace(/\\/g, '/')
  const f = zip.file(cardPath)
  if (!f) throw new Error(`缺少 ${cardPath}`)
  const raw = JSON.parse(await f.async('string')) as Character
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.name) throw new Error('角色卡資料不完整')
  return raw
}

export async function extractCharacterDirFromZip(
  zip: JSZip,
  prefix: string,
  destDir: string
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const pref = prefix.replace(/\\/g, '/')
  for (const relPath of Object.keys(zip.files)) {
    const zf = zip.files[relPath]
    if (!zf || zf.dir) continue
    const norm = relPath.replace(/\\/g, '/')
    if (!norm.startsWith(`${pref}/`)) continue
    const tail = norm.slice(pref.length + 1)
    if (!tail) continue
    const out = path.join(destDir, tail)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const buf = await zf.async('nodebuffer')
    fs.writeFileSync(out, buf)
  }
}
