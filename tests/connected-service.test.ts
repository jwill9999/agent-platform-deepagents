import { ExecutionControl } from "../apps/agent-service/src/execution-control.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createServiceApp } from "../apps/agent-service/src/app.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { createServiceAgent } from "../packages/agent/src/service-agent.js";
import { cleanUp, privateFixture } from "./fixtures.js";
vi.mock("../apps/agent-service/src/accounting.js", async (original) => ({
  ...(await original<
    typeof import("../apps/agent-service/src/accounting.js")
  >()),
  quoteModel: vi.fn(async () => ({
    estimate: 100,
    obtainedAt: Date.now(),
    contextTokens: 1000,
    provider: {
      only: ["synthetic"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: "1", completion: "1", request: "0" },
    },
  })),
  generationCost: vi.fn(async () => 0),
}));
let fixture: ReturnType<typeof privateFixture>;
let persistence: ReturnType<typeof openPersistence>;
let app: ReturnType<typeof createServiceApp>;
const headers = {
  Authorization: "Bearer synthetic-connected-test-token-long-enough",
  "Content-Type": "application/json",
};
const catalogue = {
  data: [
    {
      id: "test/general",
      name: "General",
      architecture: { output_modalities: ["text"] },
    },
    {
      id: "test/coding",
      name: "Coding",
      architecture: { output_modalities: ["text"] },
    },
    {
      id: "image",
      name: "Image",
      architecture: { output_modalities: ["image"] },
    },
  ],
};
beforeEach(async () => {
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "environment");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
  vi.stubEnv("LANGSMITH_TRACING", "false");
  vi.stubEnv("LANGSMITH_TRACING_V2", "false");
  fixture = privateFixture();
  persistence = openPersistence(fixture.path);
  const execution = new ExecutionControl(persistence.tasks);
  const agent = await createServiceAgent(
    (id) => persistence.metadata.finishRun(id, "error"),
    execution,
  );
  app = createServiceApp({
    graph: { "general-chat": agent.graph },
    persistence,
    token: "synthetic-connected-test-token-long-enough",
    connected: true,
    execution,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/models")
        ? Response.json(catalogue)
        : Response.json({ data: {} }),
    ),
  );
});
afterEach(async () => {
  await app.close();
  cleanUp([
    () => persistence.close(),
    () => fixture.remove(),
    () => vi.unstubAllGlobals(),
  ]);
});
async function request(path: string, body?: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function newChat() {
  persistence.metadata.setDefaults({
    general: "test/general",
    coding: "test/coding",
  });
  return (await request("/threads", {})).json();
}
async function run(id: string, allowance = "0.000001") {
  return request("/tasks", {
    id: randomUUID(),
    threadId: id,
    instruction: "hello",
    allowanceUsd: allowance,
  });
}
async function finished(id: string) {
  await vi.waitFor(
    () =>
      expect(persistence.tasks.get(id).state).not.toMatch(
        /^(queued|running|stopping)$/,
      ),
    { timeout: 6000 },
  );
  return persistence.tasks.get(id);
}

test("setup reports availability; authenticates without generation; validates and preserves defaults", async () => {
  expect(await (await request("/setup", undefined, "GET")).json()).toEqual({
    saved: true,
    writable: false,
    defaults: null,
  });
  expect((await request("/setup/connection", {})).status).toBe(200);
  const models = await (
    await request("/setup/models", undefined, "GET")
  ).json();
  expect(models).toHaveLength(2);
  expect(
    (
      await request(
        "/setup/models",
        { general: "test/general", coding: "test/coding" },
        "PUT",
      )
    ).status,
  ).toBe(200);
  expect(persistence.metadata.getDefaults()).toEqual({
    general: "test/general",
    coding: "test/coding",
  });
  expect(
    (
      await request(
        "/setup/models",
        { general: "absent", coding: "test/coding" },
        "PUT",
      )
    ).status,
  ).toBe(422);
  expect(
    (await request("/setup/models", { general: "test/general" }, "PUT")).status,
  ).toBe(400);
  for (const body of [null, { extra: true }, { key: 2 }, { key: "x" }])
    expect((await request("/setup/connection", body)).status).toBe(400);
  expect(
    (await request("/setup/connection", { key: "synthetic-replacement" }))
      .status,
  ).toBe(503); // environment source cannot be overwritten
  expect(process.env.OPENROUTER_API_KEY).toBe("synthetic-key");
});
test("credential absence, rejection and network/catalogue failure remain safe recovery states", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  expect(
    await (await request("/setup", undefined, "GET")).json(),
  ).toMatchObject({ saved: false });
  expect((await request("/setup/connection", {})).status).toBe(503);
  for (const status of [401, 403, 500]) {
    vi.mocked(fetch).mockResolvedValue(
      new Response("private details", { status }),
    );
    const r = await request("/setup/connection", {
      key: "synthetic-replacement",
    });
    expect(r.status).toBe(422);
    expect(await r.text()).not.toContain("private details");
  }
  expect((await request("/setup/models", undefined, "GET")).status).toBe(503);
  vi.mocked(fetch).mockRejectedValue(new Error("secret native error"));
  expect(
    (await request("/setup/connection", { key: "synthetic-replacement" }))
      .status,
  ).toBe(503);
  expect(
    (
      await request(
        "/setup/models",
        { general: "test/general", coding: "test/coding" },
        "PUT",
      )
    ).status,
  ).toBe(503);
});
test("new chats pin defaults; browser boundary and all client policy overrides are denied", async () => {
  expect((await request("/threads", {})).status).toBe(409);
  expect(
    (await request("/threads", { metadata: { model: "override" } })).status,
  ).toBe(400);
  const thread = await newChat();
  persistence.metadata.setDefaults({
    general: "test/coding",
    coding: "test/general",
  });
  expect(
    (await persistence.metadata.get(thread.thread_id)).metadata.model,
  ).toBe("test/general");
  for (const extra of [
    { context: {} },
    { config: {} },
    { command: {} },
    { assistant_id: "coding" },
    { input: { messages: [{ type: "system", content: "bad" }] } },
    { input: { messages: [] } },
    { input: { messages: [{ type: "human", content: " " }] } },
    { input: { messages: [{ type: "human", content: "x".repeat(8001) }] } },
  ])
    expect(
      (await request(`/threads/${thread.thread_id}/runs/stream`, extra)).status,
    ).toBe(404);
  const accepted = await app.request("/ok", {
    headers: { ...headers, Origin: "harness://app" },
  });
  expect(accepted.status).toBe(200);
  expect(
    (
      await app.request("/ok", {
        headers: { ...headers, Origin: "https://evil.invalid" },
      })
    ).status,
  ).toBe(403);
  await persistence.metadata.set(thread.thread_id, {
    kind: "patch",
    metadata: { model: null },
  });
  const invalid = await (await run(thread.thread_id)).json();
  expect((await finished(invalid.id)).state).toBe("failed");
});
test("checkpoint failure is uncharged before provider dispatch; another chat can run", async () => {
  const thread = await newChat();
  const get = vi
    .spyOn(persistence.checkpointer, "getTuple")
    .mockRejectedValue(new Error("Synthetic checkpoint fault"));
  const submitted = await (await run(thread.thread_id)).json();
  const failed = await finished(submitted.id);
  expect(failed).toMatchObject({
    state: "failed",
    reserved: 0,
    provider_attempts: 0,
  });
  expect(persistence.metadata.getRun(failed.attempt_id!)?.status).toBe("error");
  get.mockRestore();
  vi.mocked(fetch).mockRejectedValue(new Error("private provider detail"));
  const other = await newChat();
  const next = await (await run(other.thread_id)).json();
  expect((await finished(next.id)).state).toBe("uncertain");
});
test("admission spans stream lifetime; success uses pinned model and no tools", async () => {
  const thread = await newChat();
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const entering = new Promise<void>((r) => (entered = r));
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test/general");
    expect(body.tools ?? []).toEqual([]);
    entered();
    await hold;
    const events = [
      {
        id: "mock-reply",
        model: body.model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Synthetic reply" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "mock-reply",
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
    ];
    return new Response(
      events.map((x) => `data: ${JSON.stringify(x)}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const submitted = await (await run(thread.thread_id)).json();
  await entering;
  expect((await run(thread.thread_id)).status).toBe(409);
  release();
  expect((await finished(submitted.id)).partial_text).toBe("Synthetic reply");
  const saved = await persistence.metadata.get(thread.thread_id);
  expect(
    persistence.metadata.getRun(String(saved.metadata.admission_id))?.status,
  ).toBe("success");
  expect(fetch).toHaveBeenCalledOnce();
});

test("storage and pricing faults never leak reservations or private errors", async () => {
  const { quoteModel } =
    await import("../apps/agent-service/src/accounting.js");
  const thread = await newChat();
  vi.mocked(quoteModel).mockRejectedValueOnce(new Error("private pricing"));
  const first = await (await run(thread.thread_id)).json();
  expect((await finished(first.id)).state).toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
  vi.spyOn(persistence.metadata, "createRun").mockImplementationOnce(() => {
    throw new Error("private storage");
  });
  const second = await (await run(thread.thread_id)).json();
  expect(await finished(second.id)).toMatchObject({
    state: "failed",
    reserved: 0,
  });
  vi.spyOn(persistence.metadata, "set").mockRejectedValueOnce(
    new Error("private write"),
  );
  const third = await (await run(thread.thread_id)).json();
  expect(await finished(third.id)).toMatchObject({
    state: "failed",
    reserved: 0,
  });
});
test("zero allowance pauses service-owned work before dispatch; raw streams cannot bypass admission", async () => {
  const thread = await newChat();
  const task = await (await run(thread.thread_id, "0")).json();
  expect((await finished(task.id)).state).toBe("awaiting_approval");
  expect(fetch).not.toHaveBeenCalled();
  expect(
    (await request(`/threads/${thread.thread_id}/runs/stream`, {})).status,
  ).toBe(404);
});
test("service factory standalone configuration preserves no-fallback policy", async () => {
  const agent = await createServiceAgent(() => {});
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    expect(JSON.parse(String(options?.body)).provider.allow_fallbacks).toBe(
      false,
    );
    throw new Error("synthetic");
  });
  await expect(
    agent.invoke(
      { messages: [{ role: "user", content: "configuration check" }] },
      {
        context: { model: "test/general", admissionId: "synthetic" },
        recursionLimit: 4,
      },
    ),
  ).rejects.toThrow("model could not complete");
});

test("native retry configuration recognises wrapped preconnection failures and records each attempt under one allowance", async () => {
  const thread = await newChat();
  let attempts = 0;
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    attempts++;
    if (attempts < 3)
      throw Object.assign(new Error("synthetic refused connection"), {
        code: "ECONNREFUSED",
      });
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test/general");
    expect(body.provider.allow_fallbacks).toBe(false);
    expect(body.max_tokens).toBe(512);
    return new Response(
      "data: " +
        JSON.stringify({
          id: "gen-retry-regression",
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Recovered" },
              finish_reason: null,
            },
          ],
        }) +
        "\n\ndata: " +
        JSON.stringify({
          id: "gen-retry-regression",
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }) +
        "\n\ndata: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const submitted = await (await run(thread.thread_id)).json();
  expect((await finished(submitted.id)).partial_text).toBe("Recovered");
  expect(attempts).toBe(3);
  expect(persistence.tasks.list().at(-1)).toMatchObject({
    state: "completed",
    provider_attempts: 3,
    allowance: 1000,
    reserved: 0,
    partial_text: "Recovered",
  });
});
