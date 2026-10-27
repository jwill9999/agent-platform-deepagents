import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TaskLifecycle } from "../apps/agent-service/src/task-lifecycle.js";
import { ExecutionControl } from "../apps/agent-service/src/execution-control.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { privateFixture, cleanUp } from "./fixtures.js";
const mocked = vi.hoisted(() => ({
  quote: vi.fn(),
  cost: vi.fn(),
  key: vi.fn(),
}));
vi.mock("../apps/agent-service/src/accounting.js", () => ({
  quoteModel: mocked.quote,
  generationCost: mocked.cost,
}));
vi.mock("@harness/agent", () => ({ readOpenRouterApiKey: mocked.key }));
let fixture: ReturnType<typeof privateFixture>,
  p: ReturnType<typeof openPersistence>,
  lifecycle: TaskLifecycle,
  execution: ExecutionControl;
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fixture = privateFixture();
  p = openPersistence(fixture.path);
  execution = new ExecutionControl(p.tasks);
  mocked.quote.mockReset().mockResolvedValue({ estimate: 10, provider: {} });
  mocked.cost.mockReset().mockResolvedValue(1);
  mocked.key.mockReset().mockResolvedValue("synthetic");
  request = vi.fn();
  lifecycle = new TaskLifecycle(
    { request } as unknown as ConstructorParameters<typeof TaskLifecycle>[0],
    p.metadata,
    p.tasks,
    execution,
  );
});
afterEach(async () => {
  await lifecycle.close();
  cleanUp([() => p.close(), () => fixture.remove()]);
});
async function task() {
  const thread = randomUUID();
  await p.metadata.set(thread, {
    kind: "put",
    metadata: { model: "test/model" },
  });
  return p.tasks.submit(randomUUID(), thread, "message", 100);
}
async function done(id: string) {
  await vi.waitFor(() =>
    expect(p.tasks.get(id).state).not.toMatch(/^(running|queued|stopping)$/),
  );
  return p.tasks.get(id);
}
const success = () =>
  new Response(
    `event: values\ndata: ${JSON.stringify({ messages: [{ type: "ai", id: "gen-synthetic", content: "reply" }] })}\n\n`,
  );
