import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { privateFixture, cleanUp } from "./fixtures.js";
let fixture: ReturnType<typeof privateFixture>,
  store: ReturnType<typeof openPersistence>;
beforeEach(() => {
  fixture = privateFixture();
  store = openPersistence(fixture.path);
});
afterEach(() => cleanUp([() => store.close(), () => fixture.remove()]));
async function submit(allowance = 100) {
  const thread = randomUUID();
  await store.metadata.set(thread, { kind: "put", metadata: {} });
  return store.tasks.submit(randomUUID(), thread, "instruction", allowance);
}
test("FIFO admission reserves atomically, stops at two and waiting approvals release capacity", async () => {
  const [a, b, c] = await Promise.all([submit(), submit(), submit(0)]);
  const l = store.tasks;
  expect(l.admit(b.id, 0, 10)).toBeNull();
  const first = l.admit(a.id, 0, 10)!;
  const second = l.admit(b.id, 0, 10)!;
  expect(l.admit(c.id, 0, 10)).toBeNull();
  l.settle(first.id, first.attempt_id!, first.revision, 2, true);
  const waiting = l.admit(c.id, 0, 10)!;
  expect(waiting).toMatchObject({ state: "awaiting_approval", reserved: 0 });
  const approved = l.decide(
    c.id,
    waiting.decision_id!,
    waiting.revision,
    true,
    20,
  );
  expect(
    l.decide(c.id, waiting.decision_id!, waiting.revision, true, 20),
  ).toEqual(approved);
  expect(() =>
    l.decide(c.id, waiting.decision_id!, waiting.revision, true, 30),
  ).toThrow();
  const third = l.admit(c.id, approved.revision, 10)!;
  expect(third.reserved).toBe(10);
  l.settle(second.id, second.attempt_id!, second.revision, 1, false);
  expect(l.get(second.id).state).toBe("failed");
});
test("submission replay uses immutable original allowance; conflicting identities and invalid values cannot mutate work", async () => {
  const t = await submit(0),
    l = store.tasks,
    w = l.admit(t.id, 0, 10)!;
  l.decide(t.id, w.decision_id!, w.revision, true, 20);
  expect(l.submit(t.id, t.thread_id, t.instruction, 0).allowance).toBe(20);
  for (const [thread, instruction, amount] of [
    [t.thread_id, "changed", 0],
    ["other", t.instruction, 0],
    [t.thread_id, t.instruction, 20],
  ] as const)
    expect(() => l.submit(t.id, thread, instruction, amount)).toThrow();
  for (const amount of [-1, 0.1, Infinity])
    expect(() => l.submit(randomUUID(), t.thread_id, "text", amount)).toThrow();
  for (const [id, text] of [
    ["bad", "text"],
    [randomUUID(), " "],
    [randomUUID(), "x".repeat(8001)],
  ])
    expect(() => l.submit(id!, t.thread_id, text!, 0)).toThrow();
  expect(() => l.get("missing")).toThrow();
  expect(() => l.admit(t.id, 0, 10)).toThrow();
});
test("decisions reject stale revisions, insufficient increases and altered denials", async () => {
  const t = await submit(),
    l = store.tasks,
    w = l.admit(t.id, 0, 200)!;
  for (const args of [
    [w.decision_id!, 0, true, 300],
    ["other", w.revision, true, 300],
    [w.decision_id!, w.revision, true, 100],
    [w.decision_id!, w.revision, true, 150],
    [w.decision_id!, w.revision, false, 50],
  ] as const)
    expect(() => l.decide(t.id, args[0], args[1], args[2], args[3])).toThrow();
  expect(l.decide(t.id, w.decision_id!, w.revision, false, 100).state).toBe(
    "denied",
  );
  expect(() => l.decide(t.id, "another", w.revision, true, 300)).toThrow();
});
test("unknown charges retain reservations; cost reconciliation is attempt-bound and once only", async () => {
  const t = await submit(),
    l = store.tasks,
    a = l.admit(t.id, 0, 50)!;
  l.recordGeneration(t.id, a.attempt_id!, "invalid");
  expect(l.get(t.id).generation_id).toBeNull();
  l.recordGeneration(t.id, a.attempt_id!, "gen-one");
  l.recordGeneration(t.id, a.attempt_id!, "gen-one");
  expect(() => l.recordGeneration(t.id, a.attempt_id!, "gen-other")).toThrow();
  expect(() => l.claimLookup(t.id, a.revision)).toThrow();
  expect(() => l.settle(t.id, "wrong", a.revision, null, true)).toThrow();
  const u = l.settle(t.id, a.attempt_id!, a.revision, null, true);
  expect(u).toMatchObject({ state: "uncertain", reserved: 50, confirmed: 0 });
  l.claimLookup(t.id, u.revision);
  expect(() => l.claimLookup(t.id, u.revision)).toThrow();
  for (const args of [
    ["wrong", u.revision, 3],
    [a.attempt_id!, 0, 3],
  ] as const)
    expect(() => l.reconcile(t.id, args[0], args[1], args[2])).toThrow();
  expect(l.reconcile(t.id, a.attempt_id!, u.revision, 3)).toMatchObject({
    state: "completed",
    reserved: 0,
    confirmed: 3,
  });
  expect(() => l.reconcile(t.id, a.attempt_id!, u.revision, 3)).toThrow();
  expect(() => l.settle(t.id, a.attempt_id!, a.revision, 3, true)).toThrow();
});
test("restart never replays queued/running work or mistakes late accounting for execution recovery", async () => {
  const a = await submit(),
    b = await submit(),
    l = store.tasks,
    run = l.admit(a.id, 0, 40)!;
  l.beginProviderAttempt(run.attempt_id!);
  l.recordGeneration(a.id, run.attempt_id!, "gen-restart");
  store.close();
  store = openPersistence(fixture.path);
  expect(store.tasks.get(a.id).state).toBe("interrupted");
  expect(store.tasks.get(b.id).state).toBe("interrupted");
  const r = store.tasks.get(a.id);
  expect(
    store.tasks.reconcile(a.id, r.attempt_id!, r.revision, 2),
  ).toMatchObject({ state: "interrupted", reserved: 0, confirmed: 2 });
});
test("queued failures are terminal and known failed outcomes stay failed after reconciliation", async () => {
  const a = await submit(),
    b = await submit(),
    c = await submit(),
    l = store.tasks;
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31000);
  l.interruptQueued(a.id);
  expect(l.get(a.id).state).toBe("interrupted");
  expect(l.get(b.id).state).toBe("queued");
  l.failQueued(b.id);
  l.interruptQueued(b.id);
  expect(l.get(b.id).state).toBe("failed");
  const r = l.admit(c.id, 0, 4)!;
  const u = l.settle(c.id, r.attempt_id!, r.revision, null, false);
  expect(l.reconcile(c.id, r.attempt_id!, u.revision, 0).state).toBe("failed");
});

