import { createHash } from "crypto";
import type { WatchdogConfig, WatchdogDecision, WatchdogReport, WatchdogState, WatchdogToolCall } from "./types";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "object" && b !== null && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("");
  }
  return String(content);
}

function jaccard(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function semanticLoopScore(messages: WatchdogState["messages"], window: number): number {
  if (messages.length < window * 2) return 0;
  const recent = messages.slice(-window).map((m) => extractText(m.content));
  const previous = messages.slice(-(window * 2), -window).map((m) => extractText(m.content));
  const scores = recent.map((r, i) => jaccard(r, previous[i]));
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function extractToolCalls(messages: WatchdogState["messages"]): WatchdogToolCall[] {
  const calls: WatchdogToolCall[] = [];
  for (const msg of messages) {
    if (Array.isArray(msg.tool_calls)) {
      calls.push(...msg.tool_calls);
    }
  }
  return calls;
}

function toolCallLoopScore(
  messages: WatchdogState["messages"],
  window: number
): { score: number; loopingTool: string | null } {
  const calls = extractToolCalls(messages);
  if (calls.length < window * 2) return { score: 0, loopingTool: null };

  const recent = calls.slice(-window);
  const previous = calls.slice(-(window * 2), -window);

  // find the most frequently repeated tool in the recent window
  const freq = new Map<string, number>();
  for (const c of recent) freq.set(c.name, (freq.get(c.name) ?? 0) + 1);

  let loopingTool: string | null = null;
  let maxCount = 0;
  for (const [name, count] of freq) {
    if (count > maxCount) { maxCount = count; loopingTool = name; }
  }

  if (!loopingTool) return { score: 0, loopingTool: null };

  // compare args of that tool between the two windows
  const recentArgs = recent.filter((c) => c.name === loopingTool).map((c) => JSON.stringify(c.args));
  const prevArgs = previous.filter((c) => c.name === loopingTool).map((c) => JSON.stringify(c.args));

  if (prevArgs.length === 0) return { score: 0, loopingTool };

  const argScores = recentArgs.map((r) =>
    Math.max(...prevArgs.map((p) => jaccard(r, p)))
  );
  const score = argScores.reduce((a, b) => a + b, 0) / argScores.length;

  return { score, loopingTool };
}

// Hash the most recent window of messages to detect revisited states.
// Uses a sliding window so the hash changes each cycle even as state grows.
function windowHash(messages: WatchdogState["messages"], window: number): string {
  const text = messages.slice(-window).map((m) => extractText(m.content)).join("|");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export class AgentWatchdog {
  private maxIterations: number;
  private similarityThreshold: number;
  private toolCallThreshold: number;
  private window: number;
  private seenHashes: Set<string>;

  constructor(config: WatchdogConfig = {}) {
    this.maxIterations = config.maxIterations ?? 10;
    this.similarityThreshold = config.similarityThreshold ?? 0.55;
    this.toolCallThreshold = config.toolCallThreshold ?? 0.7;
    this.window = config.windowSize ?? 4;
    this.seenHashes = new Set();
  }

  // Call between independent runs when reusing the same watchdog instance.
  reset(): void {
    this.seenHashes.clear();
  }

  check(state: WatchdogState): WatchdogDecision {
    if (state.iteration >= this.maxIterations) return "limit_reached";

    const hash = windowHash(state.messages, this.window);
    if (this.seenHashes.has(hash)) return "state_regression";
    this.seenHashes.add(hash);

    const similarity = semanticLoopScore(state.messages, this.window);
    if (similarity >= this.similarityThreshold) return "loop_detected";

    const { score: toolScore } = toolCallLoopScore(state.messages, this.window);
    if (toolScore >= this.toolCallThreshold) return "tool_loop_detected";

    return "continue";
  }

  similarity(state: WatchdogState): number {
    return semanticLoopScore(state.messages, this.window);
  }

  reportJson(state: WatchdogState, reason: WatchdogDecision): WatchdogReport {
    const score = semanticLoopScore(state.messages, this.window);
    const { score: toolScore, loopingTool } = toolCallLoopScore(state.messages, this.window);
    const lastFour = state.messages.slice(-4);

    const diagnosisMap: Record<WatchdogDecision, string> = {
      loop_detected: "agents are recycling the same arguments.",
      tool_loop_detected: `tool "${loopingTool}" is being called repeatedly with similar arguments.`,
      state_regression: "graph has returned to a previously visited state.",
      limit_reached: "hard iteration cap reached.",
      continue: "",
    };

    return {
      trigger: reason,
      iterations: state.iteration,
      similarity: parseFloat((score * 100).toFixed(1)),
      toolSimilarity: parseFloat((toolScore * 100).toFixed(1)),
      loopingTool,
      messageCount: state.messages.length,
      lastExchange: lastFour.map((m) => {
        const role =
          ("name" in m ? (m as { name?: string }).name : undefined) ??
          m.constructor?.name ??
          "Agent";
        return { role, snippet: extractText(m.content).slice(0, 120).replace(/\n/g, " ") };
      }),
      diagnosis: diagnosisMap[reason],
      action: "graph halted. No further tokens consumed.",
    };
  }

  report(state: WatchdogState, reason: WatchdogDecision): string {
    const data = this.reportJson(state, reason);
    const lines = [
      "=".repeat(60),
      "  AGENT WATCHDOG — INTERVENTION REPORT",
      "=".repeat(60),
      `  Trigger    : ${data.trigger}`,
      `  Iterations : ${data.iterations}`,
      `  Similarity : ${data.similarity}%  (threshold: ${(this.similarityThreshold * 100).toFixed(0)}%)`,
      ...(data.loopingTool
        ? [`  Tool Loop  : ${data.loopingTool} (${data.toolSimilarity}% arg similarity)`]
        : []),
      `  Messages   : ${data.messageCount}`,
      "",
      "  Last exchange:",
      ...data.lastExchange.map((e) => `    [${e.role}] ${e.snippet}...`),
      "",
      `  Diagnosis : ${data.diagnosis}`,
      `  Action    : ${data.action}`,
      "=".repeat(60),
    ];
    return lines.join("\n");
  }
}
