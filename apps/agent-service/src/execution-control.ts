import type { ExecutionPolicy } from "@harness/agent";
import type { TaskLedger } from "./task-ledger.js";

/** References to the existing graph execution, not a worker or retry engine. */
export class ExecutionControl implements ExecutionPolicy {
  private readonly active = new Map<
    string,
    {
      controller: AbortController;
      pending: Promise<void> | null;
      resolve: (() => void) | null;
      graphDone: Promise<void>;
      graphResolve: () => void;
    }
  >();
  private readonly roots = new Map<string, string>();
  readonly callbacks = {
    name: "TaskGraphCompletion",
    handleChainStart: (
      _chain: unknown,
      _inputs: unknown,
      root: string,
      parent?: string,
      tags?: string[],
    ) => {
      const tag = tags?.find((value) => value.startsWith("task-execution:"));
      if (!parent && tag)
        this.roots.set(root, tag.slice("task-execution:".length));
    },
    handleChainEnd: (_outputs: unknown, root: string) => this.graphEnded(root),
    handleChainError: (_error: unknown, root: string) => this.graphEnded(root),
  };
  private graphEnded(root: string) {
    const run = this.roots.get(root);
    if (run) {
      this.active.get(run)?.graphResolve();
      this.roots.delete(root);
    }
  }
  constructor(private readonly tasks: TaskLedger) {}
  register(run: string, controller: AbortController) {
    if (this.active.has(run)) throw new Error("Execution already registered");
    let graphResolve!: () => void;
    const graphDone = new Promise<void>((resolve) => {
      graphResolve = resolve;
    });
    this.active.set(run, {
      controller,
      pending: null,
      resolve: null,
      graphDone,
      graphResolve,
    });
  }
  enter(run: string) {
    const entry = this.active.get(run);
    if (!entry || entry.pending) throw new Error("Execution unavailable");
    entry.controller.signal.throwIfAborted();
    entry.pending = new Promise<void>((resolve) => {
      entry.resolve = resolve;
    });
  }
  leave(run: string) {
    this.active.get(run)?.resolve?.();
  }
  beforeAttempt(run: string) {
    const entry = this.active.get(run);
    if (!entry) throw new Error("Execution unavailable");
    entry.controller.signal.throwIfAborted();
    this.tasks.beginProviderAttempt(run);
  }
  rejectedBeforeDispatch(run: string) {
    return this.tasks.rejectBeforeDispatch(run);
  }
  token(run: string, token: string) {
    const task = this.tasks.forRun(run);
    this.tasks.recordPartial(task.id, run, task.partial_text + token);
  }
  stop(task: string, run: string, revision: number) {
    const entry = this.active.get(run);
    const current = this.tasks.get(task);
    if (!entry && !["stopping", "stopped"].includes(current.state))
      throw new Error("Execution unavailable");
    const updated = this.tasks.requestStop(task, run, revision);
    entry?.controller.abort();
    return updated;
  }
  async drained(run: string) {
    const entry = this.active.get(run);
    if (entry) await Promise.all([entry.pending, entry.graphDone]);
  }
  release(run: string) {
    this.active.delete(run);
  }
}
