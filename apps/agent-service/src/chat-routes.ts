import type { ExecutionControl } from "./execution-control.js";
import { BytesLineDecoder, SSEDecoder } from "@langchain/langgraph-sdk/utils";
import { setTimeout as delay } from "node:timers/promises";
import { quoteModel, generationCost, type Quote } from "./accounting.js";
import type { TaskLedger, TaskRecord } from "./task-ledger.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import type { MetadataStore } from "./metadata.js";

/** Narrow admission around the maintained HTTP stream, not a second protocol. */
export function chatRoutes(
  framework: ReturnType<typeof createEmbedServer>,
  metadata: MetadataStore,
  tasks: TaskLedger,
  streams = new Set<string>(),
  execution?: ExecutionControl,
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
    const request = body as {
      assistant_id?: unknown;
      metadata?: { task_id?: unknown };
      stream_mode?: unknown;
      input?: unknown;
    } | null;
    if (
      !request ||
      typeof request !== "object" ||
      Object.keys(request).some(
        (k) =>
          !["assistant_id", "metadata", "stream_mode", "input"].includes(k),
      ) ||
      request.assistant_id !== "general-chat" ||
      (request.input !== undefined && request.input !== null) ||
      !request.metadata ||
      Object.keys(request.metadata).join() !== "task_id" ||
      typeof request.metadata.task_id !== "string"
    )
      return c.json(
        { error: "Submit a task with its allowance before opening its stream" },
        400,
      );
    const taskId = request.metadata.task_id;
    let task: TaskRecord;
    try {
      task = tasks.get(taskId);
    } catch {
      return c.json({ error: "Task not found" }, 404);
    }
    if (
      task.thread_id !== thread.thread_id ||
      task.state !== "queued" ||
      streams.has(taskId)
    )
      return c.json(
        {
          error:
            "Task is not queued or already has a stream. Refresh its state.",
        },
        409,
      );
    if (typeof thread.metadata.model !== "string")
      return c.json({ error: "This chat has no model" }, 409);
    streams.add(taskId);
    let quote: Quote;
    try {
      const queueSignal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(300000),
      ]);
      while (true) {
        queueSignal.throwIfAborted();
        tasks.expireUnattached(streams);
        const all = tasks.list();
        if (
          all.find((t) => t.state === "queued")?.id !== taskId ||
          all.filter((t) => ["running", "stopping"].includes(t.state)).length >=
            2
        ) {
          await delay(200, undefined, { signal: queueSignal });
          continue;
        }
        quote = await quoteModel(thread.metadata.model);
        queueSignal.throwIfAborted();
        task = tasks.get(taskId);
        const admitted = tasks.admit(taskId, task.revision, quote.estimate);
        if (!admitted) continue;
        task = admitted;
        if (task.state === "awaiting_approval") {
          streams.delete(taskId);
          return c.json(
            { error: "Allowance increase required. Review the task." },
            409,
          );
        }
        break;
      }
    } catch {
      streams.delete(taskId);
      if (c.req.raw.signal.aborted) tasks.interruptQueued(taskId);
      else tasks.failQueued(taskId);
      return c.json(
        {
          error:
            "Pricing or queue admission unavailable. No model request sent.",
        },
        409,
      );
    }
    const messages = [{ type: "human", content: task.instruction }];
    const admissionId = task.attempt_id!;
    try {
      metadata.createRun(thread.thread_id, admissionId);
      metadata.markRunning(admissionId);
    } catch {
      tasks.settle(task.id, admissionId, task.revision, 0, false);
      streams.delete(taskId);
      return c.json(
        { error: "This chat has unfinished work. No new request was sent." },
        409,
      );
    }
    let graphDispatched = false;
    const finish = async (succeeded: boolean) => {
      try {
        if (graphDispatched) await execution?.drained(admissionId);
        const current = tasks.get(taskId);
        if (!["running", "stopping"].includes(current.state)) return;
        // Release execution capacity even when the provider has not published billing yet.
        const waiting = tasks.settle(
          taskId,
          admissionId,
          current.revision,
          !graphDispatched ||
            (current.provider_attempts > 0 && current.reserved === 0)
            ? 0
            : null,
          succeeded,
        );
        if (waiting.generation_id) {
          const claim = tasks.claimLookup(taskId, waiting.revision);
          const cost = await generationCost(claim.generation_id!);
          if (cost !== null)
            tasks.reconcile(taskId, admissionId, waiting.revision, cost);
        }
      } finally {
        streams.delete(taskId);
        execution?.release(admissionId);
      }
    };
    const controller = new AbortController();
    execution?.register(admissionId, controller);
    const signal = AbortSignal.any([
      c.req.raw.signal,
      controller.signal,
      AbortSignal.timeout(90000),
    ]);
    signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      await metadata.set(thread.thread_id, {
        kind: "patch",
        metadata: {
          title: task.instruction.slice(0, 60),
          admission_id: admissionId,
        },
      });
      graphDispatched = true;
      const response = await framework.fetch(
        new Request(c.req.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            assistant_id: "general-chat",
            // Reset the native per-invocation counter even if the previous run
            // failed before its afterAgent hook. Client state is never accepted.
            input: { messages, runModelCallCount: 0 },
            stream_mode: ["messages", "values"],
            context: {
              model: thread.metadata.model,
              admissionId,
              provider: quote.provider,
              runLimit: 1,
              exitBehavior: "error",
            },
            config: {
              recursion_limit: 8,
              tags: [`task-execution:${admissionId}`],
            },
          }),
        }),
      );
      if (!response.ok || !response.body) {
        // Embedded validation/not-found responses precede graph execution.
        if ([400, 404, 422].includes(response.status)) graphDispatched = false;
        metadata.finishRun(admissionId, "error");
        await finish(false);
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
            if (part.event.startsWith("messages") || part.event === "values") {
              const data =
                typeof part.data === "string"
                  ? JSON.parse(part.data)
                  : part.data;
              const message = Array.isArray(data)
                ? data[0]
                : data?.messages?.at(-1);
              if (
                message?.type === "ai" &&
                typeof message.id === "string" &&
                message.id.startsWith("gen-")
              )
                tasks.recordGeneration(taskId, admissionId, message.id);
            }
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
              await finish(
                completed &&
                  !failed &&
                  !signal.aborted &&
                  metadata.getRun(admissionId)?.status === "success",
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
      await finish(false);
      return c.json({ error: "Chat could not start" }, 502);
    }
  });
  return app;
}
