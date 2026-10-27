import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { taskRoutes } from "../apps/agent-service/src/task-routes.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { privateFixture, cleanUp } from "./fixtures.js";
const billing = vi.hoisted(() => ({ cost: vi.fn() }));
vi.mock("../apps/agent-service/src/accounting.js", async (original) => ({
  ...(await original<
    typeof import("../apps/agent-service/src/accounting.js")
  >()),
  generationCost: billing.cost,
}));
let fixture: ReturnType<typeof privateFixture>,
  p: ReturnType<typeof openPersistence>,
  app: ReturnType<typeof taskRoutes>,
  thread: string;
beforeEach(async () => {
  fixture = privateFixture();
  p = openPersistence(fixture.path);
  app = taskRoutes(p.tasks, p.metadata);
  thread = randomUUID();
  await p.metadata.set(thread, { kind: "put", metadata: {} });
  billing.cost.mockReset();
});
afterEach(() => cleanUp([() => p.close(), () => fixture.remove()]));
const req = (path: string, body?: unknown) =>
  app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const payload = () => ({
  id: randomUUID(),
  threadId: thread,
  instruction: "instruction",
  allowanceUsd: "0",
});
test("submission boundary accepts immutable identity and rejects malformed or conflicting requests", async () => {
  for (const body of [
    null,
    [],
    {},
    { ...payload(), extra: true },
    { ...payload(), allowanceUsd: 1 },
  ])
    expect((await req("/tasks", body)).status).toBe(400);
  const body = payload();
  expect((await req("/tasks", body)).status).toBe(200);
  expect((await req("/tasks", body)).status).toBe(200);
  expect(
    (await req("/tasks", { ...body, instruction: "changed" })).status,
  ).toBe(409);
  expect(await (await req("/tasks")).json()).toHaveLength(1);
});
test("decisions bind revision/identity and return current state without duplicate changes", async () => {
  const body = payload();
  await req("/tasks", body);
  const t = p.tasks.admit(body.id, 0, 10)!;
  const decision = {
    decisionId: t.decision_id,
    revision: t.revision,
    approved: true,
    allowanceUsd: "0.00000002",
  };
  for (const malformed of [
    {},
    { ...decision, revision: 1.1 },
    { ...decision, extra: 1 },
  ])
    expect((await req("/tasks/" + t.id + "/decision", malformed)).status).toBe(
      400,
    );
  expect(
    (await req("/tasks/" + t.id + "/decision", { ...decision, revision: 0 }))
      .status,
  ).toBe(409);
  expect((await req("/tasks/" + t.id + "/decision", decision)).status).toBe(
    200,
  );
  expect(p.tasks.get(t.id).state).toBe("queued");
});
test("accounting never dispatches; unknown stays reserved and stale/rapid requests are denied", async () => {
  const body = { ...payload(), allowanceUsd: "1" };
  await req("/tasks", body);
  const r = p.tasks.admit(body.id, 0, 20)!;
  p.tasks.recordGeneration(r.id, r.attempt_id!, "gen-test");
  const u = p.tasks.settle(r.id, r.attempt_id!, r.revision, null, true);
  const path = "/tasks/" + r.id + "/accounting";
  expect((await req(path, {})).status).toBe(400);
  expect((await req(path, { revision: 0 })).status).toBe(409);
  billing.cost.mockResolvedValueOnce(null);
  expect((await req(path, { revision: u.revision })).status).toBe(200);
  expect(p.tasks.get(r.id).reserved).toBe(20);
  expect((await req(path, { revision: u.revision })).status).toBe(409);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16000);
  billing.cost.mockResolvedValueOnce(3);
  expect((await req(path, { revision: u.revision })).status).toBe(200);
  expect(p.tasks.get(r.id)).toMatchObject({
    state: "completed",
    confirmed: 3,
    reserved: 0,
  });
  expect(billing.cost).toHaveBeenCalledTimes(2);
});
