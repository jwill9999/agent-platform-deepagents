import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Regression of our Electron binding after the recorded native scaffold smoke pass.
// These doubles do not establish native Electron/installer acceptance.
const e = vi.hoisted(() => ({
  whenReady: vi.fn(),
  lock: vi.fn(),
  ipc: vi.fn(),
  enableSandbox: vi.fn(),
  quit: vi.fn(),
  exit: vi.fn(),
  on: vi.fn(),
  register: vi.fn(),
  handle: vi.fn(),
  permission: vi.fn(),
  windowOptions: vi.fn(),
  loadURL: vi.fn(),
  execute: vi.fn(),
  openHandler: vi.fn(),
  webOn: vi.fn(),
  all: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    whenReady: e.whenReady,
    requestSingleInstanceLock: e.lock,
    enableSandbox: e.enableSandbox,
    quit: e.quit,
    exit: e.exit,
    on: e.on,
  },
  ipcMain: { handle: e.ipc },
  protocol: { registerSchemesAsPrivileged: e.register, handle: e.handle },
  session: { defaultSession: { setPermissionRequestHandler: e.permission } },
  BrowserWindow: class {
    constructor(options: unknown) {
      e.windowOptions(options);
    }
    static getAllWindows = e.all;
    webContents = {
      setWindowOpenHandler: e.openHandler,
      on: e.webOn,
      executeJavaScript: e.execute,
    };
    loadURL = e.loadURL;
  },
}));
const originalArgs = [...process.argv];
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  e.lock.mockReturnValue(true);
  e.whenReady.mockResolvedValue(undefined);
  e.loadURL.mockResolvedValue(undefined);
  e.all.mockReturnValue([]);
  e.execute.mockResolvedValue({
    title: "Agent Platform Deep Agents",
    heading: "Agent Platform Deep Agents",
    nodeAvailable: false,
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = originalArgs;
});
async function start(smoke = false) {
  process.argv = smoke ? [...originalArgs, "--scaffold-smoke"] : originalArgs;
  await import("../apps/desktop/src/main.js");
  await vi.waitFor(() => expect(e.loadURL).toHaveBeenCalled());
}

test("desktop denies new windows/navigation/permissions and serves only its CSP-protected document", async () => {
  await start();
  expect(e.enableSandbox).toHaveBeenCalledOnce();
  expect(e.windowOptions).toHaveBeenCalledWith(
    expect.objectContaining({
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: expect.stringContaining("preload.cjs"),
      },
    }),
  );
  expect(e.openHandler.mock.calls[0]![0]()).toEqual({ action: "deny" });
  const preventDefault = vi.fn();
  e.webOn.mock.calls[0]![1]({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  const callback = vi.fn();
  e.permission.mock.calls[0]![0](null, "camera", callback);
  expect(callback).toHaveBeenCalledWith(false);
  const serve = e.handle.mock.calls[0]![1];
  expect((await serve({ url: "harness://app/untrusted" })).status).toBe(404);
  const response: Response = await serve({ url: "harness://app/" });
  expect(await response.text()).toContain("Agent Platform Deep Agents");
  expect(response.headers.get("content-security-policy")).toContain(
    "default-src 'self'",
  );
  expect(e.quit).not.toHaveBeenCalled();
});

test("smoke mode hides the window and exits only after checking document and Node isolation", async () => {
  await start(true);
  await vi.waitFor(() => expect(e.quit).toHaveBeenCalledOnce());
  expect(e.windowOptions).toHaveBeenCalledWith(
    expect.objectContaining({ show: false }),
  );
  expect(e.execute.mock.calls[0]![0]).toContain("typeof require");
  expect(e.exit).not.toHaveBeenCalled();
});

test.each([
  null,
  1,
  {},
  { title: "wrong" },
  { title: "Agent Platform Deep Agents" },
  { title: "Agent Platform Deep Agents", heading: "wrong" },
  {
    title: "Agent Platform Deep Agents",
    heading: "Agent Platform Deep Agents",
  },
  {
    title: "Agent Platform Deep Agents",
    heading: "Agent Platform Deep Agents",
    nodeAvailable: true,
  },
])("invalid smoke result fails closed: %j", async (result) => {
  e.execute.mockResolvedValue(result);
  await start(true);
  await vi.waitFor(() => expect(e.exit).toHaveBeenCalledWith(1));
  expect(e.quit).not.toHaveBeenCalled();
});

test("readiness and initial load failure cause failure exit", async () => {
  e.whenReady.mockRejectedValue(new Error("readiness"));
  await import("../apps/desktop/src/main.js");
  await vi.waitFor(() => expect(e.exit).toHaveBeenCalledWith(1));
  expect(e.windowOptions).not.toHaveBeenCalled();
});

test("activation opens a missing window, retains existing windows, and reports loading failure", async () => {
  await start();
  const activate = e.on.mock.calls.find(([name]) => name === "activate")![1];
  e.all.mockReturnValue([{}]);
  activate();
  expect(e.windowOptions).toHaveBeenCalledOnce();
  e.all.mockReturnValue([]);
  e.loadURL.mockRejectedValue(new Error("load failure"));
  activate();
  await vi.waitFor(() => expect(e.exit).toHaveBeenCalledWith(1));
  const closed = e.on.mock.calls.find(
    ([name]) => name === "window-all-closed",
  )![1];
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  closed();
  expect(e.quit).toHaveBeenCalledOnce();
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  closed();
  expect(e.quit).toHaveBeenCalledOnce();
});

test("IPC exposes only configured local connection to the trusted main frame", async () => {
  await start();
  const handler = e.ipc.mock.calls[0]![1];
  expect(() =>
    handler({ senderFrame: { url: "https://untrusted.invalid" } }),
  ).toThrow("Untrusted");
  vi.stubEnv("HARNESS_SERVICE_TOKEN", "");
  expect(() => handler({ senderFrame: { url: "harness://app/" } })).toThrow(
    "not configured",
  );
  vi.stubEnv(
    "HARNESS_SERVICE_TOKEN",
    "synthetic-long-token-for-local-service-only",
  );
  expect(handler({ senderFrame: { url: "harness://app/" } })).toEqual({
    url: "http://127.0.0.1:2024",
    token: "synthetic-long-token-for-local-service-only",
  });
  const serve = e.handle.mock.calls[0]![1];
  expect((await serve({ url: "harness://app/assets/missing.js" })).status).toBe(
    404,
  );
});
