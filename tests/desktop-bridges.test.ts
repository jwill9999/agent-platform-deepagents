import { expect, test, vi } from "vitest";
const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: bridge.expose },
  ipcRenderer: { invoke: bridge.invoke },
}));
test("sandbox preload exposes only its fixed service-connection request", async () => {
  await import("../apps/desktop/src/preload.js");
  expect(bridge.expose).toHaveBeenCalledOnce();
  const [name, api] = bridge.expose.mock.calls[0]!;
  expect(name).toBe("harness");
  expect(Object.keys(api)).toEqual(["connection"]);
  bridge.invoke.mockResolvedValue({
    url: "http://127.0.0.1:2024",
    token: "synthetic",
  });
  expect(await api.connection()).toEqual({
    url: "http://127.0.0.1:2024",
    token: "synthetic",
  });
  expect(bridge.invoke).toHaveBeenCalledWith("harness:connection");
});
