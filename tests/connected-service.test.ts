import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createServiceApp } from "../apps/agent-service/src/app.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { createServiceAgent } from "../packages/agent/src/service-agent.js";
import { cleanUp, privateFixture } from "./fixtures.js";
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
  const agent = await createServiceAgent((id) =>
    persistence.metadata.finishRun(id, "error"),
  );
  app = createServiceApp({
    graph: { "general-chat": agent.graph },
    persistence,
    token: "synthetic-connected-test-token-long-enough",
    connected: true,
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
afterEach(() =>
  cleanUp([
    () => persistence.close(),
    () => fixture.remove(),
    () => vi.unstubAllGlobals(),
  ]),
);
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
function run(id: string, extra = {}) {
  return request(`/threads/${id}/runs/stream`, {
    assistant_id: "general-chat",
    input: { messages: [{ type: "human", content: "hello" }] },
    ...extra,
  });
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
    expect((await run(thread.thread_id, extra)).status).toBe(400);
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
  expect((await run(thread.thread_id)).status).toBe(409);
});
test("framework checkpoint failure is durable error before EOF and permits explicit later send", async () => {
  const thread = await newChat();
  const get = vi
    .spyOn(persistence.checkpointer, "getTuple")
    .mockRejectedValue(new Error("Synthetic checkpoint fault"));
  const response = await run(thread.thread_id);
  expect(await response.text()).toContain("event: error");
  const saved = await persistence.metadata.get(thread.thread_id);
  expect(
    persistence.metadata.getRun(String(saved.metadata.admission_id))?.status,
  ).toBe("error");
  get.mockRestore();
  vi.mocked(fetch).mockRejectedValue(new Error("sensitive provider details"));
  const again = await run(thread.thread_id);
  expect(again.status).toBe(200);
  const body = await again.text();
  expect(body).toContain("model could not complete");
  expect(body).not.toContain("sensitive provider details");
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
  const response = await run(thread.thread_id);
  await entering;
  expect((await run(thread.thread_id)).status).toBe(409);
  release();
  expect(await response.text()).toContain("Synthetic reply");
  const saved = await persistence.metadata.get(thread.thread_id);
  expect(
    persistence.metadata.getRun(String(saved.metadata.admission_id))?.status,
  ).toBe("success");
  expect(fetch).toHaveBeenCalledOnce();
});

test("admission storage failures return generic errors and release the unfinished slot", async () => {
  const thread = await newChat();
  const original = persistence.metadata.set.bind(persistence.metadata);
  vi.spyOn(persistence.metadata, "set").mockRejectedValueOnce(
    new Error("private storage detail"),
  );
  const result = await run(thread.thread_id);
  expect(result.status).toBe(502);
  expect(await result.text()).not.toContain("private storage detail");
  // A later explicit send reaches the framework instead of remaining blocked.
  vi.mocked(fetch).mockRejectedValue(new Error("synthetic"));
  const next = await run(thread.thread_id);
  expect(next.status).toBe(200);
  await next.text();
  await original("invalid-framework-id", {
    kind: "put",
    metadata: { model: "test/general" },
  });
  expect((await run("invalid-framework-id")).status).toBe(502);
});
