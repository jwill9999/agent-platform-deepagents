import { ChatOpenRouter } from "@langchain/openrouter";
import { createDeepAgent } from "deepagents";
import { createMiddleware, modelCallLimitMiddleware } from "langchain";
import { z } from "zod";
import { readOpenRouterApiKey } from "./credentials.js";
import { chatOnlyPolicy } from "./chat-policy.js";

// Only the service constructs this context. It is never forwarded from clients.
const contextSchema = z.object({
  model: z.string().min(1),
  admissionId: z.string(),
  provider: z
    .object({
      only: z.array(z.string()).min(1),
      allow_fallbacks: z.literal(false),
      require_parameters: z.literal(true),
      max_price: z.object({
        prompt: z.string(),
        completion: z.string(),
        request: z.string(),
      }),
    })
    .optional(),
});
export async function createServiceAgent(onFailure: (id: string) => void) {
  const selection = createMiddleware({
    name: "SavedChatModel",
    contextSchema,
    wrapModelCall: async (request, handler) => {
      try {
        const model = new ChatOpenRouter({
          model: request.runtime.context.model,
          apiKey: await readOpenRouterApiKey(),
          maxRetries: 0,
          maxTokens: 512,
          modelKwargs: { reasoning: { enabled: false } },
          provider: request.runtime.context.provider ?? {
            allow_fallbacks: false,
          },
        });
        return await handler({ ...request, model, tools: [] });
      } catch {
        onFailure(request.runtime.context.admissionId);
        // The embedded API serialises graph errors inside SSE. Never forward
        // provider responses, credentials, request bodies or native-store errors.
        throw new Error(
          "The model could not complete this reply. Check your connection and selected model.",
        );
      }
    },
  });
  return createDeepAgent({
    name: "general-chat",
    // A dormant model instance lets first-run setup start without a credential.
    // Every actual call replaces it through the public model middleware hook.
    model: new ChatOpenRouter({
      model: "unconfigured",
      apiKey: "unconfigured",
    }),
    middleware: [modelCallLimitMiddleware(), selection, chatOnlyPolicy],
    subagents: [],
    permissions: [
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
    systemPrompt:
      "Answer the user's questions clearly. No external tools are configured.",
  });
}
