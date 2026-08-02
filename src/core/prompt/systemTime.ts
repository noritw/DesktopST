/**
 * 系統時間注入用的格式化。
 *
 * ⚠️ 本檔含刻意寫死的中文字串，但那是**送進 LLM prompt 的內容**，不是 UI 文案
 * （roadmap §3.3 之例外，2026-08-02 owner 拍板）。日後若要多語系，只需改本檔。
 */

export function formatSystemTimeLabel(d: Date): string {
  const hours = d.getHours()
  return hours < 5 ? '凌晨'
    : hours < 8 ? '清晨'
    : hours < 12 ? '上午'
    : hours < 13 ? '中午'
    : hours < 18 ? '下午'
    : hours < 19 ? '傍晚'
    : hours < 23 ? '晚上'
    : '深夜'
}

export function formatSystemTimeStamp(d: Date): string {
  const timeLabel = formatSystemTimeLabel(d)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${timeLabel}`
}
