# DesktopST Performance Optimization Review

Last updated: 2026-05-30

This document summarizes the current performance investigation after testing multiple historical commits on MSI Claw A1M.

The older `docs/performance-optimization-plan.md` is not currently in the working tree. It is preserved in `stash@{0}^3` as an untracked file from an earlier stash.

## Current Test Context

- Test machine: MSI Claw A1M.
- GPU diagnostics repeatedly report `hardwareAccelerated=NO`.
- `gpu_compositing`, `rasterization`, `webgl`, `webgl2`, and video decode are all software/off.
- `DESKTOPST_IGNORE_GPU_BLOCKLIST=1` did not change the GPU status on this machine.
- Multiple tested commits showed similar memory behavior:
  - `374b088` remote-control integration era.
  - `e066832` screenshot blur fix.
  - `ecac6d7` current main before local experiments.
- This strongly suggests the high baseline is not a recent performance regression from the tested commits.

## Confirmed Findings

### 1. Software Rendering Is The Main Background Constraint

Chromium/Electron is running without hardware acceleration on the test machine.

Impact:

- Transparent always-on-top windows are expensive.
- Opening additional renderer windows can cause large working-set jumps.
- Windows/Chromium may retain allocated working set after a renderer is destroyed.
- Memory may not return to the original idle baseline immediately even when process count drops.

Conclusion:

- The current problem is not just an active leak.
- It is partly renderer/compositor baseline cost under software rendering.

### 2. Commit Regression Hypothesis Was Weakened

Historical commit testing showed similar memory behavior across versions.

Conclusion:

- The tested performance issue likely existed before the recent optimization attempts.
- Continuing to walk further back through nearby commits is low value unless a known good baseline is identified.

### 3. Log Window Is A Major Spike Trigger

Opening the Log window still causes a large memory increase.

Important correction:

- One test run had no images in the Log conversation.
- Therefore image data URLs are not the only cause of the Log spike.

Likely contributors:

- Creating an additional Electron renderer.
- Rendering many message DOM nodes.
- Message components include action buttons, badges, text parsing, hover controls, and layout work.
- Software rendering increases renderer/compositor cost.
- Main process still holds the full active conversation.

### 4. Closing Log Used To Hide, Not Destroy

Previously `window:close-self` called `hide()` for Log.

Current local change:

- Log close now destroys the Log `BrowserWindow`.
- `toggleLogWindow()` also destroys when closing.

Result:

- Electron process count decreases after closing Log.
- Total working set still does not always return close to baseline, likely due to Chromium/Windows allocator retention and main/gpu process caches.

### 5. Input Window Close Also Hid The Renderer

Input window close previously hid the window.

Current local change:

- In low performance mode, closing/toggling a visible input window destroys it.
- Normal mode keeps the old hide behavior for faster reopening.

### 6. Bubble Optimizations Are Low-Risk But Not The Main Memory Fix

Current local changes:

- Low performance mode caps bubble windows to the latest 1 bubble.
- Bubble visuals are simplified in low performance mode.
- App-focus opacity fade is skipped in low performance mode.

Observed impact:

- These are reasonable software-rendering mitigations.
- They do not materially address Log-related memory spikes.

### 7. Image Data URL Risk Still Exists

Even though the latest no-image Log test disproved images as the only cause, image data URLs remain a real future risk.

Current image behavior:

- Pasted/attached images are read as data URLs in the renderer.
- Screenshot capture uses `thumbnail.toDataURL()`.
- Conversation messages can store `images: string[]` containing base64 data URLs.
- Remote/mobile screenshot paths also use data URLs in several places.

Impact:

- Large images can bloat conversation JSON.
- IPC and renderer state can duplicate the same base64 strings.
- Debug prompts and adapter payloads can temporarily create additional copies.

## Hypotheses Tested

### Confirmed Or Mostly Confirmed

- Hardware acceleration is disabled on the test machine.
- `ignore-gpu-blocklist` does not fix this test machine.
- Log open is a major memory spike trigger.
- Log close should destroy, not hide, if memory recovery matters.
- Bubble count/style is not the main Log memory cause.

### Weakened Or Disproved

