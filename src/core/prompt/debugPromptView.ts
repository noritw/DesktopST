/**
 * 除錯用 prompt 的呈現格式（桌面 Log 視窗與手機訊息選單共用）。
 *
 * 純字串處理，沒有平台相依 —— 放在 `core/` 是為了讓兩邊看到**一模一樣的排版**：
 * 抄成兩份的話，比對桌面與手機為什麼結果不同時，會先被排版差異誤導。
 */

/**
 * 把 prompt JSON 裡的圖片 base64 換成佔位字串。
 *
 * 一張圖的 base64 動輒數十萬字元，原樣貼出去等於整段看不到重點，
 * 複製到別的地方也會直接卡住。解析失敗就退回正規表示式硬掃。
 */
export function stripImageData(prompt: string): string {
  try {
    const obj = JSON.parse(prompt)
    const walk = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(walk)
      if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>
        // OpenAI: { type: "image_url", image_url: { url: "data:..." } }
        if (o.type === 'image_url' && o.image_url && typeof (o.image_url as Record<string, unknown>).url === 'string') {
          const url = (o.image_url as Record<string, unknown>).url as string
          if (url.startsWith('data:')) {
            return { ...o, image_url: { ...(o.image_url as object), url: '[IMAGE DATA REMOVED]' } }
          }
        }
        // OpenAI Responses API: { type: "input_image", image_url: "data:..." }
        if (typeof o.image_url === 'string' && (o.image_url as string).startsWith('data:')) {
          return { ...o, image_url: '[IMAGE DATA REMOVED]' }
        }
        // Anthropic: { type: "image", source: { type: "base64", data: "..." } }
        if (o.type === 'image' && o.source && typeof (o.source as Record<string, unknown>).data === 'string') {
          return { ...o, source: { ...(o.source as object), data: '[IMAGE DATA REMOVED]' } }
        }
        return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v)]))
      }
      return node
    }
    return JSON.stringify(walk(obj), null, 2)
  } catch {
    // fallback: regex strip for data URLs
    return prompt.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[IMAGE DATA REMOVED]')
  }
}

/**
 * 分段標題。
 *
 * 尾巴的橫線刻意只有幾個字元：手機螢幕窄，長橫線會自己折成第二行，
 * 反而看不出哪裡是分段。夠讓眼睛掃到就好。
 */
function sectionRule(role: string): string {
  return `── [${role}] ────`
}

/**
 * 把 prompt JSON 攤成人看得懂的文字：先幾行後設資料，再依角色分段。
 *
 * 不是合法 JSON 就原樣回傳 —— 除錯時看到原始內容，比看到「格式錯誤」有用。
 */
export function renderDebugPrompt(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const lines: string[] = []

    for (const key of ['provider', 'model', 'endpoint', 'max_output_tokens', 'temperature']) {
      if (obj[key] !== undefined) lines.push(`${key}: ${obj[key]}`)
    }

    const renderContent = (content: unknown): string => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>)
          .map(p => p.type === 'text' ? String(p.text ?? '') : '[image]')
          .join('')
      }
      return String(content)
    }

    const msgs = (obj.input ?? obj.messages) as Array<{ role: string; content: unknown }> | undefined
    if (msgs) {
      for (const msg of msgs) {
        lines.push(`\n${sectionRule(msg.role)}`)
        lines.push(renderContent(msg.content))
      }
    } else {
      // Claude / Gemini truncated format
      const systemText = (obj.system ?? obj.systemInstruction) as string | undefined
      if (systemText) {
        lines.push(`\n${sectionRule('system')}`)
        lines.push(systemText)
      }
      if (obj.historyLength !== undefined) lines.push(`\nhistory: ${obj.historyLength} turns, current: ${obj.currentParts} parts`)
    }

    return lines.join('\n').trimEnd()
  } catch {
    return raw
  }
}
