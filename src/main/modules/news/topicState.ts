/**
 * 「後續聊天主題」狀態（單例）。
 * 使用者在新聞泡泡按「作為後續聊天主題」後，該則新聞釘成桌面上的主題泡泡；
 * 主題存在期間，角色「主動發話」（說點什麼 / 提醒）會圍繞這則聊，不再隨機抽新。
 * 同一時間只能有一個主題。
 */
export interface NewsTopic {
  id: string
  title: string
  summary: string
  url: string
  source: string
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