- Recent commits are the primary regression.
- Images are required for the Log memory spike.
- Focus opacity fade is the main memory cause.
- Hit-test interval tuning alone can solve the memory issue.
- Bubble renderer count alone explains the 1 GB behavior.

### Still Unknown

- How much release build improves memory compared with dev mode.
- How much Log DOM count versus new renderer baseline contributes.
- Whether a virtualized Log with 50 visible rows still spikes similarly.
- Whether memory is retained by Electron browser/gpu process after renderer destruction or by live app state.
- Whether Electron/Chromium version or Intel Arc driver updates can restore hardware acceleration.

## Current Local Changes

These files currently contain local performance-related edits:

- `src/main/index.ts`
  - GPU diagnostics no longer print to dev console; still write to log file.
- `src/main/ipcHandlers.ts`
  - Low performance mode is applied to main process behavior.
  - Log image placeholder retrieval IPC was added.
  - Log close destroys the Log window.
  - Input close destroys the Input window in low performance mode.
- `src/main/types.ts`
  - Added `ui.lowPerformanceMode`.
  - Added `ui.lowPerformanceLogMessageLimit`.
- `src/main/windowManager.ts`
  - Low performance mode state.
  - Bubble limit of 1 in low performance mode.
  - Log window destroy-on-close behavior.
  - Input destroy-on-close in low performance mode.
  - Low performance Log message slicing.
  - Log image placeholder generation.
  - Skip aux opacity fade in low performance mode.
- `src/renderer/src/types/index.ts`
  - Renderer settings types updated.
- `src/renderer/src/windows/BubbleWindow.tsx`
  - Simplified low performance bubble styling.
- `src/renderer/src/windows/LogWindow.tsx`
  - Log image placeholder support.
  - Click `[圖片]` to request image from main process.
- `src/renderer/src/windows/SettingsWindow.tsx`
  - Low performance mode toggle.
  - Low performance Log message limit slider.

## Remaining Optimization Opportunities

### P0: Add Log Diagnostics Before More Guessing

Problem:

- We need to know whether Log spike is caused by payload size, DOM count, renderer creation, or retained caches.

Implementation:

- When `stripConversationForLog()` runs, calculate:
  - total active conversation message count.
  - messages sent to Log.
  - total text character count sent.
  - image count sent.
  - approximate JSON payload size.
  - low performance mode state.
- Show this in the Log window header:
  - `載入訊息: 50 / 1234`
  - `圖片: 0`
  - optional `payload: ~320 KB`
- Also write a concise line to a diagnostics log file.

Expected impact:

- No direct performance improvement.
- High diagnostic value.

Verification:

- Confirm no-image Log tests report `圖片: 0`.
- Confirm low performance mode actually sends the configured message count.

### P1: Virtualize Log Rendering

Problem:

- Log currently renders message DOM directly.
- Even text-only logs can be expensive if many messages are rendered.

Implementation options:

- Use a virtualization library if acceptable.
- Or implement a simple fixed/estimated-height virtual list for recent messages.
- Keep only visible messages plus overscan mounted in DOM.
- Preserve edit/delete/debug interactions for visible items.

Expected impact:

- Likely the best next UI-side improvement for text-only Log spikes.
- Reduces DOM nodes and layout work.

Risk:

- Editing, auto-scroll, search, and scroll-to-bottom behavior need careful testing.

Verification:

- Compare memory opening a long text-only log before/after.
- Confirm message actions still work.
- Confirm scroll performance.

### P1: Paginate Log Data From Main Process

Problem:

- Slicing recent N messages is only a partial mitigation.
- Full conversation remains in main process, and Log still receives a snapshot.

Implementation:

- Add APIs:
  - `conversation:get-summary`
  - `conversation:get-page`
  - `conversation:get-message-range`
- Log opens with recent page only.
- Older messages load when scrolling upward.
- Keep full conversation context for LLM unchanged.

Expected impact:

- Reduces IPC payload and renderer store size.
- Works well with virtualization.

Risk:

- More complex state handling in Log.
- Needs compatibility with conversation switching and deletion.

### P1: Release Build Memory Baseline Test

Problem:

- Current tests are in dev mode.
- Dev mode may include Vite, source maps, dev console, and React development overhead.

Implementation:

