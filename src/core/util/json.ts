/** 容錯 JSON 解析：LLM 回應常夾雜前後文，退而求其次抓第一組大括號。 */
export function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    const match = String(s ?? '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}
