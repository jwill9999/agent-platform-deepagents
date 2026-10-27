import { Client } from "@langchain/langgraph-sdk";
export type Connection = { url: string; token: string };
declare global {
  interface Window {
    harness: { connection(): Promise<Connection> };
  }
}
export async function connect() {
  const { url, token } = await window.harness.connection();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const client = new Client({
    apiUrl: url,
    apiKey: null,
    defaultHeaders: headers,
    callerOptions: { maxRetries: 0 },
  });
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Service request failed");
    return result as T;
  }
  await request("/ok");
  return { client, request };
}
export type Api = Awaited<ReturnType<typeof connect>>;
export type Defaults = { general: string; coding: string };
export type Setup = {
  saved: boolean;
  writable: boolean;
  defaults: Defaults | null;
};
export type Model = { id: string; name: string };
export type Chat = {
  thread_id: string;
  metadata: { model: string; title: string };
};
export type Message = {
  type: string;
  content: unknown;
  response_metadata?: { model?: string; model_name?: string };
};
export type Task = {
  id: string;
  thread_id: string;
  state:
    | "queued"
    | "running"
    | "awaiting_approval"
    | "completed"
    | "failed"
    | "denied"
    | "uncertain"
    | "interrupted";
  revision: number;
  allowance: number;
  confirmed: number;
  reserved: number;
  estimate: number;
  decision_id: string | null;
  generation_id: string | null;
  attempt_settled: number;
  execution_outcome: "success" | "error" | null;
};
export function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

export function effectiveModel(message: Message | undefined): string {
  return (
    message?.response_metadata?.model_name ??
    message?.response_metadata?.model ??
    ""
  );
}
