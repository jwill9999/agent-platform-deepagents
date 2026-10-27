import { beforeEach, expect, test, vi } from "vitest";
import {
  readOpenRouterApiKey,
  saveOpenRouterApiKey,
} from "../packages/agent/src/credentials.js";

const keyring = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  entries: vi.fn(),
}));
vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: class {
    constructor(...args: unknown[]) {
      keyring.entries(...args);
    }
    getPassword = keyring.getPassword;
    setPassword = keyring.setPassword;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", undefined);
  vi.stubEnv("OPENROUTER_API_KEY", undefined);
  vi.stubEnv("HARNESS_KEYRING_SERVICE", undefined);
});

test("environment selection rejects absent/blank credentials and never accesses Keychain", async () => {
  await expect(readOpenRouterApiKey()).rejects.toThrow(/No OpenRouter/);
  vi.stubEnv("OPENROUTER_API_KEY", "  ");
  await expect(readOpenRouterApiKey()).rejects.toThrow(/No OpenRouter/);
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic");
  expect(await readOpenRouterApiKey()).toBe("synthetic");
  expect(keyring.entries).not.toHaveBeenCalled();
});
test("keyring uses the configured namespace and preserves the default", async () => {
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "keyring");
  keyring.getPassword.mockResolvedValue("synthetic");
  expect(await readOpenRouterApiKey()).toBe("synthetic");
  expect(keyring.entries).toHaveBeenLastCalledWith(
    "agent-platform-deepagents",
    "openrouter",
    { linux: { store: "secret-service" } },
  );
  vi.stubEnv("HARNESS_KEYRING_SERVICE", "dedicated-test-only");
  await readOpenRouterApiKey();
  expect(keyring.entries).toHaveBeenLastCalledWith(
    "dedicated-test-only",
    "openrouter",
    { linux: { store: "secret-service" } },
  );
});
test("missing/denied Keychain and invalid source fail without environment fallback", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "must-not-fallback");
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "keyring");
  keyring.getPassword.mockResolvedValue(null);
  await expect(readOpenRouterApiKey()).rejects.toThrow(/No OpenRouter/);
  keyring.getPassword.mockRejectedValue(new Error("Access denied"));
  await expect(readOpenRouterApiKey()).rejects.toThrow("Access denied");
  vi.stubEnv("HARNESS_KEYRING_SERVICE", " ");
  await expect(readOpenRouterApiKey()).rejects.toThrow(/must not be empty/);
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "unsupported");
  await expect(readOpenRouterApiKey()).rejects.toThrow(
    /environment or keyring/,
  );
});

test("credential writes use only the selected keyring namespace and surface failure", async () => {
  await expect(saveOpenRouterApiKey("synthetic")).rejects.toThrow(/keyring/);
  vi.stubEnv("HARNESS_CREDENTIAL_SOURCE", "keyring");
  await saveOpenRouterApiKey("synthetic");
  expect(keyring.setPassword).toHaveBeenCalledWith("synthetic");
  vi.stubEnv("HARNESS_KEYRING_SERVICE", " ");
  await expect(saveOpenRouterApiKey("synthetic")).rejects.toThrow(/namespace/);
  vi.stubEnv("HARNESS_KEYRING_SERVICE", "isolated-test");
  keyring.setPassword.mockRejectedValueOnce(new Error("Denied"));
  await expect(saveOpenRouterApiKey("synthetic")).rejects.toThrow("Denied");
});
