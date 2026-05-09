/**
 * 在啟用「與 OpenAI 分享 API 輸入／輸出」且帳戶符合資格時，每日贈送 token 僅適用於下列模型（額度分兩組、分別共用）。
 * 非贈送方案或微調／eval／工具呼叫等不在此列。
 *
 * 清單為官方文件截錄，OpenAI 更新政策時請對照下列連結手動同步。
 * @see https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai
 */

/** 每日 1M（Tier 1–2 為 250K）額度共用 — 與下方 10M 組分開計 */
export const OPENAI_DATA_SHARING_INCENTIVE_1M_GROUP: string[] = [
  'gpt-5.5-2026-04-23',
  'gpt-5.4-2026-03-05',
  'gpt-5.2-2025-12-11',
  'gpt-5.1-2025-11-13',
  'gpt-5.1-codex',
  'gpt-5-codex',
  'gpt-5-2025-08-07',
  'gpt-5-chat-latest',
  'gpt-4.1-2025-04-14',
  'gpt-4o-2024-05-13',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-11-20',
  'o3-2025-04-16',
  'o1-preview-2024-09-12',
  'o1-2024-12-17'
]

/** 每日 10M（Tier 1–2 為 2.5M）額度共用 — 較輕量模型組 */
export const OPENAI_DATA_SHARING_INCENTIVE_10M_GROUP: string[] = [
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5.1-codex-mini',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'gpt-4o-mini-2024-07-18',
  'o4-mini-2025-04-16',
  'o1-mini-2024-09-12',
  'codex-mini-latest'
]
