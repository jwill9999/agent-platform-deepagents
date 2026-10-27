import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createGeneralChatAgent } from "../packages/agent/src/general-chat.js";

beforeEach(() => {
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "environment");
  vi.stubEnv("OPENROUTER_API_KEY", "invalid-synthetic");
  vi.stubEnv("OPENROUTER_MODEL", "synthetic/no-provider-call");
  vi.stubEnv("LANGSMITH_TRACING", "false");
  vi.stubEnv("LANGSMITH_TRACING_V2", "false");
});
afterEach(() => vi.unstubAllGlobals());

// Added after the factory's bounded live reply/reopened-checkpoint checks.
// Fault injection protects our dispatch policy; no provider call is permitted.
test.each(["task", "write_file"])(
  "hides tool schemas and rejects a model's attempted %s dispatch",
  async (name) => {
    const network = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.tools ?? []).toEqual([]);
      if (network.mock.calls.length > 1)
        throw new Error("Unexpected second model request");
      return Response.json({
        id: "synthetic",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "blocked",
                  type: "function",
                  function: {
                    name,
                    arguments: JSON.stringify(
                      name === "task"
                        ? {
                            description: "Must not execute",
                            subagent_type: "general-purpose",
                          }
                        : { file_path: "/blocked.txt", content: "blocked" },
                    ),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", network);
    const agent = await createGeneralChatAgent();
    await expect(
      agent.invoke(
        { messages: [{ role: "user", content: "Policy regression" }] },
        { recursionLimit: 4, signal: AbortSignal.timeout(5000) },
      ),
    ).rejects.toThrow("Tools are disabled for this General Chat connection.");
    expect(network).toHaveBeenCalledOnce();
  },
);
