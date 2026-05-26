/**
 * 重新打包 TRPG dstpack（移除指定角色 ID）
 * 用法：node scripts/rebuild-trpg-pack.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'

const SRC = 'D:/DesktopST/assets/DesktopST_TRPGPack.dstpack'
const DST = 'D:/DesktopST/assets/DesktopST_TRPGPack.dstpack'

// 要從包裡移除的角色 ID
const REMOVE_IDS = new Set([
  'c5eafc32-f40c-4db2-b40f-b53d30485228' // 棋子
])

const buf = readFileSync(SRC)
const srcZip = await JSZip.loadAsync(buf)

// 讀取並修改 manifest
const manifest = JSON.parse(await srcZip.file('manifest.json').async('string'))
manifest.characterIds = manifest.characterIds.filter(id => !REMOVE_IDS.has(id))
manifest.exportedAt = Date.now()

const newZip = new JSZip()
newZip.file('manifest.json', JSON.stringify(manifest, null, 2))

// 複製其他檔案（排除被移除角色的資料夾）
for (const [path, file] of Object.entries(srcZip.files)) {
  if (file.dir) continue
  if (path === 'manifest.json') continue

  const norm = path.replace(/\\/g, '/')
  const charMatch = /^characters\/([^/]+)\//.exec(norm)
  if (charMatch && REMOVE_IDS.has(charMatch[1])) continue

  newZip.file(norm, await file.async('nodebuffer'))
}

const out = await newZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
writeFileSync(DST, out)

console.log(`完成。移除角色：${[...REMOVE_IDS].join(', ')}`)
console.log(`剩餘角色：${manifest.characterIds.join(', ')}`)
console.log(`輸出：${DST}（${(out.length / 1024 / 1024).toFixed(1)} MB）`)
