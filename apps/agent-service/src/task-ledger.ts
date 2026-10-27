import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type TaskState =
  | "queued"
  | "running"
  | "stopping"
  | "stopped"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "denied"
  | "uncertain"
  | "interrupted";

/** Money is integer nano-USD. Provider decimal conversion belongs at the boundary. */
export type TaskRecord = {
  id: string;
  thread_id: string;
  instruction: string;
  state: TaskState;
  revision: number;
  allowance: number;
  initial_allowance: number;
  reserved: number;
  confirmed: number;
  estimate: number;
  queue_order: number;
  queued_at: number;
  decision_id: string | null;
  attempt_id: string | null;
  attempt_settled: number;
  generation_id: string | null;
  execution_outcome: "success" | "error" | null;
  lookup_after: number;
  partial_text: string;
  provider_attempts: number;
  retry_waiting: number;
  input_identity_version: number;
  resume_mode: "input" | "checkpoint";
};

function money(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid monetary amount");
}

/** Product policy only; never stores or replaces graph checkpoints. */
export class TaskLedger {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_policy_schema (
        version INTEGER PRIMARY KEY CHECK(version = 1)
      );
      INSERT OR IGNORE INTO task_policy_schema VALUES (1);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id),
        instruction TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN (
          'queued','running','awaiting_approval','completed','failed',
          'denied','uncertain','interrupted'
        )),
        revision INTEGER NOT NULL DEFAULT 0,
        allowance INTEGER NOT NULL CHECK(allowance >= 0),
        initial_allowance INTEGER NOT NULL CHECK(initial_allowance >= 0),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
        confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed >= 0),
        estimate INTEGER NOT NULL DEFAULT 0 CHECK(estimate >= 0),
        queue_order INTEGER NOT NULL,
        queued_at INTEGER NOT NULL,
        decision_id TEXT,
        attempt_id TEXT,
        attempt_settled INTEGER NOT NULL DEFAULT 0 CHECK(attempt_settled IN (0,1)),
        generation_id TEXT,
        execution_outcome TEXT CHECK(execution_outcome IN ('success','error')),
        lookup_after INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_task_per_thread ON tasks(thread_id)
        WHERE state IN ('queued','running','awaiting_approval','uncertain','interrupted');
      CREATE TABLE IF NOT EXISTS allowance_decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        revision INTEGER NOT NULL,
        approved INTEGER NOT NULL,
        allowance INTEGER NOT NULL
      );
    `);
    this.upgradeExecutionSchema();
  }

  /** Upgrade our policy table only; graph checkpoint storage is untouched. */
  private upgradeExecutionSchema(): void {
    const sql = (
      this.db
        .prepare("SELECT sql FROM sqlite_master WHERE name='tasks'")
        .get() as { sql: string }
    ).sql;
    if (!sql.includes("'stopping'")) {
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db
          .transaction(() => {
            this.db.exec(
              sql
                .replace(/CREATE TABLE tasks/i, "CREATE TABLE tasks_m104")
                .replace(
                  "'denied','uncertain','interrupted'",
                  "'denied','uncertain','interrupted','stopping','stopped'",
                ),
            );
            this.db.exec(
              "INSERT INTO tasks_m104 SELECT * FROM tasks; DROP TABLE tasks; ALTER TABLE tasks_m104 RENAME TO tasks;",
            );
          })
          .immediate();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
    }
    const columns = this.db.pragma("table_info(tasks)") as { name: string }[];
    for (const [name, definition] of [
      ["partial_text", "TEXT NOT NULL DEFAULT ''"],
      ["provider_attempts", "INTEGER NOT NULL DEFAULT 0"],
      ["retry_waiting", "INTEGER NOT NULL DEFAULT 0"],
      ["resume_mode", "TEXT NOT NULL DEFAULT 'input'"],
      ["input_identity_version", "INTEGER NOT NULL DEFAULT 0"],
    ]) {
      if (!columns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition}`);
    }
    this.db
      .exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_open_task_per_thread ON tasks(thread_id)
      WHERE state IN ('queued','running','stopping','awaiting_approval','uncertain','interrupted');
      CREATE TABLE IF NOT EXISTS task_resumes (
        task_id TEXT NOT NULL REFERENCES tasks(id), revision INTEGER NOT NULL,
        previous_attempt TEXT NOT NULL, PRIMARY KEY(task_id, revision)
      );
      CREATE TABLE IF NOT EXISTS provider_attempts (
        run_id TEXT NOT NULL, ordinal INTEGER NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(id),
        reservation INTEGER NOT NULL, outcome TEXT NOT NULL, generation_id TEXT, confirmed_cost INTEGER,
        PRIMARY KEY(run_id,ordinal)
      );`);
    if ((this.db.pragma("foreign_key_check") as unknown[]).length)
      throw new Error("Policy migration integrity failure");
  }

  forRun(run: string): TaskRecord {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE attempt_id=?")
      .get(run);
    if (!row) throw new Error("Execution not admitted");
    return row as TaskRecord;
  }

  /** A quote, including zero, is not evidence of the provider's final charge. */
  knownUncharged(run: string): boolean {
    const task = this.forRun(run);
    if (task.provider_attempts === 0) return true;
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM provider_attempts WHERE run_id=? AND ordinal=? AND outcome='not_sent'",
        )
        .get(run, task.provider_attempts),
    );
  }

  beginProviderAttempt(run: string): void {
    this.db
      .transaction(() => {
        const t = this.forRun(run);
        if (
          t.state !== "running" ||
          t.provider_attempts >= 3 ||
          t.generation_id ||
          t.partial_text
        )
          throw new Error("Dispatch not permitted");
        // The first reservation is made by admission. Only positively uncharged
        // connection failures release it; retries reserve again before dispatch.
        const reservation = t.provider_attempts === 0 ? t.reserved : t.estimate;
        if (t.provider_attempts > 0 && t.reserved !== 0)
          throw new Error("Uncertain previous attempt");
        if (reservation > t.allowance - t.confirmed)
          throw new Error("Allowance exhausted");
        this.db
          .prepare("INSERT INTO provider_attempts VALUES (?,?,?,?,?,NULL,NULL)")
          .run(run, t.provider_attempts + 1, t.id, reservation, "dispatched");
        this.db
          .prepare(
            "UPDATE tasks SET provider_attempts=provider_attempts+1,reserved=?,retry_waiting=0 WHERE id=?",
          )
          .run(reservation, t.id);
      })
      .immediate();
  }

  rejectBeforeDispatch(run: string): boolean {
    return this.db
      .transaction(() => {
        const t = this.forRun(run);
        if (
          t.state !== "running" ||
          t.generation_id ||
          t.partial_text ||
          !t.provider_attempts
        )
          return false;
        const changed = this.db
          .prepare(
            "UPDATE provider_attempts SET outcome='not_sent',confirmed_cost=0 WHERE run_id=? AND ordinal=? AND outcome='dispatched'",
          )
          .run(run, t.provider_attempts);
        if (changed.changes !== 1) return false;
        this.db
          .prepare("UPDATE tasks SET reserved=0,retry_waiting=? WHERE id=?")
          .run(Number(t.provider_attempts < 3), t.id);
        return t.provider_attempts < 3;
      })
      .immediate();
  }

  requestStop(id: string, run: string, revision: number): TaskRecord {
    return this.db
      .transaction(() => {
        const t = this.get(id);
        if (t.attempt_id !== run) throw new Error("Stale Stop identity");
        if (["stopping", "stopped"].includes(t.state)) return t;
        if (t.revision !== revision || t.state !== "running")
          throw new Error("Task already changed");
        this.db
          .prepare(
            "UPDATE tasks SET state='stopping',retry_waiting=0,revision=revision+1 WHERE id=?",
          )
          .run(id);
        return this.get(id);
      })
      .immediate();
  }

  recordPartial(id: string, run: string, text: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET partial_text=? WHERE id=? AND attempt_id=? AND state IN ('running','stopping')",
      )
      .run(text.slice(0, 32768), id, run);
  }

  get(id: string): TaskRecord {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!row) throw new Error("Task not found");
    return row as TaskRecord;
  }

  list(): TaskRecord[] {
    return this.db
      .prepare("SELECT * FROM tasks ORDER BY queue_order, id")
      .all() as TaskRecord[];
  }

  private nextOrder(): number {
    return (
      this.db
        .prepare("SELECT COALESCE(MAX(queue_order),0)+1 AS value FROM tasks")
        .get() as { value: number }
    ).value;
  }

  submit(
    id: string,
    threadId: string,
    instruction: string,
    allowance: number,
  ): TaskRecord {
    money(allowance);
    if (
      !/^[a-zA-Z0-9_-]{16,128}$/.test(id) ||
      !instruction.trim() ||
      instruction.length > 8000
    )
      throw new Error("Invalid task submission");
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(id) as TaskRecord | undefined;
        if (existing) {
          if (
            existing.thread_id !== threadId ||
            existing.instruction !== instruction ||
            existing.initial_allowance !== allowance
          )
            throw new Error(
              "Submission identity conflicts with an existing task",
            );
          return existing;
        }
        this.db
          .prepare(
            "INSERT INTO tasks (id,thread_id,instruction,state,allowance,initial_allowance,queue_order,queued_at,input_identity_version) VALUES (?,?,?,'queued',?,?,?,?,1)",
          )
          .run(
            id,
            threadId,
            instruction,
            allowance,
            allowance,
            this.nextOrder(),
            Date.now(),
          );
        return this.get(id);
      })
      .immediate();
  }

  /** Quote is supplied by qualified server-side accounting, never by a client. */
  admit(id: string, revision: number, estimate: number): TaskRecord | null {
    money(estimate);
    return this.db
      .transaction(() => {
        const task = this.get(id);
        if (task.revision !== revision || task.state !== "queued")
          throw new Error("Stale task admission");
        const first = this.db
          .prepare(
            "SELECT id FROM tasks WHERE state = 'queued' ORDER BY queue_order,id LIMIT 1",
          )
          .get() as { id: string } | undefined;
        const active = (
          this.db
            .prepare(
              "SELECT COUNT(*) AS value FROM tasks WHERE state IN ('running','stopping')",
            )
            .get() as { value: number }
        ).value;
        if (first?.id !== id || active >= 2) return null;
        if (task.reserved !== 0) throw new Error("Unreconciled reservation");
        const waiting = estimate > task.allowance - task.confirmed;
        this.db
          .prepare(
            "UPDATE tasks SET state=?, estimate=?, reserved=?, decision_id=?, attempt_id=?, attempt_settled=0, revision=revision+1 WHERE id=?",
          )
          .run(
            waiting ? "awaiting_approval" : "running",
            estimate,
            waiting ? 0 : estimate,
            waiting ? randomUUID() : null,
            waiting ? null : randomUUID(),
            id,
          );
        return this.get(id);
      })
      .immediate();
  }

  decide(
    id: string,
    decisionId: string,
    revision: number,
    approved: boolean,
    allowance: number,
  ): TaskRecord {
    money(allowance);
    return this.db
      .transaction(() => {
        const prior = this.db
          .prepare("SELECT * FROM allowance_decisions WHERE id=?")
          .get(decisionId) as
          | {
              task_id: string;
              revision: number;
              approved: number;
              allowance: number;
            }
          | undefined;
        if (prior) {
          if (
            prior.task_id !== id ||
            prior.revision !== revision ||
            prior.approved !== Number(approved) ||
            prior.allowance !== allowance
          )
            throw new Error("Conflicting repeated decision");
          return this.get(id);
        }
        const task = this.get(id);
        if (
          task.state !== "awaiting_approval" ||
          task.revision !== revision ||
          task.decision_id !== decisionId
        )
          throw new Error("Stale allowance decision");
        if (
          approved &&
          (allowance <= task.allowance ||
            allowance - task.confirmed < task.estimate)
        )
          throw new Error("Increase does not cover the reservation");
        if (!approved && allowance !== task.allowance)
          throw new Error("Denial cannot change the allowance");
        this.db
          .prepare("INSERT INTO allowance_decisions VALUES (?,?,?,?,?)")
          .run(decisionId, id, revision, Number(approved), allowance);
        this.db
          .prepare(
            "UPDATE tasks SET state=?,allowance=?,queue_order=?,queued_at=?,decision_id=NULL,revision=revision+1 WHERE id=?",
          )
          .run(
            approved ? "queued" : "denied",
            allowance,
            this.nextOrder(),
            Date.now(),
            id,
          );
        return this.get(id);
      })
      .immediate();
  }

  /** Missing cost retains the full reservation, even after a failed stream. */
  settle(
    id: string,
    attemptId: string,
    revision: number,
    cost: number | null,
    succeeded: boolean,
  ): TaskRecord {
    if (cost !== null) money(cost);
    return this.db
      .transaction(() => {
        const task = this.get(id);
        if (
          !["running", "stopping"].includes(task.state) ||
          task.revision !== revision ||
          task.attempt_id !== attemptId ||
          task.attempt_settled
        )
          throw new Error("Stale task settlement");
        const confirmed = task.confirmed + (cost ?? 0);
        money(confirmed);
        this.db
          .prepare(
            "UPDATE tasks SET state=?,confirmed=?,reserved=?,attempt_settled=?,execution_outcome=?,retry_waiting=0,revision=revision+1 WHERE id=?",
          )
          .run(
            task.state === "stopping"
              ? "stopped"
              : cost === null
                ? "uncertain"
                : succeeded
                  ? "completed"
                  : "failed",
            confirmed,
            cost === null ? task.reserved : 0,
            Number(cost !== null),
            succeeded ? "success" : "error",
            id,
          );
        this.db
          .prepare(
            "UPDATE provider_attempts SET outcome=?,confirmed_cost=? WHERE run_id=? AND ordinal=? AND outcome='dispatched'",
          )
          .run(
            cost === null ? "uncertain" : "settled",
            cost,
            attemptId,
            task.provider_attempts,
          );
        return this.get(id);
      })
      .immediate();
  }

  /** Late accounting only: records a known outcome but never replays execution. */
  reconcile(
    id: string,
    attemptId: string,
    revision: number,
    cost: number,
  ): TaskRecord {
    money(cost);
    return this.db
      .transaction(() => {
        const task = this.get(id);
        if (
          !["uncertain", "interrupted", "stopped"].includes(task.state) ||
          task.revision !== revision ||
          !task.attempt_id ||
          task.attempt_id !== attemptId ||
          task.attempt_settled
        )
          throw new Error("Stale accounting reconciliation");
        const confirmed = task.confirmed + cost;
        money(confirmed);
        this.db
          .prepare(
            "UPDATE tasks SET state=?,confirmed=?,reserved=0,attempt_settled=1,revision=revision+1 WHERE id=?",
          )
          .run(
            task.state === "stopped"
              ? "stopped"
              : task.execution_outcome === "success"
                ? "completed"
                : task.execution_outcome === "error"
                  ? "failed"
                  : "interrupted",
            confirmed,
            id,
          );
        this.db
          .prepare(
            "UPDATE provider_attempts SET outcome='settled',confirmed_cost=? WHERE run_id=? AND ordinal=? AND outcome='uncertain'",
          )
          .run(cost, attemptId, task.provider_attempts);
        return this.get(id);
      })
      .immediate();
  }

  recordGeneration(id: string, attemptId: string, generationId: string): void {
    if (!/^gen-[A-Za-z0-9_-]+$/.test(generationId)) return;
    const changed = this.db
      .prepare(
        "UPDATE tasks SET generation_id=? WHERE id=? AND attempt_id=? AND state IN ('running','stopping') AND (generation_id IS NULL OR generation_id=?)",
      )
      .run(generationId, id, attemptId, generationId);
    if (changed.changes !== 1) throw new Error("Generation identity conflict");
    this.db
      .prepare(
        "UPDATE provider_attempts SET generation_id=? WHERE run_id=? AND ordinal=(SELECT provider_attempts FROM tasks WHERE id=?)",
      )
      .run(generationId, attemptId, id);
  }

  /** Bound metadata polling independently of generation admission. */
  claimLookup(id: string, revision: number): TaskRecord {
    return this.db
      .transaction(() => {
        const task = this.get(id);
        if (
          !["uncertain", "interrupted", "stopped"].includes(task.state) ||
          task.revision !== revision ||
          !task.generation_id ||
          task.attempt_settled ||
          task.lookup_after > Date.now()
        )
          throw new Error("Accounting is unavailable or was checked recently");
        this.db
          .prepare("UPDATE tasks SET lookup_after=? WHERE id=?")
          .run(Date.now() + 15000, id);
        return task;
      })
      .immediate();
  }

  /** No provider dispatch has occurred for these states. */
  failQueued(id: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET state='failed',revision=revision+1 WHERE id=? AND state='queued'",
      )
      .run(id);
  }

  interruptQueued(id: string): void {
    this.db
      .prepare(
        "UPDATE tasks SET state='interrupted',revision=revision+1 WHERE id=? AND state='queued'",
      )
      .run(id);
  }

  hasResume(id: string, revision: number): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM task_resumes WHERE task_id=? AND revision=?")
        .get(id, revision),
    );
  }

  assertResumable(t: TaskRecord, revision: number): void {
    if (t.revision !== revision || t.state !== "interrupted")
      throw new Error("Task cannot resume");
    if (t.reserved !== 0 || (t.provider_attempts > 0 && !t.attempt_settled))
      throw new Error("Previous charge unresolved");
    if (!t.input_identity_version && t.attempt_id)
      throw new Error("Legacy checkpoint needs review");
    if (t.confirmed > t.allowance) throw new Error("Allowance exceeded");
  }

  resume(
    id: string,
    revision: number,
    mode: "input" | "checkpoint" | "complete",
  ): TaskRecord {
    return this.db
      .transaction(() => {
        if (this.hasResume(id, revision)) return this.get(id);
        const task = this.get(id);
        this.assertResumable(task, revision);
        this.db
          .prepare("INSERT INTO task_resumes VALUES (?,?,?)")
          .run(id, revision, JSON.stringify(task));
        this.db
          .prepare(
            `UPDATE tasks SET state=?,resume_mode=?,input_identity_version=1,queue_order=?,queued_at=?,
        attempt_id=CASE WHEN ? THEN attempt_id ELSE NULL END,generation_id=CASE WHEN ? THEN generation_id ELSE NULL END,provider_attempts=0,retry_waiting=0,
        attempt_settled=?,execution_outcome=?,partial_text='',lookup_after=0,revision=revision+1 WHERE id=?`,
          )
          .run(
            mode === "complete" ? "completed" : "queued",
            mode === "checkpoint" ? "checkpoint" : "input",
            this.nextOrder(),
            Date.now(),
            Number(mode === "complete"),
            Number(mode === "complete"),
            Number(mode === "complete"),
            mode === "complete" ? "success" : null,
            id,
          );
        return this.get(id);
      })
      .immediate();
  }

  /** Exclusive owner only; preserve Stop intent and positive no-dispatch evidence. */
  interruptOnRestart(): void {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `UPDATE provider_attempts SET outcome='uncertain' WHERE outcome='dispatched'
        AND run_id IN (SELECT attempt_id FROM tasks WHERE state IN ('running','stopping'))`,
          )
          .run();
        this.db
          .prepare(
            `UPDATE tasks SET state=CASE WHEN state='stopping' THEN 'stopped' ELSE 'interrupted' END,
        reserved=CASE WHEN provider_attempts=0 THEN 0 ELSE reserved END,
        attempt_settled=CASE WHEN provider_attempts=0 OR EXISTS (
          SELECT 1 FROM provider_attempts p WHERE p.run_id=tasks.attempt_id
          AND p.ordinal=tasks.provider_attempts AND p.outcome='not_sent'
        ) THEN 1 ELSE attempt_settled END,
        retry_waiting=0,revision=revision+1 WHERE state IN ('running','stopping','queued')`,
          )
          .run();
      })
      .immediate();
  }
}
