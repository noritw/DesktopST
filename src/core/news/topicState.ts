/**
 * 「後續聊天主題」狀態（單例）。
 * 使用者在新聞泡泡按「作為後續聊天主題」後，該則新聞釘成桌面上的主題泡泡；
 * 主題存在期間，角色「主動發話」（說點什麼 / 提醒）會圍繞這則聊，不再隨機抽新。
 * 同一時間只能有一個主題。
 *
 * 注意：這是 process 級單例。桌面版與手機版各自一個 process，
 * 前提是「同一 process 內不會有多個 DeST 實例共存」（owner 2026-08-03 確認）。
 * 若日後這個前提不成立，才需要改為注入式；B1 是純重構，此處不改設計。
 */
export interface NewsTopic {
  id: string
  title: string
  summary: string
  url: string
  source: string
  /** 實際進 Prompt 的上下文（enrich／手動改正）；無則退回 summary */
  promptContext?: string
}

let activeTopic: NewsTopic | null = null

export function getActiveNewsTopic(): NewsTopic | null {
  return activeTopic
}

export function setActiveNewsTopic(topic: NewsTopic | null): void {
  activeTopic = topic
}

export function hasActiveNewsTopic(): boolean {
  return activeTopic !== null
}
