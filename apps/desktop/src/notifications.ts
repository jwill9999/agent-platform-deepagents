import { Notification, ipcMain, BrowserWindow } from "electron";
import type { IpcMainInvokeEvent } from "electron";

type Event = { id: number; kind: string };
const labels: Record<string, string> = {
  completed: "Reply completed",
  failed: "Task failed",
  stopped: "Task stopped",
  interrupted: "Task interrupted",
  decision: "Decision required",
};
async function service(path: string, body?: unknown) {
  const token = process.env.HARNESS_SERVICE_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(token))
    throw new Error("Connection unavailable");
  const response = await fetch("http://127.0.0.1:2024" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Activity connection unavailable");
  return response.json();
}

/** Narrow desktop adapter: no agent execution, provider key or arbitrary URLs. */
export function registerNotifications() {
  const retained = new Set<Notification>();
  let pending = false;
  let generation = 0;
  const watched = new WeakSet<object>();
  function trust(event: IpcMainInvokeEvent) {
    if (event.senderFrame?.url !== "harness://app/")
      throw new Error("Untrusted frame");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new Error("Desktop unavailable");
    if (!watched.has(event.sender)) {
      watched.add(event.sender);
      event.sender.on("did-start-navigation", () => {
        generation++;
      });
      event.sender.once("destroyed", () => {
        generation++;
      });
    }
    return window;
  }
  function show(window: BrowserWindow, event?: Event) {
    if (!Notification.isSupported()) return "unavailable";
    const notification = new Notification({
      title: event
        ? (labels[event.kind] ?? "Activity update")
        : "Agent Platform notifications",
      body: "Open Agent Platform to review your activity.",
      silent: true,
    });
    retained.add(notification);
    const status = (value: string) => {
      if (!window.isDestroyed())
        window.webContents.send("harness:notification-status", value);
    };
    notification.once("failed", () => {
      status("unavailable");
      retained.delete(notification);
    });
    notification.once("show", () => status("shown"));
    notification.once("close", () => retained.delete(notification));
    notification.once("click", () => {
      retained.delete(notification);
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
        window.webContents.send("harness:activity-open", event?.id ?? null);
      }
    });
    // Release references after a bounded lifetime; inbox state is independent.
    const timer = setTimeout(() => retained.delete(notification), 300000);
    timer.unref();
    notification.show();
    return "requested";
  }
  ipcMain.handle("harness:notifications-cancel", (event) => {
    trust(event);
    generation++;
  });
  ipcMain.handle("harness:notify", async (event, session: unknown) => {
    const window = trust(event);
    if (typeof session !== "string" || !/^[0-9a-f-]{36}$/i.test(session))
      throw new Error("Invalid session");
    if (pending) return "pending";
    pending = true;
    const currentGeneration = generation;
    try {
      const events: unknown = await service("/activity/notifications", {
        session,
      });
      if (!Array.isArray(events)) throw new Error("Invalid activity response");
      const valid = await service("/activity/session-valid", { session });
      if (
        !valid.valid ||
        currentGeneration !== generation ||
        window.isDestroyed()
      )
        return "superseded";
      let result = "idle";
      for (const item of events) {
        if (
          !window.isDestroyed() &&
          currentGeneration === generation &&
          item &&
          Number.isSafeInteger(item.id) &&
          item.id > 0 &&
          Object.hasOwn(labels, item.kind)
        )
          result = show(window, item);
      }
      return result;
    } finally {
      pending = false;
    }
  });
  ipcMain.handle("harness:notification-test", async (event) => {
    const window = trust(event);
    const currentGeneration = generation;
    const preferences = await service("/activity/preferences");
    if (preferences.enabled !== true)
      throw new Error("Enable notifications first");
    if (currentGeneration !== generation || window.isDestroyed())
      return "superseded";
    return show(window);
  });
}
