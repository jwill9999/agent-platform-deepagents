import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { chatRoutes } from "../apps/agent-service/src/chat-routes.js";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { privateFixture, cleanUp } from "./fixtures.js";
vi.mock("../apps/agent-service/src/accounting.js", () => ({
  quoteModel: async () => ({
    estimate: 10,
    provider: {
      only: ["synthetic"],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: { prompt: "1", completion: "1", request: "0" },
    },
  }),
  generationCost: async () => 1,
}));
let fixture: ReturnType<typeof privateFixture>,
  p: ReturnType<typeof openPersistence>;
beforeEach(() => {
  fixture = privateFixture();
  p = openPersistence(fixture.path);
});
afterEach(() => cleanUp([() => p.close(), () => fixture.remove()]));
async function run(response: Response) {
  const id = randomUUID();
  await p.metadata.set(id, { kind: "put", metadata: { model: "test/model" } });
  const task = p.tasks.submit(randomUUID(), id, "message", 100);
  const app = chatRoutes(
    { fetch: async () => response } as unknown as Parameters<
      typeof chatRoutes
    >[0],
    p.metadata,
    p.tasks,
  );
  return {
    task,
    response: await app.request(`/threads/${id}/runs/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assistant_id: "general-chat",
        metadata: { task_id: task.id },
      }),
    }),
  };
}
test("upstream refusal remains uncertain rather than refunding potentially charged work", async () => {
  const { task, response } = await run(new Response(null, { status: 502 }));
  expect(response.status).toBe(502);
  expect(p.tasks.get(task.id)).toMatchObject({
    state: "uncertain",
    reserved: 10,
    execution_outcome: "error",
  });
});
test("broken upstream body releases execution capacity while retaining uncertain cost", async () => {
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("synthetic disconnect"));
    },
  });
  const { task, response } = await run(new Response(upstream));
  await expect(response.text()).rejects.toThrow("interrupted");
  await vi.waitFor(() => expect(p.tasks.get(task.id).state).toBe("uncertain"));
});
test("retained generation identity reconciles exactly one charge after normal EOF", async () => {
  const message = { type: "ai", id: "gen-synthetic", content: "reply" };
  const { task, response } = await run(
    new Response(
      `event: values\ndata: ${JSON.stringify({ messages: [message] })}\n\n`,
    ),
  );
  await response.text();
  expect(p.tasks.get(task.id)).toMatchObject({
    state: "completed",
    confirmed: 1,
    reserved: 0,
    generation_id: "gen-synthetic",
  });
});
test("malformed observed stream cannot claim successful execution", async () => {
  const { task, response } = await run(
    new Response("event: values\ndata: invalid-json\n\n"),
  );
  await response.text();
  expect(p.tasks.get(task.id).execution_outcome).toBe("error");
});
