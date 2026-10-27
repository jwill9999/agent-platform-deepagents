import { BytesLineDecoder, SSEDecoder } from "@langchain/langgraph-sdk/utils";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import type { MetadataStore } from "./metadata.js";

/** Narrow admission around the maintained HTTP stream, not a second protocol. */
export function chatRoutes(
  framework: ReturnType<typeof createEmbedServer>,
  metadata: MetadataStore,
) {
  const app = new Hono();
  app.post("/threads", async (c) => {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== "object" || Object.keys(body).length)
      return c.json({ error: "New chat takes no overrides" }, 400);
    const defaults = metadata.getDefaults();
    if (!defaults) return c.json({ error: "Choose model defaults first" }, 409);
    const id = randomUUID();
    return c.json(
      await metadata.set(id, {
        kind: "put",
        metadata: { model: defaults.general, title: "New chat" },
      }),
    );
  });
  app.post("/threads/:id/runs/stream", async (c) => {
    const thread = await metadata.get(c.req.param("id"));
    const body: unknown = await c.req.json();
    // The SDK may supply assistant_id/stream_mode; their values never become authority.
    const request = body as {
      assistant_id?: unknown;
      input?: { messages?: { type?: unknown; content?: unknown }[] };
      stream_mode?: unknown;
    } | null;
    const messages = request?.input?.messages;
    if (
      !request ||
      typeof request !== "object" ||
      Object.keys(request).some(
        (k) => !["assistant_id", "input", "stream_mode"].includes(k),
      ) ||
      request.assistant_id !== "general-chat" ||
      !request.input ||
      Object.keys(request.input).join() !== "messages" ||
      !Array.isArray(messages) ||
      messages.length !== 1 ||
      !messages[0] ||
      Object.keys(messages[0]).some((k) => !["type", "content"].includes(k)) ||
      messages[0].type !== "human" ||
      typeof messages[0].content !== "string" ||
      !messages[0].content.trim() ||
      messages[0].content.length > 8000
    )
      return c.json(
        { error: "Send one plain text human message without overrides" },
        400,
      );
    if (typeof thread.metadata.model !== "string")
      return c.json({ error: "This chat has no selected model" }, 409);
    const admissionId = randomUUID();
    try {
      metadata.createRun(thread.thread_id, admissionId);
    } catch {
      return c.json(
        { error: "This chat has unfinished work. No new request was sent." },
        409,
      );
    }
    metadata.markRunning(admissionId);
    const controller = new AbortController();
    const signal = AbortSignal.any([
      c.req.raw.signal,
      controller.signal,
      AbortSignal.timeout(90000),
    ]);
    try {
      await metadata.set(thread.thread_id, {
        kind: "patch",
        metadata: {
          title: messages[0].content.slice(0, 60),
          admission_id: admissionId,
        },
      });
      const response = await framework.fetch(
        new Request(c.req.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            assistant_id: "general-chat",
            input: { messages },
            stream_mode: ["messages", "values"],
            context: { model: thread.metadata.model, admissionId },
            config: { recursion_limit: 8 },
          }),
        }),
      );
      if (!response.ok || !response.body) {
        metadata.finishRun(admissionId, "error");
        return c.json({ error: "Chat could not start" }, 502);
      }
      const [forward, inspect] = response.body.tee();
      let failed = false;
      const observed = (async () => {
        try {
          for await (const part of inspect
            .pipeThrough(BytesLineDecoder())
            .pipeThrough(SSEDecoder())) {
            if (part.event === "error") failed = true;
          }
        } catch {
          failed = true;
        }
      })();
      const reader = forward.getReader();
      // Hold admission until body completion/cancellation, not just response headers.
      // Chunks are forwarded unchanged; the framework owns the SSE wire format.
      const body = new ReadableStream<Uint8Array>({
        async start(output) {
          let completed = false;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) {
                completed = true;
                break;
              }
              output.enqueue(chunk.value);
            }
          } catch {
            controller.abort();
            try {
              output.error(new Error("Chat stream interrupted"));
            } catch {
              /* already cancelled */
            }
          } finally {
            reader.releaseLock();
            await observed;
            try {
              if (metadata.getRun(admissionId)?.status === "running")
                metadata.finishRun(
                  admissionId,
                  completed && !failed && !signal.aborted ? "success" : "error",
                );
              if (completed) output.close();
            } catch {
              try {
                output.error(new Error("Could not confirm saved run status"));
              } catch {
                /* cancelled */
              }
            }
          }
        },
        async cancel() {
          controller.abort();
          await reader.cancel();
        },
      });
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    } catch {
      if (metadata.getRun(admissionId)?.status === "running")
        metadata.finishRun(admissionId, "error");
      return c.json({ error: "Chat could not start" }, 502);
    }
  });
  return app;
}
