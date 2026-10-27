import { afterEach, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { ExecutionControl } from "../apps/agent-service/src/execution-control.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { safePreDispatchFailure } from "../packages/agent/src/retry-policy.js";
import { taskRoutes } from "../apps/agent-service/src/task-routes.js";
import { privateFixture, cleanUp } from "./fixtures.js";
let fixture: ReturnType<typeof privateFixture>,
  p: ReturnType<typeof openPersistence>;
beforeEach(() => {
  fixture = privateFixture();
  p = openPersistence(fixture.path);
});
afterEach(() => cleanUp([() => p.close(), () => fixture.remove()]));
async function admitted() {
  const thread = randomUUID();
  await p.metadata.set(thread, { kind: "put", metadata: {} });
  const t = p.tasks.submit(randomUUID(), thread, "synthetic", 100);
  return p.tasks.admit(t.id, 0, 10)!;
}
test("Stop holds capacity until both graph and model finish; stale identity cannot affect another execution", async () => {
  const t = await admitted(),
    control = new ExecutionControl(p.tasks),
    abort = new AbortController(),
    run = t.attempt_id!;
  control.register(run, abort);
  expect(() => control.register(run, abort)).toThrow();
  control.enter(run);
  expect(() => control.enter(run)).toThrow();
  control.beforeAttempt(run);
  control.callbacks.handleChainStart({}, {}, "nested", "parent", [
    `task-execution:${run}`,
  ]);
  control.callbacks.handleChainEnd({}, "nested");
  control.callbacks.handleChainStart({}, {}, "root", undefined, [
    `task-execution:${run}`,
  ]);
  expect(() => control.stop(t.id, "wrong", t.revision)).toThrow();
  expect(() => control.stop(t.id, run, 0)).toThrow();
  const stopping = control.stop(t.id, run, t.revision);
  expect(stopping.state).toBe("stopping");
  expect(abort.signal.aborted).toBe(true);
  expect(() => control.beforeAttempt(run)).toThrow();
  expect(control.stop(t.id, run, t.revision).state).toBe("stopping");
  let drained = false;
  const waiting = control.drained(run).then(() => {
    drained = true;
  });
  control.leave(run);
  await Promise.resolve();
  expect(drained).toBe(false);
  control.callbacks.handleChainError(new Error("controlled"), "root");
  await waiting;
  expect(drained).toBe(true);
  const stopped = p.tasks.settle(t.id, run, stopping.revision, null, false);
  expect(stopped.state).toBe("stopped");
  control.release(run);
  expect(control.stop(t.id, run, t.revision).state).toBe("stopped");
  expect(() => control.enter(run)).toThrow();
  expect(() => control.beforeAttempt(run)).toThrow();
  control.leave("absent");
  await control.drained("absent");
});
test("individual uncharged attempts release reservations; partial output prevents retry and stopped late billing never replays", async () => {
  const t = await admitted(),
    run = t.attempt_id!,
    control = new ExecutionControl(p.tasks);
  control.register(run, new AbortController());
  control.enter(run);
  control.beforeAttempt(run);
  expect(control.rejectedBeforeDispatch(run)).toBe(true);
  expect(control.rejectedBeforeDispatch(run)).toBe(false);
  expect(p.tasks.get(t.id).reserved).toBe(0);
  control.beforeAttempt(run);
  control.token(run, "partial");
  expect(control.rejectedBeforeDispatch(run)).toBe(false);
  expect(() => control.beforeAttempt(run)).toThrow();
  p.tasks.recordGeneration(t.id, run, "gen-synthetic");
  const stopping = control.stop(t.id, run, t.revision);
  const stopped = p.tasks.settle(t.id, run, stopping.revision, null, false);
  const claim = p.tasks.claimLookup(t.id, stopped.revision);
  const billed = p.tasks.reconcile(t.id, run, claim.revision, 4);
  expect(billed).toMatchObject({
    state: "stopped",
    confirmed: 4,
    reserved: 0,
    partial_text: "partial",
  });
});
test("three preconnection failures are the maximum and restart never replays stopped work", async () => {
  const t = await admitted(),
    run = t.attempt_id!;
  expect(() => p.tasks.forRun("missing")).toThrow();
  expect(p.tasks.rejectBeforeDispatch(run)).toBe(false);
  for (let i = 0; i < 3; i++) {
    p.tasks.beginProviderAttempt(run);
    expect(p.tasks.rejectBeforeDispatch(run)).toBe(i < 2);
  }
  expect(() => p.tasks.beginProviderAttempt(run)).toThrow();
  const stop = p.tasks.requestStop(t.id, run, t.revision);
  p.tasks.settle(t.id, run, stop.revision, 0, false);
  p.tasks.interruptOnRestart();
  expect(p.tasks.get(t.id).state).toBe("stopped");
});
test("Stop route validates payload and current execution; it never accepts arbitrary overrides", async () => {
  const t = await admitted(),
    run = t.attempt_id!,
    control = new ExecutionControl(p.tasks);
  control.register(run, new AbortController());
  const app = taskRoutes(p.tasks, p.metadata, control);
  const request = (body: unknown) =>
    app.request(`/tasks/${t.id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const body of [
    null,
    {},
    [],
    { attemptId: run, revision: 1, extra: true },
    { attemptId: run, revision: 1.1 },
  ])
    expect((await request(body)).status).toBe(400);
  expect((await request({ attemptId: "wrong", revision: 1 })).status).toBe(409);
  expect((await request({ attemptId: run, revision: 1 })).status).toBe(200);
  const unavailable = taskRoutes(p.tasks, p.metadata);
  expect(
    (
      await unavailable.request(`/tasks/${t.id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: run, revision: 1 }),
      })
    ).status,
  ).toBe(409);
});
test("retry classification excludes uncertain errors, hinted waits, nonerrors and deep chains", () => {
  const error = (code: string) =>
    Object.assign(new Error("synthetic"), { code });
  for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])
    expect(
      safePreDispatchFailure(new Error("wrapper", { cause: error(code) })),
    ).toBe(true);
  for (const value of [
    undefined,
    {},
    new Error("unknown"),
    error("ECONNRESET"),
    Object.assign(error("ECONNREFUSED"), { retryAfterMs: 1 }),
  ])
    expect(safePreDispatchFailure(value)).toBe(false);
  let nested: Error = error("ECONNREFUSED");
  for (let i = 0; i < 5; i++) nested = new Error("wrapper", { cause: nested });
  expect(safePreDispatchFailure(nested)).toBe(false);
});
