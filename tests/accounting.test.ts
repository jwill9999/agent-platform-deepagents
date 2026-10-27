import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  generationCost,
  quoteModel,
  usdToNanos,
} from "../apps/agent-service/src/accounting.js";
const credentials = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@harness/agent", () => ({ readOpenRouterApiKey: credentials.read }));
const endpoint = {
  tag: "test",
  context_length: 1000,
  supported_parameters: ["max_tokens", "reasoning"],
  pricing: { prompt: "0.000001", completion: "0.000002" },
};
beforeEach(() => {
  credentials.read.mockResolvedValue("synthetic");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
function endpoints(value: unknown) {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ data: { endpoints: value } }),
  );
}
test("monetary conversion rounds fractions upwards without accumulated floating error", () => {
  expect(usdToNanos("0.0000000001")).toBe(1);
  expect(usdToNanos("4.99e-7")).toBe(499);
  expect(usdToNanos("1.2", 3)).toBe(3600000000);
  for (const value of ["bad", "-1", "1e99", "99999999999999999"])
    expect(() => usdToNanos(value)).toThrow();
  expect(() => usdToNanos("1", 0.5)).toThrow();
});
test("reservation includes full context, output, cache and all eligible price overrides; uses native provider controls", async () => {
  endpoints([
    {
      ...endpoint,
      pricing: {
        ...endpoint.pricing,
        request: "0.01",
        input_cache_read: "0.000003",
        input_cache_write: "0.000004",
        overrides: [
          { prompt: "0.000005", completion: "0.000006", utc_days: [1] },
        ],
      },
    },
    { ...endpoint, tag: "second", context_length: 2000 },
  ]);
  const q = await quoteModel("test/model");
  expect(q.estimate).toBe(23072000);
  expect(q.provider).toMatchObject({
    only: ["test", "second"],
    allow_fallbacks: false,
    require_parameters: true,
    max_price: { prompt: "5", completion: "6", request: "0.01" },
  });
});
test("missing, malformed or unsupported pricing fails closed instead of guessing a free charge", async () => {
  await expect(quoteModel("invalid")).rejects.toThrow();
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await expect(quoteModel("a/b")).rejects.toThrow();
  for (const e of [
    {},
    { ...endpoint, context_length: 0 },
    { ...endpoint, supported_parameters: [] },
    { ...endpoint, pricing: undefined },
    { ...endpoint, pricing: { ...endpoint.pricing, overrides: {} } },
    { ...endpoint, pricing: { ...endpoint.pricing, overrides: [null] } },
    { ...endpoint, pricing: { ...endpoint.pricing, image: "1" } },
    { ...endpoint, pricing: { prompt: "bad", completion: "0" } },
  ]) {
    endpoints([e]);
    await expect(quoteModel("a/b")).rejects.toThrow();
  }
  endpoints([]);
  await expect(quoteModel("a/b")).rejects.toThrow();
});
test("generation lookup treats unavailable, mismatched and invalid charges as unknown, never zero", async () => {
  expect(await generationCost("bad")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ data: { id: "gen-one", total_cost: 0.000000499 } }),
  );
  expect(await generationCost("gen-one")).toBe(499);
  for (const data of [
    { id: "gen-other", total_cost: 0 },
    { id: "gen-one" },
    { id: "gen-one", total_cost: -1 },
    undefined,
  ]) {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data }));
    expect(await generationCost("gen-one")).toBeNull();
  }
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
  expect(await generationCost("gen-one")).toBeNull();
  credentials.read.mockRejectedValueOnce(new Error("private"));
  expect(await generationCost("gen-one")).toBeNull();
});
