# agent-watchdog — TODO

## v0.2 — Detection Expansion

### Tool Call Loop Detection ✓
- [x] Add `WatchdogToolCall` type + `tool_calls?` field to `WatchdogState`
- [x] Implement `toolCallLoopScore()` — Jaccard on stringified args of most-repeated tool
- [x] Add `toolCallThreshold` to `WatchdogConfig` (default 0.7)
- [x] Add `"tool_loop_detected"` to `WatchdogDecision`
- [x] `report()` surfaces looping tool name and arg similarity %

### State Regression Detection ✓
- [x] Hash sliding window of messages with SHA-256 each cycle
- [x] Store seen hashes in watchdog instance (`seenHashes: Set<string>`)
- [x] Match → `"state_regression"` decision
- [x] Expose `reset()` for reusing the same instance across independent runs

### Structured JSON Report ✓
- [x] `reportJson(state, decision)` returns typed `WatchdogReport` object
- [x] `report()` now delegates to `reportJson()` for consistency
- [x] `WatchdogReport` exported from package root

---

## v0.3 — Control & Notifications

### Human-in-the-Loop Pause
- [ ] Add async `createAsyncWatchdogRouter()` variant
- [ ] On sensitive decision, emit a pause signal instead of immediately routing to END
- [ ] Accept `onPause: (report, resume, abort) => Promise<void>` callback
- [ ] User calls `resume()` to continue graph or `abort()` to halt
- [ ] Add `"paused"` to `WatchdogDecision`

### Token Budget Monitoring
- [ ] Add `tokenCount?: number` to `WatchdogState`
- [ ] Add `maxTokens?: number` to `WatchdogConfig`
- [ ] Early-warning callback at configurable % of budget (e.g. 80%)
- [ ] Hard halt at 100% → `"budget_exceeded"` decision
- [ ] Estimate $ cost in report (accept `costPerToken` config)

### Built-in Webhook Notifications
- [ ] Add `notifications?: { slack?: string; webhook?: string }` to config
- [ ] On intervention, POST structured JSON payload to configured endpoints
- [ ] No extra dependencies — use Node's built-in `fetch`

---

## v0.4 — Observability & Integrations

### OpenTelemetry Exporter
- [ ] Optional peer dep: `@opentelemetry/api`
- [ ] Emit a span per watchdog check with similarity score, iteration, decision as attributes
- [ ] Works with any OTEL-compatible backend (Grafana, Datadog, Honeycomb)

### Similarity Score Streaming
- [ ] Expose `onCheck?: (score: number, iteration: number) => void` callback in config
- [ ] Fires on every cycle, lets users build their own trend charts

### CrewAI Adapter
- [ ] `src/adapters/crewai.ts` — wrap watchdog check as a CrewAI task guard

### AutoGen Adapter
- [ ] `src/adapters/autogen.ts` — hook into AutoGen's reply function

---

## Ongoing

- [ ] Add unit tests (Jest or Vitest) — at minimum for `jaccard()`, `check()`, `report()`
- [ ] Publish docs site (`docs/`) to GitHub Pages
- [ ] Set up GitHub Actions: typecheck + test on push
- [ ] Bump to v0.2.0 after first detection expansion ships
