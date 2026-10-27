import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { MetadataStore } from "./metadata.js";

export function chatRoutes(metadata: MetadataStore) {
  const app = new Hono();
  app.post("/threads", async (c) => {
    const body: unknown = await c.req.json();
    if (!body || typeof body !== "object" || Object.keys(body).length)
      return c.json({ error: "New chat takes no overrides" }, 400);
    const defaults = metadata.getDefaults();
    if (!defaults) return c.json({ error: "Choose model defaults first" }, 409);
    const id = randomUUID();
    return c.json(
      await metadata.set(id, {
        kind: "put",
        metadata: { model: defaults.general, title: "New chat" },
      }),
    );
  });
  return app;
}
