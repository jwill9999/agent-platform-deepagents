import { Hono } from "hono";
import type { MetadataStore } from "./metadata.js";
import type { TaskLedger } from "./task-ledger.js";
import { generationCost, usdToNanos } from "./accounting.js";
import type { ExecutionControl } from "./execution-control.js";

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function taskRoutes(
  tasks: TaskLedger,
  metadata: MetadataStore,
  execution?: ExecutionControl,
) {
  const app = new Hono();
  app.get("/tasks", (c) => c.json(tasks.list()));
  app.post("/tasks/:id/stop", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !object(body) ||
      Object.keys(body).some((k) => !["attemptId", "revision"].includes(k)) ||
      typeof body.attemptId !== "string" ||
      !Number.isSafeInteger(body.revision)
    )
      return c.json(
        { error: "Supply current execution identity and revision" },
        400,
      );
    try {
      if (!execution) throw new Error("Execution unavailable");
      return c.json(
        execution.stop(
          c.req.param("id"),
          body.attemptId,
          body.revision as number,
        ),
      );
    } catch {
      return c.json(
        { error: "Task changed or already finished. Refresh its status." },
        409,
      );
    }
  });
  app.post("/tasks", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !object(body) ||
      Object.keys(body).some(
        (k) => !["id", "threadId", "instruction", "allowanceUsd"].includes(k),
      ) ||
      typeof body.id !== "string" ||
      typeof body.threadId !== "string" ||
      typeof body.instruction !== "string" ||
      typeof body.allowanceUsd !== "string"
    )
      return c.json(
        { error: "Supply task identity, chat, instruction and allowance" },
        400,
      );
    await metadata.get(body.threadId);
    try {
      return c.json(
        tasks.submit(
          body.id,
          body.threadId,
          body.instruction,
          usdToNanos(body.allowanceUsd),
        ),
      );
    } catch {
      return c.json(
        { error: "Invalid or conflicting task. Existing work is unchanged." },
        409,
      );
    }
  });
  app.post("/tasks/:id/decision", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !object(body) ||
      Object.keys(body).some(
        (k) =>
          !["decisionId", "revision", "approved", "allowanceUsd"].includes(k),
      ) ||
      typeof body.decisionId !== "string" ||
      !Number.isSafeInteger(body.revision) ||
      typeof body.approved !== "boolean" ||
      typeof body.allowanceUsd !== "string"
    )
      return c.json({ error: "Invalid allowance decision" }, 400);
    try {
      return c.json(
        tasks.decide(
          c.req.param("id"),
          body.decisionId,
          body.revision as number,
          body.approved,
          usdToNanos(body.allowanceUsd),
        ),
      );
    } catch {
      return c.json(
        {
          error:
            "Decision is stale or the increase is insufficient. Refresh the task.",
        },
        409,
      );
    }
  });
  app.post("/tasks/:id/accounting", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !object(body) ||
      Object.keys(body).join() !== "revision" ||
      !Number.isSafeInteger(body.revision)
    )
      return c.json({ error: "Supply the current task revision" }, 400);
    try {
      const task = tasks.claimLookup(
        c.req.param("id"),
        body.revision as number,
      );
      if (!["uncertain", "interrupted", "stopped"].includes(task.state))
        return c.json({ error: "Accounting is not ready" }, 409);
      const cost = await generationCost(task.generation_id!);
      return c.json(
        cost === null
          ? tasks.get(task.id)
          : tasks.reconcile(task.id, task.attempt_id!, task.revision, cost),
      );
    } catch {
      return c.json(
        {
          error:
            "Accounting is unavailable or was checked recently. Refresh the task.",
        },
        409,
      );
    }
  });
  return app;
}
