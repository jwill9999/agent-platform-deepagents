import { readOpenRouterApiKey } from "@harness/agent";

/** Round upwards into integer nano-USD without floating-point accumulation. */
export function usdToNanos(value: string | number, units = 1): number {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match || !Number.isSafeInteger(units) || units < 0)
    throw new Error("Invalid price");
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0) + 9;
  if (Math.abs(exponent) > 30) throw new Error("Unsupported price precision");
  let amount = BigInt(match[1]! + (match[2] ?? "")) * BigInt(units);
  if (exponent >= 0) amount *= 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    amount = (amount + divisor - 1n) / divisor;
  }
  const result = Number(amount);
  if (!Number.isSafeInteger(result))
    throw new Error("Price exceeds supported range");
  return result;
}

export type Quote = {
  estimate: number;
  obtainedAt: number;
  contextTokens: number;
  provider: {
    only: string[];
    allow_fallbacks: false;
    require_parameters: true;
    max_price: { prompt: string; completion: string; request: string };
  };
};

/** Conservative context-capacity reservation, not a guaranteed billing cap. */
export async function quoteModel(model: string): Promise<Quote> {
  if (!/^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/.test(model))
    throw new Error("Model pricing cannot be checked");
  const response = await fetch(
    `https://openrouter.ai/api/v1/models/${model}/endpoints`,
    {
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("Model pricing unavailable");
  const body = (await response.json()) as { data?: { endpoints?: unknown[] } };
  const quotes: {
    tag: string;
    context: number;
    input: number;
    output: number;
    request: number;
    estimate: number;
  }[] = [];
  for (const raw of body.data?.endpoints ?? []) {
    const endpoint = raw as {
      tag?: string;
      context_length?: number;
      supported_parameters?: string[];
      pricing?: Record<string, unknown>;
    };
    const context = endpoint.context_length;
    if (
      !endpoint.tag ||
      !Number.isSafeInteger(context) ||
      context! <= 0 ||
      context! > 2_000_000 ||
      !endpoint.supported_parameters?.includes("max_tokens") ||
      !endpoint.supported_parameters.includes("reasoning")
    )
      continue;
    const pricing = endpoint.pricing;
    if (!pricing) continue;
    if (
      pricing.overrides !== undefined &&
      (!Array.isArray(pricing.overrides) ||
        pricing.overrides.some(
          (entry) =>
            !entry || typeof entry !== "object" || Array.isArray(entry),
        ))
    )
      continue;
    const rates = [
      pricing,
      ...(Array.isArray(pricing.overrides) ? pricing.overrides : []),
    ] as Record<string, unknown>[];
    let input = 0,
      output = 0,
      request = 0,
      estimate = 0;
    try {
      for (const rate of rates) {
        const effective = { ...pricing, ...rate };
        for (const [key, value] of Object.entries(effective)) {
          if (
            ![
              "prompt",
              "completion",
              "request",
              "input_cache_read",
              "input_cache_write",
              "discount",
              "overrides",
              "utc_start",
              "utc_end",
              "utc_days",
            ].includes(key) &&
            Number(value) !== 0
          )
            throw new Error("Unsupported charge category");
        }
        const prompt = Math.max(
          ...[
            effective.prompt,
            effective.input_cache_read ?? 0,
            effective.input_cache_write ?? 0,
          ].map((x) => {
            usdToNanos(String(x));
            return Number(x);
          }),
        );
        usdToNanos(String(effective.completion));
        const completion = Number(effective.completion);
        const fixed = Number(effective.request ?? 0);
        usdToNanos(fixed);
        input = Math.max(input, prompt);
        output = Math.max(output, completion);
        request = Math.max(request, fixed);
      }
      // Full advertised context covers system/history; output is additionally reserved.
      estimate =
        usdToNanos(input, context!) +
        usdToNanos(output, 512) +
        usdToNanos(request);
      if (!Number.isSafeInteger(estimate)) continue;
      quotes.push({
        tag: endpoint.tag,
        context: context!,
        input,
        output,
        request,
        estimate,
      });
    } catch {
      /* Unpriced categories are not eligible for dispatch. */
    }
  }
  if (!quotes.length)
    throw new Error("No supported pricing available; no model request sent");
  const input = Math.max(...quotes.map((q) => q.input));
  const output = Math.max(...quotes.map((q) => q.output));
  const request = Math.max(...quotes.map((q) => q.request));
  const contextTokens = Math.max(...quotes.map((q) => q.context));
  const estimate =
    usdToNanos(input, contextTokens) +
    usdToNanos(output, 512) +
    usdToNanos(request);
  if (!Number.isSafeInteger(estimate))
    throw new Error("Reservation exceeds supported range");
  return {
    estimate,
    contextTokens,
    obtainedAt: Date.now(),
    provider: {
      only: quotes.map((q) => q.tag),
      allow_fallbacks: false,
      require_parameters: true,
      max_price: {
        prompt: String(input * 1e6),
        completion: String(output * 1e6),
        request: String(request),
      },
    },
  };
}

/** One metadata request only. Unknown/late data is never a zero charge. */
export async function generationCost(id: string): Promise<number | null> {
  if (!/^gen-[A-Za-z0-9_-]+$/.test(id)) return null;
  try {
    const key = await readOpenRouterApiKey();
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return null;
    const { data } = (await response.json()) as {
      data?: { id?: string; total_cost?: number };
    };
    if (data?.id !== id || typeof data.total_cost !== "number") return null;
    return usdToNanos(data.total_cost);
  } catch {
    return null;
  }
}