- Build or run packaged app.
- Repeat fixed test flow:
  - idle after launch.
  - open input.
  - open Log.
  - close Log.
  - close input.
  - wait 60 seconds.

Expected impact:

- Clarifies whether the 1 GB behavior is dev-only or production-relevant.

### P2: Move Message Images Out Of Conversation JSON

Problem:

- Images are currently stored as strings in message `images`.
- Screenshots and pasted images can become large data URLs.

Implementation:

- Add an attachment store:
  - save images under app data, such as `attachments/<conversationId>/<messageId>-<index>.png`.
  - store metadata/path/reference in conversation JSON.
  - provide IPC to resolve attachment URL/path for preview.
- Migrate old data URLs lazily when a conversation is loaded or when saving.

Expected impact:

- Major reduction for image-heavy histories.
- Prevents future Log/input/mobile spikes caused by base64 duplication.

Risk:

- Migration and backup/export/import paths need care.
- LLM adapters currently expect images as local path, URL, or data URL; path references must still work.

### P2: Screenshot Data Path Optimization

Problem:

- Screenshot paths use `thumbnail.toDataURL()`.
- Mobile screenshot code also emits base64.

Implementation:

- Use `thumbnail.toPNG()` where possible.
- Save temporary or permanent screenshot files.
- Return attachment reference or file path instead of data URL.
- Keep clipboard behavior by converting only at clipboard-write time.

Expected impact:

- Reduces peak memory during screenshot capture.
- Aligns with attachment-store work.

### P2: Lightweight Input Initialization

Status:

- The old plan proposed this.
- The current working tree does not include the full earlier implementation from stash.

Implementation:

- Input window should not load full conversation.
- It only needs:
  - settings.
  - desktop character state.
  - title/current conversation metadata.
  - last error if displayed.
  - active persona display name if needed.

Expected impact:

- Prevents input open from becoming another data-loading spike.

Note:

- The current local change focused on Log and low performance mode. Re-apply this carefully from the old plan or reimplement cleanly.

### P3: Alpha Hit-Test Mask Reduction

Status:

- The old plan had a partial implementation in stash.
- Current working tree still has full RGBA `getImageData()` in `CharacterSprite`.

Opportunity:

- Use a downsampled alpha-only mask.
- In low performance mode, optionally skip per-pixel alpha hit testing.

Expected impact:

- Helps large sprite memory.
- Does not solve Log spikes.

Risk:

- Skipping alpha hit testing changes transparent click-through behavior, which is core UX.
- Downsampled alpha mask is safer than bounding-box fallback.

### P3: Non-Character Transparent Window Reduction

Problem:

- Many aux windows are transparent even when they do not need desktop cut-through.

Candidates:

- Input window currently transparent.
- User bubble transparent.
- Pinned notes and managers transparent.
- Emoji/random tools transparent.

Approach:

- In low performance mode, keep character windows transparent.
- Consider making non-character aux windows opaque where possible.
- Avoid changing core character transparency and drag/drop behavior.

Expected impact:

- May reduce software compositor pressure.
- Needs visual QA.

### P4: Hit-Test Redesign

Status:

- Previous pure event-driven attempts were reverted.

Recommendation:

- Do not prioritize until data-heavy and Log issues are addressed.
- Current hit-test tuning is unlikely to solve memory baseline.

## Suggested Next Work Order

1. Add Log diagnostics and visible loaded-count display.
2. Verify low performance Log actually sends the configured count.
3. Test release build memory baseline.
4. Implement Log virtualization.
5. Implement paged Log APIs.
6. Move images from conversation JSON to attachment files.
7. Optimize screenshot/mobile image path.
8. Revisit alpha hit-test mask reduction.
9. Consider low-performance opaque aux windows, but keep character transparency untouched.

## Notes For Future Continuation

- Do not judge memory only by total Electron group working set immediately after closing windows.
- Track process count and per-process memory as well.
- Wait 30-60 seconds after closing windows before recording memory.
- A no-image text-only Log spike points toward renderer/DOM/software rendering, not image payload.
- An image-heavy Log spike points toward data URL payload and attachment storage.
- Hardware acceleration remaining `NO` is the largest environmental constraint on MSI Claw A1M.
