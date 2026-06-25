export type WatchdogDecision =
  | "continue"
  | "loop_detected"
  | "tool_loop_detected"
  | "state_regression"
  | "limit_reached";

export interface WatchdogConfig {
  maxIterations?: number;
  similarityThreshold?: number;
  toolCallThreshold?: number;
  windowSize?: number;
}

export interface WatchdogToolCall {
  name: string;
  args: unknown;
  id?: string;
}

export interface WatchdogState {
  messages: Array<{ content: unknown; tool_calls?: WatchdogToolCall[] }>;
  iteration: number;
  [key: string]: unknown;
}

export interface WatchdogReport {
  trigger: WatchdogDecision;
  iterations: number;
  similarity: number;
  toolSimilarity: number;
  loopingTool: string | null;
  messageCount: number;
  lastExchange: Array<{ role: string; snippet: string }>;
  diagnosis: string;
  action: string;
}
