import { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import { cors } from "hono/cors";
import { setupRoutes } from "./setup.js";
import { chatRoutes } from "./chat-routes.js";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { openPersistence } from "./persistence.js";

export function createServiceApp(options: {
  graph: Parameters<typeof createEmbedServer>[0]["graph"];
  persistence: ReturnType<typeof openPersistence>;
  token: string;
  connected?: boolean;
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
  const framework = createEmbedServer({
    graph: options.graph,
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
    app.route("/", setupRoutes(options.persistence.metadata));
    app.route("/", chatRoutes(framework, options.persistence.metadata));
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
