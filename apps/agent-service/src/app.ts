import { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import { cors } from "hono/cors";
import { setupRoutes } from "./setup.js";
import { chatRoutes } from "./chat-routes.js";
import { activityRoutes } from "./activity.js";
import { taskRoutes } from "./task-routes.js";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { ExecutionControl } from "./execution-control.js";
import type { openPersistence } from "./persistence.js";

export function createServiceApp(options: {
  graph: Parameters<typeof createEmbedServer>[0]["graph"];
  persistence: ReturnType<typeof openPersistence>;
  token: string;
  connected?: boolean;
  execution?: ExecutionControl;
}) {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(options.token))
    throw new Error(
      "A service token of at least 32 URL-safe characters is required.",
    );
  const app = new Hono();
  app.onError((error, c) =>
    error instanceof HTTPException
      ? error.getResponse()
      : c.json({ error: "Service request failed" }, 500),
  );
  const execution =
    options.execution ?? new ExecutionControl(options.persistence.tasks);
  const framework = createEmbedServer({
    graph: Object.fromEntries(
      Object.entries(options.graph).map(([name, graph]) => [
        name,
        graph.withConfig({ callbacks: [execution.callbacks] }),
      ]),
    ),
    threads: options.persistence.metadata,
    checkpointer: options.persistence.checkpointer,
  });
  if (options.connected)
    app.use(
      cors({
        origin: "harness://app",
        allowMethods: ["GET", "POST", "PUT"],
        allowHeaders: ["Authorization", "Content-Type"],
        exposeHeaders: ["Content-Location"],
      }),
    );
  app.use(bearerAuth({ token: options.token }));
  app.use(bodyLimit({ maxSize: 1024 * 1024 }));
  // Trust only the packaged desktop origin; bearer authentication still applies.
  app.use(async (c, next) => {
    if (
      c.req.header("Origin") &&
      !(options.connected && c.req.header("Origin") === "harness://app")
    )
      return c.json({ error: "Browser access is not enabled" }, 403);
    await next();
  });
  app.get("/ok", (c) =>
    c.json({ ok: true, execution_enabled: Boolean(options.connected) }),
  );
  if (options.connected) {
    const attachedStreams = new Set<string>();
    app.use(async (_c, next) => {
      options.persistence.tasks.expireUnattached(attachedStreams);
      await next();
    });
    app.route("/", setupRoutes(options.persistence.metadata));
    app.route("/", activityRoutes(options.persistence.activity));
    app.route(
      "/",
      taskRoutes(
        options.persistence.tasks,
        options.persistence.metadata,
        execution,
      ),
    );
    app.route(
      "/",
      chatRoutes(
        framework,
        options.persistence.metadata,
        options.persistence.tasks,
        attachedStreams,
        execution,
      ),
    );
  }
  // Explicit allowlist: framework run/protocol/state-write/delete routes cannot bypass later admission policy.
  app.use(async (c, next) => {
    const path = c.req.path;
    const allowed =
      (c.req.method === "POST" &&
        (path === "/threads" ||
          path === "/threads/search" ||
          /^\/threads\/[0-9a-f-]+\/history$/i.test(path))) ||
      (c.req.method === "GET" &&
        /^\/threads\/[0-9a-f-]+(?:\/state(?:\/[0-9a-f-]+)?)?$/i.test(path));
    if (!allowed) return c.json({ error: "Route is not enabled" }, 404);
    await next();
  });
  app.route("/", framework);
  return app;
}
