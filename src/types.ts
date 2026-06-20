export type WatchdogDecision = "continue" | "loop_detected" | "limit_reached";

export interface WatchdogConfig {
  maxIterations?: number;
  similarityThreshold?: number;
  windowSize?: number;
}

export interface WatchdogState {
  messages: Array<{ content: unknown }>;
  iteration: number;
  [key: string]: unknown;
}
