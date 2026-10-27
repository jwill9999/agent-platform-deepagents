import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  window: vi.fn(),
  supported: vi.fn(),
  instances: [] as any[],
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: Function) =>
      mocks.handlers.set(name, handler),
  },
  BrowserWindow: { fromWebContents: mocks.window },
  Notification: class extends EventEmitter {
    static isSupported = mocks.supported;
    show = vi.fn();
    constructor(public options: unknown) {
      super();
      mocks.instances.push(this);
    }
  },
}));
import { registerNotifications } from "../apps/desktop/src/notifications.js";
let sender: EventEmitter, win: any, fetcher: ReturnType<typeof vi.fn>;
const trusted = () => ({ sender, senderFrame: { url: "harness://app/" } });
const invoke = (name: string, ...args: unknown[]) =>
  mocks.handlers.get("harness:" + name)!(trusted(), ...args);
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.useFakeTimers();
  mocks.handlers.clear();
  mocks.instances.length = 0;
  mocks.supported.mockReturnValue(true);
  sender = new EventEmitter();
  win = {
    isDestroyed: vi.fn().mockReturnValue(false),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
  mocks.window.mockReturnValue(win);
  vi.stubEnv("HARNESS_SERVICE_TOKEN", "x".repeat(32));
  fetcher = vi.fn(async (url: string) =>
    response(
      url.endsWith("/preferences")
        ? { enabled: true }
        : url.endsWith("/session-valid")
          ? { valid: true }
          : [],
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  registerNotifications();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("only our app frame and an existing window may use the bridge", async () => {
  const handler = mocks.handlers.get("harness:notification-test")!;
  await expect(
    handler({ sender, senderFrame: { url: "https://untrusted" } }),
  ).rejects.toThrow("Untrusted");
  mocks.window.mockReturnValue(null);
  await expect(handler(trusted())).rejects.toThrow("Desktop unavailable");
  mocks.window.mockReturnValue(win);
  win.isDestroyed.mockReturnValue(true);
  await expect(handler(trusted())).rejects.toThrow("Desktop unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
test("test notification reports real callbacks and opens inbox without task action", async () => {
  expect(await invoke("notification-test")).toBe("requested");
  const notification = mocks.instances[0];
  expect(notification.options.body).not.toContain("synthetic secret");
  notification.emit("show");
  expect(win.webContents.send).toHaveBeenCalledWith(
    "harness:notification-status",
    "shown",
  );
  notification.emit("click");
  expect(win.focus).toHaveBeenCalledOnce();
  expect(win.webContents.send).toHaveBeenCalledWith(
    "harness:activity-open",
    null,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe(
    "Bearer " + "x".repeat(32),
  );
});
test("task notifications contain generic text and clicks carry only validated event identity", async () => {
  fetcher.mockImplementation(async (url: string) =>
    response(
      url.endsWith("/session-valid")
        ? { valid: true }
        : [
            { id: 7, kind: "decision", prompt: "synthetic secret" },
            { id: 0, kind: "failed" },
            { id: 8, kind: "unknown" },
            null,
          ],
    ),
  );
  expect(await invoke("notify", randomUUID())).toBe("requested");
  expect(mocks.instances).toHaveLength(1);
  const n = mocks.instances[0];
  expect(JSON.stringify(n.options)).not.toContain("synthetic secret");
  n.emit("click");
  expect(win.webContents.send).toHaveBeenCalledWith("harness:activity-open", 7);
});
test("disable or navigation during an asynchronous claim suppresses pending native display", async () => {
  let release!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        release = r;
      }),
  );
  const pending = invoke("notify", randomUUID());
  expect(await invoke("notify", randomUUID())).toBe("pending");
  invoke("notifications-cancel");
  release(response([{ id: 1, kind: "completed" }]));
  expect(await pending).toBe("superseded");
  expect(mocks.instances).toHaveLength(0);
  let prefs!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        prefs = r;
      }),
  );
  const testPending = invoke("notification-test");
  sender.emit("did-start-navigation");
  prefs(response({ enabled: true }));
  expect(await testPending).toBe("superseded");
  sender.emit("destroyed");
});
test("service failures, invalid sessions and malformed claims fail without display", async () => {
  await expect(invoke("notify", 7)).rejects.toThrow("Invalid session");
  vi.stubEnv("HARNESS_SERVICE_TOKEN", "bad");
  await expect(invoke("notification-test")).rejects.toThrow(
    "Connection unavailable",
  );
  vi.stubEnv("HARNESS_SERVICE_TOKEN", "x".repeat(32));
  fetcher.mockResolvedValueOnce(response({}, 503));
  await expect(invoke("notify", randomUUID())).rejects.toThrow(
    "Activity connection unavailable",
  );
  fetcher.mockResolvedValueOnce(response({}));
  await expect(invoke("notify", randomUUID())).rejects.toThrow(
    "Invalid activity response",
  );
  fetcher
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response({ valid: false }));
  expect(await invoke("notify", randomUUID())).toBe("superseded");
  fetcher.mockResolvedValueOnce(response({ enabled: false }));
  await expect(invoke("notification-test")).rejects.toThrow(
    "Enable notifications first",
  );
  expect(mocks.instances).toHaveLength(0);
});
test("unsupported or failed delivery preserves fallback and destroyed windows receive no callbacks", async () => {
  mocks.supported.mockReturnValue(false);
  expect(await invoke("notification-test")).toBe("unavailable");
  mocks.supported.mockReturnValue(true);
  await invoke("notification-test");
  const n = mocks.instances[0];
  n.emit("failed");
  expect(win.webContents.send).toHaveBeenCalledWith(
    "harness:notification-status",
    "unavailable",
  );
  await invoke("notification-test");
  const closed = mocks.instances[1];
  win.isDestroyed.mockReturnValue(true);
  closed.emit("show");
  closed.emit("click");
  closed.emit("close");
  expect(win.focus).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300000);
});
test("empty claims remain idle and unavailable platforms do not construct notifications", async () => {
  expect(await invoke("notify", randomUUID())).toBe("idle");
  fetcher
    .mockResolvedValueOnce(response([{ id: 1, kind: "failed" }]))
    .mockResolvedValueOnce(response({ valid: true }));
  mocks.supported.mockReturnValue(false);
  expect(await invoke("notify", randomUUID())).toBe("unavailable");
  expect(mocks.instances).toHaveLength(0);
});
