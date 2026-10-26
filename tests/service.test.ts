import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServiceApp } from "../apps/agent-service/src/app.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { createGeneralChatAgent } from "../packages/agent/src/general-chat.js";
import { cleanUp, privateFixture } from "./fixtures.js";

let fixture: ReturnType<typeof privateFixture>;
let persistence: ReturnType<typeof openPersistence>;
const token = "synthetic-service-token-for-local-tests-only";
beforeEach(() => {
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "environment");
  vi.stubEnv("OPENROUTER_API_KEY", "invalid-synthetic-key");
  vi.stubEnv("OPENROUTER_MODEL", "synthetic/no-provider-call");
  vi.stubEnv("LANGSMITH_TRACING", "false");
  vi.stubEnv("LANGSMITH_TRACING_V2", "false");
  // Any unexpected provider/network call fails the test rather than spending credits.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("External calls forbidden in regression checks");
    }),
  );
  fixture = privateFixture();
  persistence = openPersistence(fixture.path);
});
afterEach(() => {
  cleanUp([
    () => persistence?.close(),
    () => fixture?.remove(),
    () => vi.unstubAllGlobals(),
  ]);
});
async function service() {
  const agent = await createGeneralChatAgent();
  return {
    app: createServiceApp({
      graph: { "general-chat": agent.graph },
      persistence,
      token,
    }),
    agent,
  };
}
function auth(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

test("factory requires explicit model and exported harness stays upstream", async () => {
  vi.stubEnv("OPENROUTER_MODEL", "");
  await expect(createGeneralChatAgent()).rejects.toThrow(/OPENROUTER_MODEL/);
  const upstream = await import("deepagents");
  const exported = await import("../packages/agent/src/index.js");
  expect(exported.createDeepAgent).toBe(upstream.createDeepAgent);
});

test("authentication, origin rejection, body cap and deny-by-default prevent execution", async () => {
  const { app, agent } = await service();
  expect(() =>
    createServiceApp({
      graph: { "general-chat": agent.graph },
      persistence,
      token: "short",
    }),
  ).toThrow(/token/);
  expect((await app.request("/ok")).status).toBe(401);
  expect(
    (
      await app.request("/ok", {
        headers: auth({ Origin: "https://untrusted.invalid" }),
      })
    ).status,
  ).toBe(403);
  const health = await app.request("/ok", { headers: auth() });
  expect(await health.json()).toEqual({ ok: true, execution_enabled: false });
  const id = randomUUID();
  for (const [method, path] of [
    ["POST", "/runs"],
    ["POST", `/threads/${id}/runs/stream`],
    ["POST", `/threads/${id}/state`],
    ["DELETE", `/threads/${id}`],
    ["GET", "/threads/not-an-id"],
    ["POST", "/protocol/stream"],
  ]) {
    expect(
      (await app.request(path!, { method: method!, headers: auth() })).status,
    ).toBe(404);
  }
  const tooLarge = await app.request("/threads", {
    method: "POST",
    headers: auth({ "Content-Type": "application/json" }),
    body: JSON.stringify({ metadata: { value: "x".repeat(1024 * 1024) } }),
  });
  expect(tooLarge.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

test("real framework HTTP routes preserve our metadata and checkpoint history across reopen", async () => {
  const { app, agent } = await service();
  const id = randomUUID();
  const create = () =>
    app.request("/threads", {
      method: "POST",
      headers: auth({ "Content-Type": "application/json" }),
      body: JSON.stringify({ thread_id: id, metadata: { label: "retained" } }),
    });
  expect((await create()).status).toBe(200);
  expect((await create()).status).toBe(409);
  // Use the documented checkpointer extension, with state updates only, never model execution.
  agent.graph.checkpointer = persistence.checkpointer;
  await agent.graph.updateState(
    { configurable: { thread_id: id } },
    { messages: [{ role: "user", content: "synthetic saved message" }] },
    "__start__",
  );
  const state = await app.request(`/threads/${id}/state`, { headers: auth() });
  expect(state.status).toBe(200);
  expect(await state.text()).toContain("synthetic saved message");
  const history = await app.request(`/threads/${id}/history`, {
    method: "POST",
    headers: auth({ "Content-Type": "application/json" }),
    body: "{}",
  });
  expect(history.status).toBe(200);
  expect(await history.text()).toContain("synthetic saved message");
  const search = await app.request("/threads/search", {
    method: "POST",
    headers: auth({ "Content-Type": "application/json" }),
    body: JSON.stringify({ metadata: { label: "retained" } }),
  });
  expect(search.status).toBe(200);
  expect(await search.text()).toContain(id);
  persistence.close();
  persistence = openPersistence(fixture.path);
  const reopened = await service();
  const thread = await reopened.app.request(`/threads/${id}`, {
    headers: auth(),
  });
  expect(thread.status).toBe(200);
  expect(await thread.text()).toContain("retained");
  const saved = await reopened.app.request(`/threads/${id}/state`, {
    headers: auth(),
  });
  expect(await saved.text()).toContain("synthetic saved message");
  expect(fetch).not.toHaveBeenCalled();
});

test("unexpected storage failure returns a generic response without exposing details", async () => {
  const { app } = await service();
  vi.spyOn(persistence.metadata, "get").mockRejectedValue(
    new Error("private internal details"),
  );
  const result = await app.request(`/threads/${randomUUID()}`, {
    headers: auth(),
  });
  expect(result.status).toBe(500);
  expect(await result.text()).not.toContain("private internal details");
});