test("Resume archives the prior attempt and cannot be altered by stale Stop, accounting or decisions", async () => {
  const t = await submit(),
    l = store.tasks;
  const first = l.admit(t.id, 0, 30)!;
  l.beginProviderAttempt(first.attempt_id!);
  l.recordGeneration(t.id, first.attempt_id!, "gen-first");
  l.interruptOnRestart();
  const interrupted = l.get(t.id);
  expect(() => l.resume(t.id, interrupted.revision, "checkpoint")).toThrow(
    "unresolved",
  );
  const settled = l.reconcile(t.id, first.attempt_id!, interrupted.revision, 3);
  const resumed = l.resume(t.id, settled.revision, "checkpoint");
  expect(l.resume(t.id, settled.revision, "checkpoint")).toEqual(resumed);
  expect(resumed).toMatchObject({
    confirmed: 3,
    allowance: 100,
    attempt_id: null,
    provider_attempts: 0,
    resume_mode: "checkpoint",
  });
  const next = l.admit(t.id, resumed.revision, 30)!;
  expect(next.attempt_id).not.toBe(first.attempt_id);
  expect(() =>
    l.requestStop(t.id, first.attempt_id!, first.revision),
  ).toThrow();
  expect(() =>
    l.reconcile(t.id, first.attempt_id!, settled.revision, 3),
  ).toThrow();
  expect(() =>
    l.decide(t.id, "old-decision", first.revision, true, 200),
  ).toThrow();
  expect(l.get(t.id)).toEqual(next);
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(fixture.path + "/metadata.sqlite");
  try {
    const rows = db
      .prepare("SELECT previous_attempt FROM task_resumes WHERE task_id=?")
      .all(t.id) as { previous_attempt: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.previous_attempt)).toMatchObject({
      attempt_id: first.attempt_id!,
      confirmed: 3,
      generation_id: "gen-first",
    });
  } finally {
    db.close();
  }
});
test("legacy attempted work stays blocked; safe legacy queue adoption gains deterministic identity", async () => {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(fixture.path + "/metadata.sqlite");
  try {
    const attempted = await submit(),
      queued = await submit();
    const a = store.tasks.admit(attempted.id, 0, 10)!;
    db.prepare("UPDATE tasks SET input_identity_version=0").run();
    store.tasks.interruptOnRestart();
    expect(() =>
      store.tasks.resume(a.id, store.tasks.get(a.id).revision, "input"),
    ).toThrow("Legacy");
    const q = store.tasks.get(queued.id);
    const adopted = store.tasks.resume(q.id, q.revision, "input");
    expect(adopted.input_identity_version).toBe(1);
    const next = store.tasks.admit(q.id, adopted.revision, 10)!;
    store.tasks.interruptOnRestart();
    const again = store.tasks.get(next.id);
    expect(() =>
      store.tasks.assertResumable(again, again.revision),
    ).not.toThrow();
    expect(() => store.tasks.resume(q.id, 0, "input")).toThrow("cannot resume");
    db.prepare("UPDATE tasks SET confirmed=allowance+1 WHERE id=?").run(q.id);
    const over = store.tasks.get(q.id);
    expect(() => store.tasks.assertResumable(over, over.revision)).toThrow(
      "exceeded",
    );
  } finally {
    db.close();
  }
});
test("restart preserves stopped intent and unsettled provider evidence", async () => {
  const t = await submit(),
    l = store.tasks,
    r = l.admit(t.id, 0, 10)!;
  l.beginProviderAttempt(r.attempt_id!);
  l.requestStop(t.id, r.attempt_id!, r.revision);
  l.interruptOnRestart();
  expect(l.get(t.id)).toMatchObject({
    state: "stopped",
    reserved: 10,
    attempt_settled: 0,
  });
  expect(() => l.resume(t.id, l.get(t.id).revision, "checkpoint")).toThrow();
  expect(
    store.activity
      .list(Number.MAX_SAFE_INTEGER)
      .events.filter((e) => e.kind === "stopped"),
  ).toHaveLength(1);
});

