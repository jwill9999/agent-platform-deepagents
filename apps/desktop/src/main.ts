import { app, BrowserWindow, protocol, session } from "electron";
import { readFile } from "node:fs/promises";

const smoke = process.argv.includes("--scaffold-smoke");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "harness",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.enableSandbox();

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1000,
    height: 720,
    show: !smoke,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await window.loadURL("harness://app/");
  if (smoke) {
    const result: unknown = await window.webContents.executeJavaScript(
      `({ title: document.title, heading: document.querySelector('h1')?.textContent, nodeAvailable: typeof process !== 'undefined' || typeof require !== 'undefined' })`,
    );
    if (
      !result ||
      typeof result !== "object" ||
      !("title" in result) ||
      result.title !== "Agent Harness" ||
      !("heading" in result) ||
      result.heading !== "Agent Harness" ||
      !("nodeAvailable" in result) ||
      result.nodeAvailable !== false
    ) {
      throw new Error("Desktop scaffold smoke check failed");
    }
    console.info(
      "Desktop scaffold smoke check passed: document loaded; Node globals unavailable.",
    );
    app.quit();
  }
}

async function bootstrap(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  protocol.handle("harness", async (request) => {
    if (request.url !== "harness://app/")
      return new Response(null, { status: 404 });
    const html = await readFile(
      new URL("../renderer/index.html", import.meta.url),
      "utf8",
    );
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  });
  try {
    await createWindow();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

void app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0)
    void createWindow().catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
});
