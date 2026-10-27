import { readOpenRouterApiKey } from "@harness/agent";
import { BytesLineDecoder, SSEDecoder } from "@langchain/langgraph-sdk/utils";
import type { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import { quoteModel, generationCost, type Quote } from "./accounting.js";
import type { MetadataStore } from "./metadata.js";
import type { TaskLedger, TaskRecord } from "./task-ledger.js";
import type { ExecutionControl } from "./execution-control.js";

/** Owns consumption of the maintained stream, independently of HTTP observers. */
export class TaskLifecycle {
  private closing = false;
  private requested = false;
  private pumping: Promise<void> | undefined;
  private readonly active = new Map<string, Promise<void>>();
  private readonly shutdownSignal = new AbortController();
  constructor(
    private readonly framework: ReturnType<typeof createEmbedServer>,
    private readonly metadata: MetadataStore,
    private readonly tasks: TaskLedger,
    private readonly execution: ExecutionControl,
  ) {}

  kick(): void {
    if (this.closing) return;
    if (this.pumping) {
      this.requested = true;
      return;
    }
    this.requested = false;
    this.pumping = this.pump()
      .catch(() => {
        console.error(
          "Task admission unavailable; saved work has not been replayed.",
        );
      })
      .finally(() => {
        this.pumping = undefined;
        if (this.requested) this.kick();
      });
  }

  private async pump(): Promise<void> {
    while (!this.closing && this.active.size < 2) {
      const task = this.tasks.list().find((t) => t.state === "queued");
      if (!task) return;
      try {
        const thread = await this.metadata.get(task.thread_id);
        if (typeof thread.metadata.model !== "string")
          throw new Error("Model unavailable");
        const quote = await quoteModel(thread.metadata.model);
        if (this.closing) return;
        const admitted = this.tasks.admit(
          task.id,
          task.revision,
          quote.estimate,
        );
        if (!admitted) return;
        if (admitted.state === "awaiting_approval") continue;
        const work = this.run(admitted, thread.metadata.model, quote)
          .catch(() => {
            /* Saved state remains authoritative; never replay. */
          })
          .finally(() => {
            this.active.delete(task.id);
            this.kick();
          });
        this.active.set(task.id, work);
      } catch {
        this.tasks.failQueued(task.id);
      }
    }
  }

  async resume(id: string, revision: number): Promise<TaskRecord> {
    if (this.closing) throw new Error("Service stopping");
    const task = this.tasks.get(id);
    // A duplicate request is safe even if its accepted attempt has already begun.
    if (this.tasks.hasResume(id, revision)) return this.tasks.get(id);
    this.tasks.assertResumable(task, revision);
    const response = await this.framework.request(
      `/threads/${task.thread_id}/state`,
    );
    if (!response.ok) throw new Error("Saved progress unavailable");
    const state = (await response.json()) as {
      values?: { messages?: { id?: string; type?: string }[] };
      next?: string[];
    };
    const messages = state.values?.messages ?? [];
    const index = messages.findIndex((m) => m.id === `task-${task.id}`);
    // Never resume a checkpoint belonging to a later instruction.
    if (index >= 0 && messages.slice(index + 1).some((m) => m.type === "human"))
      throw new Error("Checkpoint belongs to another task");
    if (index < 0 && task.provider_attempts > 0)
      throw new Error("Cannot associate legacy checkpoint with this task");
    const mode =
      index < 0 ? "input" : state.next?.length ? "checkpoint" : "complete";
    if (
      mode === "complete" &&
      !messages.slice(index + 1).some((m) => m.type === "ai")
    )
      throw new Error("No completed reply in checkpoint");
    if (mode !== "complete") await readOpenRouterApiKey();
    if (this.closing) throw new Error("Service stopping");
    const updated = this.tasks.resume(id, revision, mode);
    this.metadata.retireInterrupted(task.thread_id);
    this.kick();
    return updated;
  }

  private async run(
    task: TaskRecord,
    model: string,
    quote: Quote,
  ): Promise<void> {
    const run = task.attempt_id!;
    let succeeded = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      this.shutdownSignal.signal,
      AbortSignal.timeout(90000),
    ]);
    signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      this.metadata.retireInterrupted(task.thread_id);
      this.metadata.createRun(task.thread_id, run);
      this.metadata.markRunning(run);
      this.execution.register(run, controller);
      await this.metadata.set(task.thread_id, {
        kind: "patch",
        metadata: { title: task.instruction.slice(0, 60), admission_id: run },
      });
      signal.throwIfAborted();
      const response = await this.framework.request(
        `/threads/${task.thread_id}/runs/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            assistant_id: "general-chat",
            input:
              task.resume_mode === "checkpoint"
                ? null
                : {
                    messages: [
                      {
                        type: "human",
                        id: `task-${task.id}`,
                        content: task.instruction,
                      },
                    ],
                    runModelCallCount: 0,
                  },
            stream_mode: ["messages", "values"],
            context: {
              model,
              admissionId: run,
              provider: quote.provider,
              runLimit: 1,
              exitBehavior: "error",
            },
            config: { recursion_limit: 8, tags: [`task-execution:${run}`] },
          }),
        },
      );
      if (!response.ok || !response.body) throw new Error("Graph unavailable");
      succeeded = true;
      for await (const part of response.body
        .pipeThrough(BytesLineDecoder())
        .pipeThrough(SSEDecoder())) {
        if (part.event === "error") succeeded = false;
        if (part.event.startsWith("messages") || part.event === "values") {
          const data =
            typeof part.data === "string" ? JSON.parse(part.data) : part.data;
          const message = Array.isArray(data)
            ? data[0]
            : data?.messages?.at(-1);
          if (
            this.tasks.get(task.id).provider_attempts > 0 &&
            message?.type === "ai" &&
            typeof message.id === "string" &&
            message.id.startsWith("gen-")
          )
            this.tasks.recordGeneration(task.id, run, message.id);
        }
      }
      succeeded =
        succeeded &&
        !signal.aborted &&
        this.metadata.getRun(run)?.status === "running";
    } catch {
      succeeded = false;
      controller.abort();
    } finally {
      try {
        await this.execution.drained(run);
        if (this.metadata.getRun(run)?.status === "running")
          this.metadata.finishRun(run, succeeded ? "success" : "error");
        const current = this.tasks.get(task.id);
        if (["running", "stopping"].includes(current.state)) {
          const waiting = this.tasks.settle(
            task.id,
            run,
            current.revision,
            this.tasks.knownUncharged(run) ? 0 : null,
            succeeded,
          );
          if (
            waiting.generation_id &&
            !waiting.attempt_settled &&
            !this.closing
          ) {
            const claim = this.tasks.claimLookup(task.id, waiting.revision);
            const cost = await generationCost(claim.generation_id!);
            if (cost !== null)
              this.tasks.reconcile(task.id, run, waiting.revision, cost);
          }
        }
      } finally {
        this.execution.release(run);
      }
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    this.tasks.interruptOnRestart();
    this.metadata.reconcileInterruptedRuns();
    this.shutdownSignal.abort();
    await this.pumping;
    await Promise.allSettled(this.active.values());
  }
}
