import type { WatchdogConfig, WatchdogDecision, WatchdogState } from "./types";

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

export class AgentWatchdog {
  private maxIterations: number;
  private similarityThreshold: number;
  private window: number;

  constructor(config: WatchdogConfig = {}) {
    this.maxIterations = config.maxIterations ?? 10;
    this.similarityThreshold = config.similarityThreshold ?? 0.55;
    this.window = config.windowSize ?? 4;
  }

  check(state: WatchdogState): WatchdogDecision {
    if (state.iteration >= this.maxIterations) return "limit_reached";
    const score = semanticLoopScore(state.messages, this.window);
    if (score >= this.similarityThreshold) return "loop_detected";
    return "continue";
  }

  similarity(state: WatchdogState): number {
    return semanticLoopScore(state.messages, this.window);
  }

  report(state: WatchdogState, reason: WatchdogDecision): string {
    const score = semanticLoopScore(state.messages, this.window);
    const lastFour = state.messages.slice(-4);
    const lines = [
      "=".repeat(60),
      "  AGENT WATCHDOG — INTERVENTION REPORT",
      "=".repeat(60),
      `  Trigger    : ${reason}`,
      `  Iterations : ${state.iteration}`,
      `  Similarity : ${(score * 100).toFixed(0)}%  (threshold: ${(this.similarityThreshold * 100).toFixed(0)}%)`,
      `  Messages   : ${state.messages.length}`,
      "",
      "  Last exchange:",
      ...lastFour.map((m) => {
        const role = ("name" in m ? (m as { name?: string }).name : undefined) ?? m.constructor?.name ?? "Agent";
        const snippet = extractText(m.content).slice(0, 120).replace(/\n/g, " ");
        return `    [${role}] ${snippet}...`;
      }),
      "",
      `  Diagnosis : ${reason === "loop_detected" ? "agents are recycling the same arguments." : "hard iteration cap reached."}`,
      "  Action    : graph halted. No further tokens consumed.",
      "=".repeat(60),
    ];
    return lines.join("\n");
  }
}
