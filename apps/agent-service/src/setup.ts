import { Hono } from "hono";
import { readOpenRouterApiKey, saveOpenRouterApiKey } from "@harness/agent";
import type { MetadataStore } from "./metadata.js";

export type ModelChoice = { id: string; name: string };
export async function modelCatalogue(): Promise<ModelChoice[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Catalogue unavailable");
  const result = (await response.json()) as {
    data: {
      id: string;
      name: string;
      architecture?: { output_modalities?: string[] };
    }[];
  };
  return result.data
    .filter(
      (m) =>
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        m.architecture?.output_modalities?.includes("text"),
    )
    .map(({ id, name }) => ({ id, name }));
}

export function setupRoutes(metadata: MetadataStore) {
  const app = new Hono();
  app.get("/setup", async (c) => {
    let saved = false;
    try {
      saved = Boolean(await readOpenRouterApiKey());
    } catch {
      /* absence is a setup state */
    }
    return c.json({
      saved,
      defaults: metadata.getDefaults(),
      writable: process.env.HARNESS_CREDENTIAL_SOURCE === "keyring",
    });
  });
  app.post("/setup/connection", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !body ||
      typeof body !== "object" ||
      Object.keys(body).some((k) => k !== "key")
    )
      return c.json({ error: "Invalid connection request" }, 400);
    const key = "key" in body ? body.key : undefined;
    if (
      key !== undefined &&
      (typeof key !== "string" || !/^[!-~]{10,512}$/.test(key))
    )
      return c.json({ error: "Enter a valid API key" }, 400);
    let credential: string;
    try {
      credential = typeof key === "string" ? key : await readOpenRouterApiKey();
    } catch {
      return c.json(
        {
          error:
            "Keychain access unavailable. Unlock Keychain or check the configured credential source.",
        },
        503,
      );
    }
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${credential}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        return c.json(
          {
            error:
              response.status === 401 || response.status === 403
                ? "OpenRouter rejected this key. Existing credentials are unchanged."
                : "OpenRouter is unavailable. Try again later.",
          },
          422,
        );
    } catch {
      return c.json(
        { error: "Could not reach OpenRouter. Try again later." },
        503,
      );
    }
    if (typeof key === "string") {
      try {
        await saveOpenRouterApiKey(key);
      } catch {
        return c.json(
          {
            error:
              "Keychain could not save the key. Unlock Keychain or allow access, then retry.",
          },
          503,
        );
      }
    }
    return c.json({ connected: true });
  });
  app.get("/setup/models", async (c) => {
    try {
      return c.json(await modelCatalogue());
    } catch {
      return c.json(
        { error: "Model catalogue unavailable. Saved choices are unchanged." },
        503,
      );
    }
  });
  app.put("/setup/models", async (c) => {
    const body: unknown = await c.req.json();
    if (
      !body ||
      typeof body !== "object" ||
      Object.keys(body).length !== 2 ||
      !("general" in body) ||
      !("coding" in body) ||
      typeof body.general !== "string" ||
      typeof body.coding !== "string"
    )
      return c.json({ error: "Select both model defaults" }, 400);
    let models: ModelChoice[];
    try {
      models = await modelCatalogue();
    } catch {
      return c.json(
        { error: "Model catalogue unavailable. Saved choices are unchanged." },
        503,
      );
    }
    if (
      ![body.general, body.coding].every((id) =>
        models.some((m) => m.id === id),
      )
    )
      return c.json(
        { error: "Choose available text models. No fallback is selected." },
        422,
      );
    metadata.setDefaults({ general: body.general, coding: body.coding });
    return c.json(metadata.getDefaults());
  });
  return app;
}
