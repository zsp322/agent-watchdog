# agent-watchdog — Technical Architecture

## What we're building

agent-watchdog is a **runtime safety layer** for multi-agent AI systems. It sits inside a running AI graph and watches for failure patterns — specifically, cases where agents get stuck in loops that consume tokens indefinitely without making progress.

The analogy is a circuit breaker in distributed systems. A circuit breaker doesn't prevent failures; it detects them quickly and stops the damage from spreading. agent-watchdog does the same thing for AI agent graphs.

---

## The core problem

Modern AI agent frameworks (like LangGraph) let you connect multiple AI agents together in a graph. Agent A produces output, sends it to Agent B, B responds, that goes back to A, and so on. This works well when agents make progress. It fails badly when they don't.

Three failure patterns are common:

**Argument loops** — Two agents debate the same point in slightly different words. Agent A argues "X is good because Y." Agent B counters "Y doesn't hold because Z." Agent A restates the same point with different phrasing. Neither agent has an exit condition, so this continues until you run out of money.

**Tool call loops** — An agent calls a search tool, doesn't find what it wants, calls the same search tool again with nearly identical parameters, still doesn't find it, calls it again. The agent is stuck but doesn't know it.

**State regression** — The graph produces output that is identical (or nearly identical) to output it produced several iterations ago. The graph is going in circles.

The problem with all three is that existing observability tools (LangSmith, AgentOps) show you the logs *after the run completes*. By then, you've already burned tokens and possibly hit your budget limit. agent-watchdog intervenes *during* the run.

---

## How it fits into LangGraph

LangGraph represents an agent pipeline as a directed graph. Nodes are agents (functions that take state and return state updates). Edges connect nodes and determine routing.

**Conditional edges** are the key integration point. Instead of routing Agent B's output directly back to Agent A, you route it through a function that decides where to go next. That function can return `"agent_a"` to continue, or `END` to stop the graph.

```
Agent B  →  [routing function]  →  Agent A   (continue)
                                →  END        (intervene)
```

agent-watchdog provides `createWatchdogRouter()`, which wraps this routing function. Every time the graph cycles back to this edge, the watchdog runs its checks on the current state. If everything looks healthy, it routes to the next node. If it detects a problem, it routes to `END` and emits an intervention report.

```typescript
graph.addConditionalEdges("agent_b", createWatchdogRouter(watchdog, "agent_a"), {
  agent_a: "agent_a",
  [END]: END,
});
```

---

## Detection algorithms

The `AgentWatchdog.check()` method runs four checks in order, from cheapest to most expensive.

### Check 1: Iteration limit

```
if state.iteration >= maxIterations → "limit_reached"
```

The simplest check. If the graph has cycled more than `maxIterations` times (default: 10), halt regardless of content. This is the hard safety cap — no matter what the other checks say, the graph cannot run forever.

### Check 2: State regression

```
hash = SHA-256(last N messages)
if hash in seenHashes → "state_regression"
seenHashes.add(hash)
```

On every cycle, we take the last `windowSize` messages, concatenate their text content, and compute a SHA-256 hash. We store every hash we've seen so far (in `this.seenHashes`). If the current hash matches a previous one, the graph has produced identical output to a previous iteration — it's going in circles.

This is an *exact* match check. It catches cases where agents produce literally the same text repeatedly. For near-identical output (same ideas, slightly different words), the next check handles that.

Note: we hash only the sliding window of recent messages, not all messages. LangGraph state is append-only — the total message list grows every cycle, so a hash of everything would never repeat. By hashing only the last N messages, we're asking: "has this specific pattern of responses happened before?"

### Check 3: Argument loop (Jaccard similarity)

```
recent   = last N message texts
previous = N message texts before that
score    = average Jaccard(recent[i], previous[i])
if score >= similarityThreshold → "loop_detected"
```

Jaccard similarity measures the overlap between two sets of words:

```
Jaccard(A, B) = |A ∩ B| / |A ∪ B|
```

For example:
- "AI will save humanity through better medicine" → word set: {ai, will, save, humanity, through, better, medicine}
- "AI saves humans via improved medical care" → word set: {ai, saves, humans, via, improved, medical, care}
- Intersection: {ai} → size 1
- Union: 13 unique words → size 13
- Score: 1/13 ≈ 0.08 — low similarity, different ideas

