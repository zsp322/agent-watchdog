/**
 * Example: AI Debate — Optimist vs Pessimist
 *
 * Two agents debate AI's impact on humanity. Agent Watchdog monitors the
 * conversation and halts the graph when agents start recycling arguments
 * or when the iteration cap is hit.
 */
import { Annotation, StateGraph, END, START } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { AgentWatchdog, createWatchdogRouter } from "../src";

// ── State ────────────────────────────────────────────────────────────────────
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
});

type S = typeof StateAnnotation.State;

// ── Helpers ──────────────────────────────────────────────────────────────────
function contentToString(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  return (content as Array<{ text?: string }>).map((b) => b.text ?? "").join("");
}

function lastContent(state: S): string {
  const last = state.messages[state.messages.length - 1];
  return last ? contentToString(last.content as string | unknown[]) : "Let's debate: Is AI good or bad for humanity?";
}

// ── Model ────────────────────────────────────────────────────────────────────
const model = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", maxTokens: 200 });

// ── Agents ───────────────────────────────────────────────────────────────────
async function optimistAgent(state: S): Promise<Partial<S>> {
  const response = await model.invoke([
    new SystemMessage("You are an AI Optimist. Argue AI is beneficial to humanity. Max 3 sentences. Be direct."),
    new HumanMessage(lastContent(state)),
  ]);
  const text = contentToString(response.content as string | unknown[]);
  console.log(`\n[Optimist — round ${state.iteration + 1}]\n${text}`);
  return { messages: [new AIMessage({ content: text, name: "Optimist" })], iteration: state.iteration + 1 };
}

async function pessimistAgent(state: S): Promise<Partial<S>> {
  const response = await model.invoke([
    new SystemMessage("You are an AI Pessimist. Argue AI poses serious risks to humanity. Max 3 sentences. Be direct."),
    new HumanMessage(lastContent(state)),
  ]);
  const text = contentToString(response.content as string | unknown[]);
  console.log(`\n[Pessimist — round ${state.iteration + 1}]\n${text}`);
  return { messages: [new AIMessage({ content: text, name: "Pessimist" })], iteration: state.iteration + 1 };
}

// ── Graph ─────────────────────────────────────────────────────────────────────
const watchdog = new AgentWatchdog({ maxIterations: 10, similarityThreshold: 0.55, windowSize: 4 });
const router = createWatchdogRouter(watchdog, "optimist");

const app = new StateGraph(StateAnnotation)
  .addNode("optimist", optimistAgent)
  .addNode("pessimist", pessimistAgent)
  .addEdge(START, "optimist")
  .addEdge("optimist", "pessimist")
  .addConditionalEdges("pessimist", router, { optimist: "optimist", [END]: END })
  .compile();

// ── Run ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("  AGENT WATCHDOG DEMO");
  console.log("  Topic: Is AI beneficial or harmful to humanity?");
  console.log("=".repeat(60));

  await app.invoke({
    messages: [new HumanMessage("Let's debate: Is AI good or bad for humanity?")],
    iteration: 0,
  });

  console.log("\nDemo complete.");
}

main().catch(console.error);
