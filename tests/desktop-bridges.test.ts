import { expect, test, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: {
    invoke: bridge.invoke,
    on: bridge.on,
    removeListener: bridge.remove,
  },
}));
test("sandbox preload exposes only fixed requests and removable activity listeners", async () => {
  await import("../apps/desktop/src/preload.js");
  expect(bridge.expose).toHaveBeenCalledOnce();
  const [name, api] = bridge.expose.mock.calls[0]!;
  expect(name).toBe("harness");
  expect(Object.keys(api)).toEqual([
    "connection",
    "cancelNotifications",
    "notify",
    "testNotification",
    "onActivity",
    "onNotificationStatus",
  ]);
  bridge.invoke.mockResolvedValue({
    url: "http://127.0.0.1:2024",
    token: "synthetic",
  });
  expect(await api.connection()).toEqual({
    url: "http://127.0.0.1:2024",
    token: "synthetic",
  });
  expect(bridge.invoke).toHaveBeenCalledWith("harness:connection");
  await api.cancelNotifications();
  await api.notify("session");
  await api.testNotification();
  expect(bridge.invoke).toHaveBeenCalledWith("harness:notifications-cancel");
  expect(bridge.invoke).toHaveBeenCalledWith("harness:notify", "session");
  expect(bridge.invoke).toHaveBeenCalledWith("harness:notification-test");
  for (const [method, channel, value] of [
    ["onActivity", "harness:activity-open", 7],
    ["onNotificationStatus", "harness:notification-status", "shown"],
  ] as const) {
    const callback = vi.fn();
    const unsubscribe = api[method](callback);
    const listener = bridge.on.mock.calls.at(-1)![1];
    listener({}, value);
    expect(callback).toHaveBeenCalledWith(value);
    unsubscribe();
    expect(bridge.remove).toHaveBeenCalledWith(channel, listener);
  }
});