function provider(
  handler: (init: RequestInit) => Response | Promise<Response>,
) {
  request.mockImplementation((_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    execution.beforeAttempt(body.context.admissionId);
    return handler(init);
  });
}
test.each(["refusal", "throw", "broken", "malformed", "error-event"])(
  "charged %s preserves uncertain reservation, never a fabricated refund",
  async (kind) => {
    const t = await task();
    provider(() => {
      if (kind === "throw") throw new Error("lost response");
      if (kind === "refusal") return new Response(null, { status: 502 });
      if (kind === "broken")
        return new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("broken"));
            },
          }),
        );
      return new Response(
        kind === "malformed"
          ? "event: values\ndata: invalid\n\n"
          : "event: error\ndata: {}\n\n",
      );
    });
    lifecycle.kick();
    expect(await done(t.id)).toMatchObject({
      state: "uncertain",
      reserved: 10,
      confirmed: 0,
      execution_outcome: "error",
    });
    expect(mocked.cost).not.toHaveBeenCalled();
  },
);
test("completed generation settles once; non-generation events are ignored", async () => {
  const t = await task();
  provider(() => success());
  lifecycle.kick();
  await vi.waitFor(() => expect(p.tasks.get(t.id).state).toBe("completed"));
  expect(p.tasks.get(t.id)).toMatchObject({
    confirmed: 1,
    reserved: 0,
    generation_id: "gen-synthetic",
  });
  expect(mocked.cost).toHaveBeenCalledOnce();
});
test("unpublished charge remains pending even after successful execution", async () => {
  mocked.cost.mockResolvedValue(null);
  const t = await task();
  provider(() => success());
  lifecycle.kick();
  expect(await done(t.id)).toMatchObject({
    state: "uncertain",
    execution_outcome: "success",
    reserved: 10,
  });
});
test("no-dispatch refusals are uncharged; missing model and pricing failures never enter graph", async () => {
  const t = await task();
  request.mockResolvedValue(new Response(null, { status: 422 }));
  lifecycle.kick();
  expect(await done(t.id)).toMatchObject({
    state: "failed",
    reserved: 0,
    provider_attempts: 0,
  });
  const bad = await task();
  await p.metadata.set(bad.thread_id, {
    kind: "patch",
    metadata: { model: null },
  });
  lifecycle.kick();
  expect((await done(bad.id)).state).toBe("failed");
  mocked.quote.mockRejectedValueOnce(new Error("pricing"));
  const unpriced = await task();
  lifecycle.kick();
  expect((await done(unpriced.id)).state).toBe("failed");
  expect(request).toHaveBeenCalledOnce();
});
test("shutdown waits for model and root drain even when stream fails", async () => {
  const t = await task();
  let run = "";
  provider((init) => {
    run = JSON.parse(String(init.body)).context.admissionId;
    execution.enter(run);
    execution.callbacks.handleChainStart({}, {}, "root", undefined, [
      `task-execution:${run}`,
    ]);
    return new Response(
      new ReadableStream({
        start(c) {
          c.error(new Error("failed stream"));
        },
      }),
    );
  });
  lifecycle.kick();
  await vi.waitFor(() => expect(run).not.toBe(""));
  let closed = false;
  const closing = lifecycle.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(p.tasks.get(t.id).state).toBe("interrupted");
  execution.leave(run);
  await Promise.resolve();
  expect(closed).toBe(false);
  execution.callbacks.handleChainError(new Error("fault"), "root");
  await closing;
  expect(closed).toBe(true);
});
test("closing during pricing interrupts queued work without dispatch and refuses later Resume", async () => {
  let release!: (x: unknown) => void;
  mocked.quote.mockImplementation(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const t = await task();
  lifecycle.kick();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const closing = lifecycle.close();
  release({ estimate: 10, provider: {} });
  await closing;
  lifecycle.kick();
  expect(request).not.toHaveBeenCalled();
  expect(p.tasks.get(t.id).state).toBe("interrupted");
  await expect(
    lifecycle.resume(t.id, p.tasks.get(t.id).revision),
  ).rejects.toThrow("stopping");
});
test("pricing wakeup advances FIFO without a renderer and approval waiting releases slot", async () => {
  const a = await task(),
    b = await task();
  mocked.quote
    .mockResolvedValueOnce({ estimate: 101 })
    .mockResolvedValue({ estimate: 10 });
  request.mockResolvedValue(new Response("event: metadata\ndata: {}\n\n"));
  lifecycle.kick();
  lifecycle.kick();
  expect((await done(a.id)).state).toBe("awaiting_approval");
  expect((await done(b.id)).state).toBe("completed");
  expect(request).toHaveBeenCalledOnce();
});
async function interrupted() {
  const t = await task();
  p.tasks.interruptOnRestart();
  return p.tasks.get(t.id);
}
test("duplicate concurrent Resume is one admission; missing input has stable identity", async () => {
  const t = await interrupted();
  request.mockImplementation((url: string) =>
    url.endsWith("/state")
      ? Response.json({ values: { messages: [] }, next: [] })
      : success(),
  );
  const results = await Promise.all([
    lifecycle.resume(t.id, t.revision),
    lifecycle.resume(t.id, t.revision),
  ]);
  expect(results.every((x) => x.id === t.id)).toBe(true);
  await done(t.id);
  const posts = request.mock.calls.filter((c) => !c[0].endsWith("/state"));
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]![1].body).input.messages).toEqual([
    { type: "human", id: `task-${t.id}`, content: "message" },
  ]);
  await lifecycle.resume(t.id, t.revision);
  expect(mocked.quote).toHaveBeenCalledOnce();
});
test("pending checkpoint resumes null input while terminal checkpoint never quotes or dispatches", async () => {
  const t = await interrupted();
  request.mockImplementation((url: string) =>
    url.endsWith("/state")
      ? Response.json({
          values: { messages: [{ id: `task-${t.id}`, type: "human" }] },
          next: ["model"],
        })
      : success(),
  );
  await lifecycle.resume(t.id, t.revision);
  await done(t.id);
  expect(
    JSON.parse(
      request.mock.calls.find((c) => !c[0].endsWith("/state"))![1].body,
    ).input,
  ).toBeNull();
  const end = await interrupted();
  request.mockResolvedValue(
    Response.json({
      values: {
        messages: [
          { id: `task-${end.id}`, type: "human" },
          { id: "reply", type: "ai" },
        ],
      },
      next: [],
    }),
  );
  mocked.quote.mockClear();
  expect((await lifecycle.resume(end.id, end.revision)).state).toBe(
    "completed",
  );
  expect(mocked.quote).not.toHaveBeenCalled();
});
test.each(["unavailable", "later-human", "no-reply", "credential"])(
  "Resume rejects %s without claiming revision",
  async (kind) => {
    const t = await interrupted();
    const messages =
      kind === "later-human"
        ? [{ id: `task-${t.id}`, type: "human" }, { type: "human" }]
        : kind === "no-reply"
          ? [{ id: `task-${t.id}`, type: "human" }]
          : [];
    request.mockResolvedValue(
      kind === "unavailable"
        ? new Response(null, { status: 503 })
        : Response.json({ values: { messages }, next: [] }),
    );
    if (kind === "credential")
      mocked.key.mockRejectedValue(new Error("unavailable"));
    await expect(lifecycle.resume(t.id, t.revision)).rejects.toThrow();
    expect(p.tasks.get(t.id)).toEqual(t);
    expect(mocked.quote).not.toHaveBeenCalled();
  },
);
test("Resume rechecks shutdown after asynchronous credential read", async () => {
  const t = await interrupted();
  request.mockResolvedValue(Response.json({ values: {} }));
  let release!: (s: string) => void;
  mocked.key.mockImplementation(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  const resuming = lifecycle.resume(t.id, t.revision);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await lifecycle.close();
  release("synthetic");
  await expect(resuming).rejects.toThrow("stopping");
  expect(p.tasks.get(t.id).state).toBe("interrupted");
});
