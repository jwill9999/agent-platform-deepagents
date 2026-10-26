import { afterEach, expect, test, vi } from "vitest";
import { connect } from "../apps/desktop/src/renderer/api.js";
afterEach(() => vi.unstubAllGlobals());
test("renderer binds authenticated fixed-service SDK and safe JSON setup requests", async () => {
  vi.stubGlobal("window", {
    harness: {
      connection: async () => ({
        url: "http://127.0.0.1:2024",
        token: "synthetic",
      }),
    },
  });
  const network = vi.fn().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", network);
  const api = await connect();
  expect(network.mock.calls[0]![0]).toBe("http://127.0.0.1:2024/ok");
  expect(network.mock.calls[0]![1].headers.Authorization).toBe(
    "Bearer synthetic",
  );
  network.mockResolvedValueOnce(Response.json({ saved: true }));
  expect(await api.request("/setup/connection", "POST", {})).toEqual({
    saved: true,
  });
  network.mockResolvedValueOnce(
    Response.json({ error: "Connection rejected" }, { status: 422 }),
  );
  await expect(api.request("/setup")).rejects.toThrow("Connection rejected");
  network.mockResolvedValueOnce(Response.json({}, { status: 500 }));
  await expect(api.request("/setup")).rejects.toThrow("Service request failed");
});
