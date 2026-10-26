import { serve } from "@hono/node-server";
import { createServiceApp } from "./app.js";
import { openPersistence } from "./persistence.js";

// Set before dynamically loading the provider graph. No tracing is opted into.
process.env.LANGSMITH_TRACING = "false";
process.env.LANGSMITH_TRACING_V2 = "false";
process.umask(0o077);

async function main() {
  const directory = process.env.HARNESS_DATA_DIR;
  const token = process.env.HARNESS_SERVICE_TOKEN;
  if (!directory || !token)
    throw new Error("Set HARNESS_DATA_DIR and HARNESS_SERVICE_TOKEN.");
  // Existing workspace graph factory, built by the root build command.
  const graphModule = await import(
    new URL("../../../packages/agent/dist/general-chat.js", import.meta.url)
      .href
  );
  const agent = await graphModule.createGeneralChatAgent();
  const persistence = openPersistence(directory);
  try {
    const app = createServiceApp({
      graph: { "general-chat": agent.graph },
      persistence,
      token,
    });
    const server = serve({
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 2024,
    });
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        persistence.close();
      });
      if ("closeAllConnections" in server) server.closeAllConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.once("error", () => {
      persistence.close();
      process.exitCode = 1;
      console.error("Service listener failed.");
    });
  } catch (error) {
    persistence.close();
    throw error;
  }
}

main().catch(() => {
  // Never print provider/credential errors or configuration values.
  console.error(
    "Service startup failed; check configuration, credentials and data-directory ownership.",
  );
  process.exitCode = 1;
});
