# Agent Watchdog

**Runtime loop and deadlock detection for multi-agent AI systems.**

[![npm version](https://img.shields.io/npm/v/agent-watchdog)](https://www.npmjs.com/package/agent-watchdog)
[![license](https://img.shields.io/npm/l/agent-watchdog)](LICENSE)

---

## The problem

Multi-agent pipelines fail in ways that are hard to see from the outside:

- **Argument loops** — two agents debate the same point in different words, burning tokens indefinitely
- **Silent deadlocks** — agents wait on each other and never produce output
- **Runaway iterations** — a graph cycles forever because no exit condition was met

Existing tools like LangSmith and AgentOps show you what happened *after the fact*. Agent Watchdog **intervenes at runtime** — the same way a circuit breaker works in distributed systems.

---

## Install

```bash
npm install agent-watchdog
```

> Requires `@langchain/langgraph` and `@langchain/core` as peer dependencies.

---

## Quick start

```typescript
import { AgentWatchdog, createWatchdogRouter } from "agent-watchdog";
import { END } from "@langchain/langgraph";

const watchdog = new AgentWatchdog({
  maxIterations: 10,
  similarityThreshold: 0.55, // halt if recent messages are 55%+ similar to previous
  windowSize: 4,
});

// Drop into any LangGraph conditional edge
const router = createWatchdogRouter(watchdog, "agent_a");

graph.addConditionalEdges("agent_b", router, {
  agent_a: "agent_a",
  [END]: END,
});
```

---

## Demo

Run two AI agents debating whether AI is good or bad. The watchdog monitors the conversation and halts when they start recycling arguments.

```bash
git clone https://github.com/your-handle/agent-watchdog
cd agent-watchdog && npm install
ANTHROPIC_API_KEY=your_key npm run example:debate
```

**Output:**

```
============================================================
  AGENT WATCHDOG DEMO
  Topic: Is AI beneficial or harmful to humanity?
============================================================

[Optimist — round 1]
AI will drive tremendous progress in medicine, scientific discovery, and solving
complex problems like climate change. It's already accelerating drug development,
improving diagnostics, and automating dangerous work, freeing humans for more
creative pursuits. The risks require careful governance, but rejecting this
technology would mean abandoning solutions to humanity's greatest challenges.

[Pessimist — round 2]
AI systems pursuing misaligned objectives at scale could cause irreversible harm
faster than we can respond — we're building increasingly powerful tools whose
decision-making we don't fully understand. The promised benefits in medicine and
climate are speculative, while near-term harms are concrete: mass surveillance,
labor displacement, and weapons systems removing human judgment from lethal
decisions. Responsible AI governance isn't happening at the speed or depth needed.

[Optimist — round 3]
AI's benefits are already concrete and accelerating: real lives saved through
diagnostic AI, climate modeling improving energy efficiency now, and accessibility
tools enabling disabled individuals daily. The risks are real but solvable through
transparency, technical safety research, and international coordination.

... (continues for several rounds)

[Pessimist — round 8]
We've already created dependency that makes retreat impossible and failure
catastrophic simultaneously. We're now locked into deploying increasingly capable
systems we don't understand into domains where errors compound — financial systems,
power grids, military decisions.

============================================================
  AGENT WATCHDOG — INTERVENTION REPORT
============================================================
  Trigger    : loop_detected
  Iterations : 8
  Similarity : 71%  (threshold: 55%)
  Messages   : 9

  Last exchange:
    [Optimist] While AI accelerates scientific discovery, we must ensure equit...
    [Pessimist] The acceleration you describe comes at the cost of concentrating...
    [Optimist] Equitable access is precisely why open-source AI development mat...
    [Pessimist] Open-source development doesn't solve the compute access problem...

  Diagnosis : agents are recycling the same arguments.
  Action    : graph halted. No further tokens consumed.
============================================================
```

The watchdog correctly identifies that both agents are rephrasing the same core arguments and intervenes — stopping token consumption before the debate loops indefinitely.

---

## API

### `new AgentWatchdog(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `10` | Hard cap on graph cycles |
| `similarityThreshold` | `number` | `0.55` | Jaccard similarity above which a loop is declared |
| `windowSize` | `number` | `4` | Number of messages in each comparison window |

**Methods:**

```typescript
watchdog.check(state)           // → "continue" | "loop_detected" | "limit_reached"
watchdog.similarity(state)      // → number (0–1), current similarity score
watchdog.report(state, decision) // → string, human-readable intervention report
```

### `createWatchdogRouter(watchdog, nextNode, onIntervene?)`

Returns a LangGraph conditional edge routing function.

- Routes to `nextNode` while the graph is healthy
- Routes to `END` and calls `onIntervene(report)` when the watchdog triggers
- If `onIntervene` is omitted, the report is printed to stdout

```typescript
const router = createWatchdogRouter(watchdog, "agent_a", (report) => {
  myLogger.warn(report); // send to your logging system
});
```

---

## How detection works

Agent Watchdog compares two sliding windows of messages using **Jaccard word-set similarity**:

```
recent   = last N messages
previous = N messages before that
score    = average pairwise Jaccard(recent[i], previous[i])
```

A score above `similarityThreshold` means agents are recycling the same vocabulary — a reliable signal of argumentative looping even when the exact wording differs.

---

## Roadmap

- [ ] Deadlock detection (mutual wait / no-output detection)
- [ ] Token budget monitoring with early-warning callbacks
- [ ] Pluggable similarity backends (embeddings, TF-IDF)
- [ ] CrewAI and AutoGen adapters

---

## License

MIT