// Practical standalone zero-price checks passed before these regressions.
test("zero quote cannot settle a dispatched charge or permit interrupted Resume", async () => {
  const t = await submit(),
    l = store.tasks,
    a = l.admit(t.id, 0, 0)!;
  expect(l.knownUncharged(a.attempt_id!)).toBe(true);
  l.beginProviderAttempt(a.attempt_id!);
  expect(l.knownUncharged(a.attempt_id!)).toBe(false);
  l.recordGeneration(t.id, a.attempt_id!, "gen-zero");
  l.interruptOnRestart();
  const interrupted = l.get(t.id);
  expect(interrupted).toMatchObject({ reserved: 0, attempt_settled: 0 });
  expect(() => l.resume(t.id, interrupted.revision, "checkpoint")).toThrow(
    "unresolved",
  );
  const confirmed = l.reconcile(t.id, a.attempt_id!, interrupted.revision, 0);
  expect(l.resume(t.id, confirmed.revision, "checkpoint").state).toBe("queued");
});
test("positive no-send evidence remains uncharged across restart", async () => {
  const t = await submit(),
    l = store.tasks,
    a = l.admit(t.id, 0, 0)!;
  l.beginProviderAttempt(a.attempt_id!);
  expect(l.rejectBeforeDispatch(a.attempt_id!)).toBe(true);
  expect(l.knownUncharged(a.attempt_id!)).toBe(true);
  l.interruptOnRestart();
  const interrupted = l.get(t.id);
  expect(interrupted.attempt_settled).toBe(1);
  expect(() => l.resume(t.id, interrupted.revision, "input")).not.toThrow();
});
