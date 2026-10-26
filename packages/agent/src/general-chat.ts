import { ChatOpenRouter } from "@langchain/openrouter";
import { createDeepAgent } from "deepagents";
import { readOpenRouterApiKey } from "./credentials.js";
import { chatOnlyPolicy } from "./chat-policy.js";

// A framework graph factory: the development server owns threads and runs.
// No invocation, host filesystem backend or provider request happens on import.
export async function createGeneralChatAgent() {
  const model = process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error(
      "Set OPENROUTER_MODEL to the OpenRouter model you want to use.",
    );
  }

  // Run routes stay disabled until M1-02 service admission is qualified.
  // The pinned harness cannot resolve a profile for ChatOpenRouter instances.
  return createDeepAgent({
    name: "general-chat",
    model: new ChatOpenRouter({ model, apiKey: await readOpenRouterApiKey() }),
    subagents: [],
    middleware: [chatOnlyPolicy],
    permissions: [
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
    systemPrompt:
      "Answer the user's questions clearly. No external tools are configured.",
  });
}
