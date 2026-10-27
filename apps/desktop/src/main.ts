import { app, BrowserWindow, protocol, session, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const smoke = process.argv.includes("--scaffold-smoke");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "harness",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.exit(0);

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: !smoke,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
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
      result.title !== "Agent Platform Deep Agents" ||
      !("heading" in result) ||
      typeof result.heading !== "string" ||
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
  ipcMain.handle("harness:connection", (event) => {
    if (event.senderFrame?.url !== "harness://app/")
      throw new Error("Untrusted frame");
    const token = process.env.HARNESS_SERVICE_TOKEN;
    if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(token))
      throw new Error("Local service connection is not configured");
    return { url: "http://127.0.0.1:2024", token };
  });
  protocol.handle("harness", async (request) => {
    const url = new URL(request.url);
    if (
      url.host !== "app" ||
      (url.pathname !== "/" &&
        !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))
    )
      return new Response(null, { status: 404 });
    const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const types: Record<string, string> = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      woff2: "font/woff2",
    };
    try {
      const body = await readFile(
        new URL(`./renderer/${path}`, import.meta.url),
      );
      return new Response(body, {
        headers: {
          "Content-Type":
            types[path.split(".").at(-1)!] ?? "application/octet-stream",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src http://127.0.0.1:2024; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
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
