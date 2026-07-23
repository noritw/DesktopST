# 對白泡泡 & 角色分層 — 狀態機設計

## 目標

角色發話時，即使使用者沒勾「永遠在最上層」，角色和對白泡泡都要一起浮到最前面。
使用者關閉對白框、或點擊/拖曳角色後，再把角色降回原本層級。

---

## 涉及的視窗

| 視窗 | 建立時的 alwaysOnTop | 說明 |
|------|---------------------|------|
| Character Window (cw) | `charactersAlwaysOnTop ? 'floating' : false` | 透明桌寵視窗 |
| Bubble Window (bw) | `charactersAlwaysOnTop ? 'screen-saver' : false` | 對白泡泡視窗 |

---

## 角色分層狀態（per character）

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
    ┌───────┐  showBubble   ┌──────────┐   closeBubble/     ┌───────┐ │
    │ IDLE  │──────────────▶│ SPEAKING │──dragStart/click──▶│ IDLE  │ │
    └───────┘               └──────────┘                    └───────┘ │
        ▲                        │                              │     │
        │                        │ nextMessage                  │     │
        │                        ▼                              │     │
        │                   ┌──────────┐                        │     │
        │                   │ SPEAKING │ (bubble still visible) │     │
        │                   └──────────┘                        │     │
        │                        │                              │     │
        └────────────────────────┴──────────────────────────────┘     │
                                                                      │
    (dragEnd 且 bubble 還在 → 重新進入 SPEAKING)                       │
                                                                      │
```

### 狀態定義

| 狀態 | cw.alwaysOnTop | bw.alwaysOnTop | 說明 |
|------|---------------|---------------|------|
| **IDLE** | `charactersAlwaysOnTop ? 'floating' : false` | (hidden 或 false) | 正常待機 |
| **SPEAKING** | `'screen-saver'` | `'screen-saver'` | 對白顯示中，兩者都在最頂層 |

### 轉換觸發

| 從 | 到 | 觸發事件 | 動作 |
|----|----|---------|----|
| IDLE → SPEAKING | `showSpeechBubble` (bubble hidden→visible) | `cw.setAlwaysOnTop(true, 'screen-saver')` + `bw.setAlwaysOnTop(true, 'screen-saver')` + `moveTop()` |
| SPEAKING → SPEAKING | `showSpeechBubble` (bubble already visible) | **只 `moveTop()`，不動 setAlwaysOnTop** + 送 `bubble:show` 更新文字 |
| SPEAKING → IDLE | `closeBubble` / `hideSpeechBubble` | `cw.setAlwaysOnTop(原始level)` + `bw.setAlwaysOnTop(false)` + `bw.hide()` |
| SPEAKING → IDLE | `beginCharacterDrag` (使用者拖曳) | `cw.setAlwaysOnTop(原始level)` (bubble 會在 drag 中被 hide) |
| IDLE → SPEAKING | drag 結束且 bubble 重現 | 重新 promote 兩者 |

---

## 關鍵原則

1. **`setAlwaysOnTop` 只在狀態轉換時呼叫**（IDLE↔SPEAKING）。狀態內重複發話只用 `moveTop()`。
2. **降層（demote）一定是成對的**：character 降 + bubble 降（或 hide）。
3. **`charactersAlwaysOnTop = true` 時**：SPEAKING 和 IDLE 差別只在 cw 是 'floating' vs 'screen-saver'。
4. **`charactersAlwaysOnTop = false` 時**：IDLE = 都不 topmost；SPEAKING = 都 topmost。

---

## 如何追蹤當前狀態

新增一個 Map：`characterSpeakingState: Map<string, boolean>`

- 進入 SPEAKING：設為 `true`
- 回到 IDLE：設為 `false` / 刪除

判斷邏輯：
- `showSpeechBubble` 中，如果 `characterSpeakingState.get(id)` = true → 已在 SPEAKING，只 moveTop
- 如果 = false/undefined → 進入 SPEAKING，做 promote

---

## 與原始碼的對應

| 原始函式 | 狀態機角色 |
|---------|-----------|
| `raiseBubbleAndCharacterForShow()` | IDLE → SPEAKING 的 promote 動作 |
| `restoreCharacterAlwaysOnTopAfterBubbleHide()` | SPEAKING → IDLE 的 demote 動作（但原本只處理 cw） |
| `hideSpeechBubble()` | 觸發 SPEAKING → IDLE |
| `closeBubble()` (renderer) | 觸發 SPEAKING → IDLE（透過 IPC） |
| `beginCharacterDrag()` | 觸發 SPEAKING → IDLE |
| `reconcileSpeechBubbleAfterCharacterDrag()` | 拖曳結束，若 bubble 重現 → 觸發 IDLE → SPEAKING |

---

## 實作計劃

1. 新增 `const characterSpeakingState = new Map<string, boolean>()`
2. 新增 `promoteForSpeaking(characterId, bw)` — IDLE → SPEAKING 的完整動作
3. 新增 `demoteAfterSpeaking(characterId)` — SPEAKING → IDLE 的完整動作
4. 修改 `dispatchShow`：
   - bubble visible → 只 `moveTop()` + send content（不碰 alwaysOnTop）
   - bubble hidden → 呼叫 `promoteForSpeaking()` （在 reveal 時）
5. 修改 `hideSpeechBubble` / `closeBubble` → 呼叫 `demoteAfterSpeaking()`
6. 修改 `beginCharacterDrag` → 呼叫 `demoteAfterSpeaking()`
7. 修改 `reconcileSpeechBubbleAfterCharacterDrag` → 呼叫 `promoteForSpeaking()`
