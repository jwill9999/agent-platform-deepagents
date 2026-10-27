import { afterEach, beforeEach, expect, test, vi } from "vitest";

const s = vi.hoisted(() => ({
  serve: vi.fn(),
  factory: vi.fn(),
  getRun: vi.fn(),
  finishRun: vi.fn(),
  app: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  drain: vi.fn(),
  serverClose: vi.fn(),
  connections: vi.fn(),
  serverOnce: vi.fn(),
}));
vi.mock("@harness/agent", () => ({ createServiceAgent: s.factory }));
vi.mock("@hono/node-server", () => ({ serve: s.serve }));
vi.mock("../apps/agent-service/src/app.js", () => ({
  createServiceApp: s.app,
}));
vi.mock("../apps/agent-service/src/persistence.js", () => ({
  openPersistence: s.open,
}));
let signals: Map<string, () => void>;
let oldMask: number;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  signals = new Map();
  oldMask = process.umask();
  process.exitCode = 0;
  vi.stubEnv("HARNESS_DATA_DIR", "/synthetic-not-opened");
  vi.stubEnv(
    "HARNESS_SERVICE_TOKEN",
    "synthetic-token-long-enough-for-service",
  );
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "environment");
  vi.stubEnv("OPENROUTER_API_KEY", "invalid-synthetic");
  vi.stubEnv("OPENROUTER_MODEL", "synthetic/no-call");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "once").mockImplementation(((
    name: string,
    fn: () => void,
  ) => {
    signals.set(name, fn);
    return process;
  }) as typeof process.once);
  s.factory.mockResolvedValue({ graph: {} });
  s.open.mockReturnValue({
    close: s.close,
    metadata: { getRun: s.getRun, finishRun: s.finishRun },
  });
  s.app.mockReturnValue({ fetch: vi.fn(), close: s.drain });
  s.drain.mockResolvedValue(undefined);

  s.serve.mockReturnValue({
    close: s.serverClose,
    closeAllConnections: s.connections,
    once: s.serverOnce,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
});
afterEach(() => {
  process.umask(oldMask);
  process.exitCode = 0;
  vi.unstubAllGlobals();
});
const start = () => import("../apps/agent-service/src/main.js");
test("standalone startup binds loopback, disables tracing and closes storage once across signals", async () => {
  await start();
  await vi.waitFor(() => expect(s.serve).toHaveBeenCalled());
  expect(s.serve).toHaveBeenCalledWith(
    expect.objectContaining({ hostname: "127.0.0.1", port: 2024 }),
  );
  expect(process.env.LANGSMITH_TRACING).toBe("false");
  expect(process.umask()).toBe(0o077);
  signals.get("SIGINT")!();
  signals.get("SIGTERM")!();
  await vi.waitFor(() => expect(s.close).toHaveBeenCalledOnce());
  expect(s.connections).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
test("listener error releases storage and reports a generic failure", async () => {
  await start();
  await vi.waitFor(() => expect(s.serverOnce).toHaveBeenCalled());
  s.serverOnce.mock.calls[0]![1](new Error("private detail"));
  expect(s.close).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledWith("Service listener failed.");
});
test("construction failure closes storage and never logs sensitive configuration", async () => {
  s.app.mockImplementation(() => {
    throw new Error("invalid-synthetic");
  });
  await start();
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(s.close).toHaveBeenCalledOnce();
  expect(s.serve).not.toHaveBeenCalled();
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "invalid-synthetic",
  );
});
test.each(["HARNESS_DATA_DIR", "HARNESS_SERVICE_TOKEN"])(
  "missing %s prevents resource creation",
  async (name) => {
    vi.stubEnv(name, "");
    await start();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(s.open).not.toHaveBeenCalled();
    expect(s.serve).not.toHaveBeenCalled();
  },
);

test("model failure callback records only a running admission and preserves terminal outcomes", async () => {
  await start();
  await vi.waitFor(() => expect(s.serve).toHaveBeenCalled());
  const failed = s.factory.mock.calls[0]![0];
  s.getRun.mockReturnValue({ status: "running" });
  failed("run");
  expect(s.finishRun).toHaveBeenCalledWith("run", "error");
  s.getRun.mockReturnValue({ status: "error" });
  failed("run");
  s.getRun.mockReturnValue(undefined);
  failed("missing");
  expect(s.finishRun).toHaveBeenCalledOnce();
});
