import { ChatOpenRouter } from "@langchain/openrouter";
import { createDeepAgent } from "deepagents";
import {
  createMiddleware,
  modelCallLimitMiddleware,
  modelRetryMiddleware,
} from "langchain";
import {
  safePreDispatchFailure,
  type ExecutionPolicy,
} from "./retry-policy.js";
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
export async function createServiceAgent(
  onFailure: (id: string) => void,
  policy?: ExecutionPolicy,
) {
  const retryable = new WeakSet<Error>();
  const terminal = createMiddleware({
    name: "TaskExecutionBoundary",
    contextSchema,
    wrapModelCall: async (request, handler) => {
      const id = request.runtime.context.admissionId;
      policy?.enter(id);
      try {
        return await handler(request);
      } catch {
        onFailure(id);
        throw new Error(
          "The model could not complete this reply. Review the task status before sending another instruction.",
        );
      } finally {
        policy?.leave(id);
      }
    },
  });
  const retry = modelRetryMiddleware({
    maxRetries: 2,
    initialDelayMs: 1000,
    maxDelayMs: 2000,
    backoffFactor: 2,
    jitter: false,
    onFailure: "error",
    retryOn: (error) => {
      // Public middleware composition wraps hook failures with their cause.
      let cause: unknown = error;
      for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
        if (retryable.has(cause)) return true;
        cause = cause.cause;
      }
      return false;
    },
  });
  const selection = createMiddleware({
    name: "SavedChatModel",
    contextSchema,
    wrapModelCall: async (request, handler) => {
      try {
        request.runtime.signal?.throwIfAborted();
        const model = new ChatOpenRouter({
          model: request.runtime.context.model,
          apiKey: await readOpenRouterApiKey(),
          maxRetries: 0,
          maxTokens: 512,
          callbacks: [
            {
              handleLLMNewToken: (token: string) =>
                policy?.token(request.runtime.context.admissionId, token),
            },
          ],
          modelKwargs: { reasoning: { enabled: false } },
          provider: request.runtime.context.provider ?? {
            allow_fallbacks: false,
          },
        });
        request.runtime.signal?.throwIfAborted();
        policy?.beforeAttempt(request.runtime.context.admissionId);
        return await handler({ ...request, model, tools: [] });
      } catch (error) {
        if (
          !request.runtime.signal?.aborted &&
          safePreDispatchFailure(error) &&
          policy?.rejectedBeforeDispatch(request.runtime.context.admissionId)
        ) {
          const safe = new Error("Connection could not be established");
          retryable.add(safe);
          throw safe;
        }
        throw error;
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
    middleware: [
      modelCallLimitMiddleware(),
      terminal,
      retry,
      selection,
      chatOnlyPolicy,
    ],
    subagents: [],
    permissions: [
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
    systemPrompt:
      "Answer the user's questions clearly. No external tools are configured.",
  });
}