Versus:
- "AI will save humanity through better medicine"
- "AI will save humanity through superior medicine and research"
- Intersection: {ai, will, save, humanity, through, medicine} → size 6
- Union: 10 unique words → size 10
- Score: 6/10 = 0.60 — above our 0.55 threshold → loop detected

We compute this pairwise across corresponding messages in the two windows, then average. This catches agents who are rephrasing the same argument without making progress.

### Check 4: Tool call loop

```
calls = all tool_calls extracted from messages
recent_calls = last N tool calls
previous_calls = N tool calls before that

find most-repeated tool name in recent_calls
compare its args across windows using Jaccard
if score >= toolCallThreshold → "tool_loop_detected"
```

In LangGraph, when an AI agent calls a tool, the `AIMessage` has a `tool_calls` field — an array of `{ name, args, id }` objects. We extract all of these across the message history.

We find the tool that appears most frequently in the recent window (the likely culprit), then compare its arguments between the recent and previous windows using Jaccard similarity on the stringified args.

For example, if an agent calls `search(query: "climate change effects on economy")` in rounds 5, 6, 7, and 8, with slight variations in phrasing each time, the arg similarity will be high and the tool call loop is detected.

---

## Data flow

```
graph cycle starts
       ↓
createWatchdogRouter() fires
       ↓
AgentWatchdog.check(state)
       ↓
  ┌─── iteration >= maxIterations? ──→ "limit_reached"
  │
  ├─── window hash seen before? ──────→ "state_regression"
  │    (store hash if new)
  │
  ├─── Jaccard score >= threshold? ───→ "loop_detected"
  │
  ├─── tool call Jaccard >= threshold? → "tool_loop_detected"
  │
  └─── all clear ─────────────────────→ "continue"
       ↓
  "continue"           →  route to next node
  anything else        →  generate report, route to END
```

---

## The intervention report

When the watchdog triggers, it generates a report — either as a human-readable string (`report()`) or a structured object (`reportJson()`).

The structured version (`WatchdogReport`) is designed to be piped into logging systems:

```typescript
{
  trigger: "loop_detected",         // what fired
  iterations: 8,                    // how many cycles ran
  similarity: 71.0,                 // argument similarity %
  toolSimilarity: 0.0,              // tool arg similarity %
  loopingTool: null,                // which tool looped (if any)
  messageCount: 17,                 // total messages in state
  lastExchange: [                   // last 4 messages, truncated
    { role: "Optimist", snippet: "While AI accelerates..." },
    { role: "Pessimist", snippet: "The acceleration you..." },
    ...
  ],
  diagnosis: "agents are recycling the same arguments.",
  action: "graph halted. No further tokens consumed."
}
```

---

## Stateful vs. stateless design

Most of the watchdog is stateless — it reads the graph state passed in, runs a calculation, and returns a decision. The exception is state regression detection, which requires memory across cycles (`seenHashes`).

This means a single `AgentWatchdog` instance accumulates hashes across its lifetime. If you reuse the same instance across multiple independent conversations or runs, call `watchdog.reset()` between them to clear the hash history. If you create a new `AgentWatchdog` per run, this is handled automatically.

---

## Configuration reference

```typescript
new AgentWatchdog({
  maxIterations: 10,       // hard cap on cycles before forced halt
  similarityThreshold: 0.55, // Jaccard score above which argument loop fires
  toolCallThreshold: 0.7,    // Jaccard score above which tool call loop fires
  windowSize: 4,             // N messages in each comparison window
})
```

Higher `similarityThreshold` = more tolerant of repetition, fewer false positives.
Lower `windowSize` = detects loops sooner, but may false-positive on short exchanges.

---

## What's next (v0.3)

The current system detects problems and halts. The next layer adds *control*:

- **Human-in-the-loop pause** — instead of halting immediately, pause the graph and wait for a human to approve or reject the intervention
- **Token budget monitoring** — halt or warn when cumulative token consumption exceeds a configured limit
- **Webhook notifications** — push intervention reports to Slack or any HTTP endpoint without requiring custom callback code
