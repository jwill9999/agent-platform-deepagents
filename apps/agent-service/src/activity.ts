import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";

export type ActivityEvent = {
  id: number;
  event_key: string;
  task_id: string;
  thread_id: string;
  kind: "completed" | "failed" | "stopped" | "interrupted" | "decision";
  created_at: number;
  read_at: number | null;
};
/** Product events share the policy database, never the graph checkpointer. */
export class ActivityStore {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL, thread_id TEXT NOT NULL, kind TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), read_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS activity_preferences (
        id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
        theme TEXT NOT NULL DEFAULT 'system', session TEXT, cursor INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO activity_preferences(id) VALUES(1);
      CREATE TRIGGER IF NOT EXISTS activity_decision AFTER UPDATE ON tasks
      WHEN NEW.state='awaiting_approval' AND NEW.decision_id IS NOT NULL
      BEGIN
        INSERT OR IGNORE INTO activity_events(event_key,task_id,thread_id,kind)
        VALUES('decision:'||NEW.decision_id,NEW.id,NEW.thread_id,'decision');
      END;
      CREATE TRIGGER IF NOT EXISTS activity_execution AFTER UPDATE ON tasks
      WHEN NEW.execution_outcome IS NOT NULL AND OLD.execution_outcome IS NULL
      BEGIN
        INSERT OR IGNORE INTO activity_events(event_key,task_id,thread_id,kind)
        VALUES('execution:'||NEW.attempt_id,NEW.id,NEW.thread_id,
          CASE WHEN NEW.state='stopped' THEN 'stopped' WHEN NEW.execution_outcome='success' THEN 'completed' ELSE 'failed' END);
      END;
      CREATE TRIGGER IF NOT EXISTS activity_recovered_stop AFTER UPDATE ON tasks
      WHEN NEW.state='stopped' AND OLD.state='stopping' AND NEW.execution_outcome IS NULL
      BEGIN
        INSERT OR IGNORE INTO activity_events(event_key,task_id,thread_id,kind)
        VALUES('stop:'||NEW.id||':'||NEW.revision,NEW.id,NEW.thread_id,'stopped');
      END;
      CREATE TRIGGER IF NOT EXISTS activity_interruption AFTER UPDATE ON tasks
      WHEN NEW.state IN ('failed','interrupted') AND OLD.state!=NEW.state AND NEW.execution_outcome IS NULL
      BEGIN
        INSERT OR IGNORE INTO activity_events(event_key,task_id,thread_id,kind)
        VALUES('transition:'||NEW.id||':'||NEW.revision,NEW.id,NEW.thread_id,NEW.state);
      END;
    `);
    // A service restart invalidates any earlier desktop delivery session.
    this.db
      .prepare("UPDATE activity_preferences SET session=NULL WHERE id=1")
      .run();
  }
  preferences() {
    const row = this.db
      .prepare("SELECT enabled,theme FROM activity_preferences WHERE id=1")
      .get() as { enabled: number; theme: string };
    return { enabled: Boolean(row.enabled), theme: row.theme };
  }
  configure(enabled: boolean, theme: string) {
    this.db
      .prepare(
        "UPDATE activity_preferences SET enabled=?,theme=?,session=NULL,cursor=COALESCE((SELECT MAX(id) FROM activity_events),0) WHERE id=1",
      )
      .run(Number(enabled), theme);
    return this.preferences();
  }
  list(before: number) {
    return {
      events: this.db
        .prepare(
          "SELECT * FROM activity_events WHERE id<? ORDER BY id DESC LIMIT 50",
        )
        .all(before) as ActivityEvent[],
      unread: (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM activity_events WHERE read_at IS NULL",
          )
          .get() as { n: number }
      ).n,
    };
  }
  get(id: number) {
    return this.db
      .prepare("SELECT * FROM activity_events WHERE id=?")
      .get(id) as ActivityEvent | undefined;
  }
  read(id: number) {
    this.db
      .prepare(
        "UPDATE activity_events SET read_at=COALESCE(read_at,?) WHERE id=?",
      )
      .run(Date.now(), id);
    return this.get(id);
  }
  connect() {
    const session = randomUUID();
    this.db
      .prepare(
        "UPDATE activity_preferences SET session=?,cursor=COALESCE((SELECT MAX(id) FROM activity_events),0) WHERE id=1",
      )
      .run(session);
    return { session };
  }
  validSession(session: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM activity_preferences WHERE id=1 AND enabled=1 AND session=?",
        )
        .get(session),
    );
  }
  claim(session: string) {
    return this.db
      .transaction(() => {
        const state = this.db
          .prepare(
            "SELECT enabled,cursor FROM activity_preferences WHERE id=1 AND session=?",
          )
          .get(session) as { enabled: number; cursor: number } | undefined;
        if (!state) throw new Error("Notification session expired");
        if (!state.enabled) return [];
        const events = this.db
          .prepare(
            "SELECT * FROM activity_events WHERE id>? ORDER BY id LIMIT 20",
          )
          .all(state.cursor) as ActivityEvent[];
        if (events.length)
          this.db
            .prepare("UPDATE activity_preferences SET cursor=? WHERE id=1")
            .run(events.at(-1)!.id);
        return events;
      })
      .immediate();
  }
}
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function eventId(s: string) {
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function activityRoutes(store: ActivityStore) {
  const app = new Hono();
  app.get("/activity", (c) => {
    const before = c.req.query("before");
    const n = before === undefined ? Number.MAX_SAFE_INTEGER : eventId(before);
    return n === null
      ? c.json({ error: "Invalid activity cursor" }, 400)
      : c.json(store.list(n));
  });
  app.get("/activity/preferences", (c) => c.json(store.preferences()));
  app.put("/activity/preferences", async (c) => {
    const b: unknown = await c.req.json();
    if (
      !record(b) ||
      Object.keys(b).length !== 2 ||
      !Object.hasOwn(b, "enabled") ||
      !Object.hasOwn(b, "theme") ||
      typeof b.enabled !== "boolean" ||
      typeof b.theme !== "string" ||
      !["system", "light", "dark"].includes(b.theme)
    )
      return c.json({ error: "Invalid preferences" }, 400);
    return c.json(store.configure(b.enabled, b.theme as string));
  });
  app.post("/activity/session", (c) => c.json(store.connect()));
  app.post("/activity/session-valid", async (c) => {
    const b: unknown = await c.req.json();
    if (
      !record(b) ||
      Object.keys(b).join() !== "session" ||
      typeof b.session !== "string"
    )
      return c.json({ error: "Invalid session" }, 400);
    return c.json({ valid: store.validSession(b.session) });
  });
  app.post("/activity/notifications", async (c) => {
    const b: unknown = await c.req.json();
    if (
      !record(b) ||
      Object.keys(b).join() !== "session" ||
      typeof b.session !== "string"
    )
      return c.json({ error: "Invalid session" }, 400);
    try {
      return c.json(store.claim(b.session));
    } catch {
      return c.json({ error: "Notification session expired" }, 409);
    }
  });
  app.get("/activity/:id", (c) => {
    const id = eventId(c.req.param("id"));
    const event = id && store.get(id);
    return event
      ? c.json(event)
      : c.json({ error: "Activity unavailable" }, 404);
  });
  app.post("/activity/:id/read", (c) => {
    const id = eventId(c.req.param("id"));
    const event = id && store.read(id);
    return event
      ? c.json(event)
      : c.json({ error: "Activity unavailable" }, 404);
  });
  return app;
}
