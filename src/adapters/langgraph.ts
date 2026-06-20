import { END } from "@langchain/langgraph";
import { AgentWatchdog } from "../watchdog";
import type { WatchdogState } from "../types";

/**
 * Returns a conditional edge routing function for use with LangGraph's
 * `addConditionalEdges`. Routes to `nextNode` while safe; routes to END
 * when the watchdog triggers.
 *
 * @example
 * const watchdog = new AgentWatchdog({ maxIterations: 10 });
 * graph.addConditionalEdges("agent_b", createWatchdogRouter(watchdog, "agent_a"), {
 *   agent_a: "agent_a",
 *   [END]: END,
 * });
 */
export function createWatchdogRouter(
  watchdog: AgentWatchdog,
  nextNode: string,
  onIntervene?: (report: string) => void
) {
  return function route(state: WatchdogState): string {
    const decision = watchdog.check(state);
    if (decision !== "continue") {
      const report = watchdog.report(state, decision);
      if (onIntervene) {
        onIntervene(report);
      } else {
        console.log("\n" + report);
      }
      return END;
    }
    return nextNode;
  };
}
