import fs from 'node:fs'
import path from 'node:path'

function pickString(value) {
  if (typeof value !== 'string') return ''
  return value
}

function pickStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string')
}

function toOverwriteJson(raw) {
  return {
    name: pickString(raw?.name),
    nicknames: pickStringArray(raw?.nicknames),
    description: pickString(raw?.description),
    personality: pickString(raw?.personality),
    firstMessage: pickString(raw?.firstMessage ?? raw?.first_mes),
    exampleDialogue: pickString(raw?.exampleDialogue ?? raw?.mes_example),
    scenario: pickString(raw?.scenario),
    systemPromptOverride: pickString(raw?.systemPromptOverride ?? raw?.system_prompt),
    creatorNotes: pickString(raw?.creatorNotes ?? raw?.creator_notes),
    lorebook: null,
    // 覆蓋匯入專用：不攜帶本機絕對路徑，避免圖片/資源錯位。
    avatar: '',
    emotions: {},
    spriteIds: {}
  }
}

function main() {
  const sourceDir = process.argv[2]
  if (!sourceDir) {
    throw new Error('請提供來源資料夾路徑')
  }
  const inputDir = path.resolve(sourceDir)
  const outputDir = `${inputDir}_覆蓋匯入版`

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error(`來源資料夾不存在：${inputDir}`)
  }

  fs.mkdirSync(outputDir, { recursive: true })

  const files = fs.readdirSync(inputDir).filter(name => name.toLowerCase().endsWith('.json'))
  if (files.length === 0) {
    throw new Error('來源資料夾沒有 JSON 檔案')
  }

  for (const file of files) {
    const sourcePath = path.join(inputDir, file)
    const text = fs.readFileSync(sourcePath, 'utf8')
    const raw = JSON.parse(text)
    const cleaned = toOverwriteJson(raw)
    const outPath = path.join(outputDir, file)
    fs.writeFileSync(outPath, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8')
  }

  console.log(`已輸出 ${files.length} 份覆蓋匯入 JSON：${outputDir}`)
}

main()
