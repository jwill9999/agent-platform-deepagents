import type { ThreadSaver } from "@langchain/langgraph-api/experimental/embed";
import type Database from "better-sqlite3";
import { HTTPException } from "hono/http-exception";
import { isDeepStrictEqual } from "node:util";

type Thread = Awaited<ReturnType<ThreadSaver["get"]>>;
type ThreadRow = { thread_id: string; metadata: string };
export type RunStatus =
  "pending" | "running" | "success" | "error" | "stopped" | "interrupted";
export type RunRecord = {
  run_id: string;
  thread_id: string;
  status: RunStatus;
  updated_at: number;
};

/** Application metadata only. Graph checkpoints belong exclusively to SqliteSaver. */
export class MetadataStore implements ThreadSaver {
  constructor(private readonly db: Database.Database) {
    const version = db.pragma("user_version", { simple: true });
    if (version !== 0 && version !== 1)
      throw new Error("Unsupported metadata schema version.");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS threads (
          thread_id TEXT PRIMARY KEY, metadata TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(thread_id),
          status TEXT NOT NULL CHECK(status IN ('pending','running','success','error','stopped','interrupted')),
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_run_per_thread
          ON runs(thread_id) WHERE status IN ('pending','running','interrupted');
        PRAGMA user_version = 1;
      `);
    })();
  }

  private readThread(id: string): Thread {
    const row = this.db
      .prepare("SELECT thread_id, metadata FROM threads WHERE thread_id = ?")
      .get(id) as ThreadRow | undefined;
    if (!row) throw new HTTPException(404, { message: "Thread not found" });
    return {
      thread_id: row.thread_id,
      metadata: JSON.parse(row.metadata) as Thread["metadata"],
    };
  }

  async get(id: string): Promise<Thread> {
    return this.readThread(id);
  }

  async set(
    id: string,
    options: Parameters<ThreadSaver["set"]>[1],
  ): Promise<Thread> {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT 1 FROM threads WHERE thread_id = ?")
        .get(id);
      if (options.kind === "put" && existing)
        throw new HTTPException(409, { message: "Thread already exists" });
      if (options.kind === "patch" && !existing)
        throw new HTTPException(404, { message: "Thread not found" });
      const metadata = {
        ...(existing ? this.readThread(id).metadata : {}),
        ...options.metadata,
      };
      if (
        metadata.graph_id !== undefined &&
        metadata.graph_id !== "general-chat"
      ) {
        throw new HTTPException(400, { message: "Unknown graph" });
      }
      metadata.graph_id = "general-chat";
      const now = Date.now();
      if (existing) {
        this.db
          .prepare(
            "UPDATE threads SET metadata = ?, updated_at = ? WHERE thread_id = ?",
          )
          .run(JSON.stringify(metadata), now, id);
      } else {
        this.db
          .prepare("INSERT INTO threads VALUES (?, ?, ?, ?)")
          .run(id, JSON.stringify(metadata), now, now);
      }
      return this.readThread(id);
    })();
  }

  async delete(_id: string): Promise<void> {
    // Do not delete metadata independently of checkpoint and approval policy.
    throw new HTTPException(405, { message: "Thread deletion is not enabled" });
  }

  async *search(options: Parameters<NonNullable<ThreadSaver["search"]>>[0]) {
    const column =
      options.sortBy === "updated_at" ? "updated_at" : "created_at";
    const direction = options.sortOrder === "asc" ? "ASC" : "DESC";
    const rows = this.db
      .prepare(
        `SELECT thread_id, metadata FROM threads ORDER BY ${column} ${direction}, thread_id ASC`,
      )
      .all() as ThreadRow[];
    const threads = rows
      .map((row) => ({
        thread_id: row.thread_id,
        metadata: JSON.parse(row.metadata) as Thread["metadata"],
      }))
      .filter((thread) =>
        Object.entries(options.metadata ?? {}).every(([key, value]) =>
          isDeepStrictEqual(thread.metadata[key], value),
        ),
      );
    for (const thread of threads.slice(
      options.offset,
      options.offset + options.limit,
    )) {
      yield { thread, total: threads.length };
    }
  }

  getDefaults(): { general: string; coding: string } | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE name = 'models'")
      .get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  setDefaults(value: { general: string; coding: string }): void {
    this.db
      .prepare(
        "INSERT INTO settings VALUES ('models', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(value));
  }

  /** Called once while holding exclusive service ownership; never dispatches work. */
  reconcileInterruptedRuns(): number {
    return this.db
      .prepare(
        "UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status IN ('pending','running')",
      )
      .run(Date.now()).changes;
  }

  createRun(threadId: string, runId: string): void {
    this.db
      .prepare("INSERT INTO runs VALUES (?, ?, 'pending', ?)")
      .run(runId, threadId, Date.now());
  }

  getRun(runId: string): RunRecord | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      RunRecord | undefined;
  }

  /** Execution integration must call this before entering the framework. */
  markRunning(runId: string): void {
    this.transition(runId, ["pending"], "running");
  }

  finishRun(runId: string, status: "success" | "error" | "stopped"): void {
    this.transition(
      runId,
      status === "stopped"
        ? ["pending", "running", "interrupted"]
        : ["running"],
      status,
    );
  }

  /** Explicit caller action only; automatic startup reconciliation cannot resume. */
  requestResume(runId: string): void {
    this.transition(runId, ["interrupted"], "pending");
  }

  private transition(runId: string, from: RunStatus[], to: RunStatus): void {
    const placeholders = from.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `UPDATE runs SET status = ?, updated_at = ? WHERE run_id = ? AND status IN (${placeholders})`,
      )
      .run(to, Date.now(), runId, ...from);
    if (result.changes !== 1)
      throw new Error(
        "Run is missing or its state does not permit this transition.",
      );
  }
}
