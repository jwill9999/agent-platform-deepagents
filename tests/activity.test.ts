import { afterEach, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { activityRoutes } from "../apps/agent-service/src/activity.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { privateFixture, cleanUp } from "./fixtures.js";

let fixture: ReturnType<typeof privateFixture>,
  p: ReturnType<typeof openPersistence>;
beforeEach(() => {
  fixture = privateFixture();
  p = openPersistence(fixture.path);
});
afterEach(() => cleanUp([() => p.close(), () => fixture.remove()]));
async function task(allowance = 100) {
  const thread = randomUUID(),
    id = randomUUID();
  await p.metadata.set(thread, { kind: "put", metadata: {} });
  return p.tasks.submit(id, thread, "synthetic regression", allowance);
}
const list = () => p.activity.list(Number.MAX_SAFE_INTEGER);
test("execution events are independent of late charges and read state survives restart", async () => {
  const t = await task();
  const run = p.tasks.admit(t.id, t.revision, 20)!;
  p.tasks.recordGeneration(run.id, run.attempt_id!, "gen-synthetic");
  const pending = p.tasks.settle(
    run.id,
    run.attempt_id!,
    run.revision,
    null,
    true,
  );
  expect(list().events.map((e) => e.kind)).toEqual(["completed"]);
  const event = list().events[0]!;
  p.tasks.reconcile(pending.id, pending.attempt_id!, pending.revision, 2);
  expect(list().events).toHaveLength(1);
  const read = p.activity.read(event.id)!;
  expect(p.activity.read(event.id)?.read_at).toBe(read.read_at);
  p.close();
  p = openPersistence(fixture.path);
  expect(p.activity.get(event.id)).toEqual(read);
  expect(list().unread).toBe(0);
});
test("decisions remain historical and failed and interrupted work retain distinct events", async () => {
  const t = await task(0);
  const decision = p.tasks.admit(t.id, t.revision, 10)!;
  p.tasks.decide(t.id, decision.decision_id!, decision.revision, false, 0);
  expect(list().events.map((e) => e.kind)).toEqual(["decision"]);
  const failed = await task();
  const f = p.tasks.admit(failed.id, failed.revision, 10)!;
  p.tasks.settle(f.id, f.attempt_id!, f.revision, 0, false);
  expect(list().events[0]?.kind).toBe("failed");
  const interrupted = await task();
  p.tasks.admit(interrupted.id, interrupted.revision, 10);
  p.close();
  p = openPersistence(fixture.path);
  expect(list().events[0]?.kind).toBe("interrupted");
  expect(list().events).toHaveLength(3);
});
test("notification sessions never replay history and claims are bounded and at most once", async () => {
  const old = await task(0);
  p.tasks.admit(old.id, 0, 10);
  p.activity.configure(true, "dark");
  const a = p.activity.connect().session;
  expect(p.activity.claim(a)).toEqual([]);
  for (let n = 0; n < 23; n++) {
    const t = await task(0);
    p.tasks.admit(t.id, 0, 10);
  }
  expect(p.activity.claim(a)).toHaveLength(20);
  expect(p.activity.claim(a)).toHaveLength(3);
  expect(p.activity.claim(a)).toEqual([]);
  const b = p.activity.connect().session;
  expect(p.activity.validSession(a)).toBe(false);
  expect(() => p.activity.claim(a)).toThrow();
  expect(p.activity.validSession(b)).toBe(true);
  p.activity.configure(false, "light");
  expect(p.activity.validSession(b)).toBe(false);
  const off = p.activity.connect().session;
  expect(p.activity.claim(off)).toEqual([]);
  p.close();
  p = openPersistence(fixture.path);
  expect(p.activity.preferences()).toEqual({ enabled: false, theme: "light" });
  expect(() => p.activity.claim(off)).toThrow();
});
test("inbox API validates cursors, IDs, preferences and session bodies without altering data", async () => {
  const app = activityRoutes(p.activity);
  const req = (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  for (const cursor of ["0", "-1", "1.5", "NaN", "9007199254740992"])
    expect((await req("/activity?before=" + cursor)).status).toBe(400);
  for (const id of ["0", "-1", "999"]) {
    expect((await req("/activity/" + id)).status).toBe(404);
    expect((await req("/activity/" + id + "/read", {})).status).toBe(404);
  }
  for (const body of [
    null,
    [],
    {},
    { enabled: "yes", theme: "dark" },
    { enabled: true, theme: ["dark"] },
    { enabled: true, theme: "other" },
    { enabled: true, theme: "dark", extra: true },
  ])
    expect((await req("/activity/preferences", body, "PUT")).status).toBe(400);
  expect(
    (
      await req(
        "/activity/preferences",
        { enabled: true, theme: "dark" },
        "PUT",
      )
    ).status,
  ).toBe(200);
  expect(await (await req("/activity/preferences")).json()).toEqual({
    enabled: true,
    theme: "dark",
  });
  for (const path of ["/activity/notifications", "/activity/session-valid"])
    for (const body of [
      null,
      [],
      {},
      { session: 1 },
      { session: "x", extra: true },
    ])
      expect((await req(path, body)).status).toBe(400);
  expect(
    (await req("/activity/notifications", { session: "expired" })).status,
  ).toBe(409);
  const { session } = await (await req("/activity/session", {})).json();
  expect(
    await (await req("/activity/session-valid", { session })).json(),
  ).toEqual({ valid: true });
  expect(
    await (await req("/activity/notifications", { session })).json(),
  ).toEqual([]);
  const t = await task(0);
  p.tasks.admit(t.id, 0, 10);
  const event = list().events[0]!;
  expect(await (await req("/activity/" + event.id)).json()).toEqual(event);
  expect((await req("/activity/" + event.id + "/read", {})).status).toBe(200);
  expect(await (await req("/activity?before=" + event.id)).json()).toEqual({
    events: [],
    unread: 0,
  });
  expect((await (await req("/activity")).json()).events).toHaveLength(1);
});
