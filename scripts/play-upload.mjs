/**
 * 把 AAB 送上 Google Play（2026-10-12 加）。一次性帳號設定見 docs/play-auto-upload-setup.md。
 *
 *   node scripts/play-upload.mjs --check                 乾跑：只確認金鑰與權限，不上傳任何東西
 *   node scripts/play-upload.mjs                         上傳 out/apk/DeST-v<版本>-release.aab 到正式版並送審
 *   node scripts/play-upload.mjs --app nutrition         食記（tw.nori.destnutrition）
 *   node scripts/play-upload.mjs --aab <路徑>            指定 AAB
 *   node scripts/play-upload.mjs --track internal        改送內部測試（預設 production）
 *   node scripts/play-upload.mjs --notes-file <路徑>     版本資訊（zh-TW，超過 500 字會截斷）
 *
 * 不加任何 npm 依賴：用 Node 內建 crypto 簽 JWT 換 access token，再走 API 的標準流程
 * edits.insert → bundles.upload → tracks.update → edits.commit。中途失敗一律 edits.delete，
 * 不會留下半套的草稿。
 *
 * ⚠️ versionCode 一旦傳上 Play 就永久佔用（就算之後刪掉草稿也一樣），所以：
 *   - 要確認設定通不通，用 --check，別拿真的 AAB 去試
 *   - 上傳前會先比對正式版已有的 versionCode，重複就直接停，不浪費一次上傳
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const keyPath = path.join(root, 'android', 'play-service-account.json')
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'

const APPS = {
  dest: { label: 'DeST', pkg: 'tw.nori.dest', pkgJson: 'package.json', aabPrefix: 'DeST' },
  nutrition: { label: '食記', pkg: 'tw.nori.destnutrition', pkgJson: 'nutrition/mobile/package.json', aabPrefix: 'DeSTNutrition' },
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function fail(msg) {
  console.error('')
  console.error(`❌ ${msg}`)
  process.exit(1)
}

const app = APPS[arg('--app') ?? 'dest'] ?? fail(`不認得的 --app「${arg('--app')}」，可用：${Object.keys(APPS).join(' / ')}`)
const checkOnly = process.argv.includes('--check')
const track = arg('--track') ?? 'production'

// ── 認證 ──────────────────────────────────────────────────

function loadKey() {
  if (!fs.existsSync(keyPath)) {
    fail(`找不到服務帳戶金鑰：${keyPath}\n   設定步驟見 docs/play-auto-upload-setup.md §1。`)
  }
  let key
  try {
    key = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
  } catch {
    fail(`${keyPath} 不是合法的 JSON。`)
  }
  if (key.type !== 'service_account' || !key.private_key || !key.client_email) {
    fail(`${keyPath} 不是服務帳戶金鑰（type 應為 service_account）。是不是下載成 OAuth 用戶端的 JSON 了？`)
  }
  return key
}

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: key.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  const res = await fetch(key.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    fail(`換 access token 失敗（HTTP ${res.status}）：${body.error_description ?? body.error ?? '無訊息'}\n` +
      '   金鑰可能已在 Cloud Console 被刪除，重新產生一把即可。')
  }
  return body.access_token
}

// ── API ───────────────────────────────────────────────────

let token = ''

async function call(method, url, { json, body, contentType, timeoutMs = 60_000 } = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  if (json !== undefined) headers['Content-Type'] = 'application/json'
  else if (contentType) headers['Content-Type'] = contentType
  const res = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const err = new Error(data.error?.message ?? text ?? `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

function explain(err) {
  if (err.status === 403 || err.status === 401) {
    return `${err.message}\n\n` +
      '   權限不足。常見原因：\n' +
      '   ① 剛在 Play Console 加好服務帳戶，權限還在傳播（最長 24～36 小時），明天再試\n' +
      `   ② Play Console「使用者和權限」裡，這個服務帳戶沒有勾到 ${app.label} 這支 App\n` +
      '   ③ Cloud 專案沒啟用「Google Play Android Developer API」'
  }
  if (err.status === 404) {
    return `${err.message}\n\n   找不到 App ${app.pkg}。服務帳戶看不到這支 App 時也會回 404，檢查 Play Console 的應用程式權限。`
  }
  return err.message
}

function describeReleases(t) {
  const rels = t?.releases ?? []
  if (rels.length === 0) return '    （沒有任何版本）'
  return rels
    .map((r) => `    ${r.name ?? '(無名稱)'}  versionCode ${(r.versionCodes ?? []).join(', ')}  ${r.status}`)
    .join('\n')
}

// ── 主流程 ────────────────────────────────────────────────

const key = loadKey()
console.log('')
console.log(`=== Google Play ${checkOnly ? '連線檢查（乾跑）' : '上傳'}：${app.label}（${app.pkg}）===`)
console.log(`服務帳戶：${key.client_email}`)

token = await getAccessToken(key)
console.log('[1] access token ✅')

let editId = ''
try {
  editId = (await call('POST', `${API}/${app.pkg}/edits`, { json: {} })).id
  console.log('[2] 開啟編輯工作階段 ✅（能開就代表權限通了）')

  const current = await call('GET', `${API}/${app.pkg}/edits/${editId}/tracks/${track}`).catch((e) => {
    if (e.status === 404) return null
    throw e
  })
  console.log(`[3] ${track} 目前的版本：`)
  console.log(describeReleases(current))

  if (checkOnly) {
    await call('DELETE', `${API}/${app.pkg}/edits/${editId}`)
    editId = ''
    console.log('')
    console.log('✅ 檢查通過。沒有上傳任何東西，也沒有用掉 versionCode。')
    process.exit(0)
  }

  // ── 真的上傳 ──
  const version = JSON.parse(fs.readFileSync(path.join(root, app.pkgJson), 'utf8')).version
  const aabPath = path.resolve(arg('--aab') ?? path.join(root, 'out', 'apk', `${app.aabPrefix}-v${version}-release.aab`))
  if (!fs.existsSync(aabPath)) {
    throw new Error(`找不到 AAB：${aabPath}\n   先跑 MobileST.bat → [6] 打包。`)
  }
  const usedCodes = new Set((current?.releases ?? []).flatMap((r) => r.versionCodes ?? []).map(String))
  const notesFile = arg('--notes-file')
  let notes = notesFile ? fs.readFileSync(notesFile, 'utf8').trim() : ''
  if (notes.length > 500) notes = notes.slice(0, 497) + '…'

  const sizeMb = (fs.statSync(aabPath).size / (1024 * 1024)).toFixed(1)
  console.log(`[4] 上傳 ${path.basename(aabPath)}（${sizeMb} MB）…`)
  const bundle = await call('POST', `${UPLOAD_API}/${app.pkg}/edits/${editId}/bundles?uploadType=media`, {
    body: fs.readFileSync(aabPath),
    contentType: 'application/octet-stream',
    timeoutMs: 15 * 60_000,
  })
  const code = String(bundle.versionCode)
  if (usedCodes.has(code)) {
    // 理論上 Play 會先擋，這裡是保險
    throw new Error(`versionCode ${code} 已經在 ${track} 上了，這個 AAB 是舊的。先升版號再打包。`)
  }
  console.log(`    ✅ versionCode ${code}`)

  console.log(`[5] 設定 ${track} 版本…`)
  await call('PUT', `${API}/${app.pkg}/edits/${editId}/tracks/${track}`, {
    json: {
      track,
      releases: [{
        name: version,
        versionCodes: [code],
        status: 'completed',
        ...(notes ? { releaseNotes: [{ language: 'zh-TW', text: notes }] } : {}),
      }],
    },
  })

  console.log('[6] 送出（commit）…')
  await call('POST', `${API}/${app.pkg}/edits/${editId}:commit`)
  editId = ''
  console.log('')
  console.log(`✅ ${app.label} ${version}（versionCode ${code}）已送交 ${track}，等 Google 審查。`)
  console.log('   進度看 Play Console →「發布總覽」。')
} catch (err) {
  if (editId) {
    await call('DELETE', `${API}/${app.pkg}/edits/${editId}`).catch(() => {})
  }
  fail(explain(err))
}
