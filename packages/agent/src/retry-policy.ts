/** Only failures positively identified before a connection was made are replayable.
 * Timeouts, resets, HTTP errors and partial responses can already have incurred cost.
 */
export function safePreDispatchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const item = current as Error & { code?: string; retryAfterMs?: number };
    // Hinted provider errors are not positively established pre-connection failures.
    if (item.retryAfterMs !== undefined) return false;
    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(item.code ?? ""))
      return true;
    current = item.cause;
  }
  return false;
}

export interface ExecutionPolicy {
  enter(run: string): void;
  leave(run: string): void;
  beforeAttempt(run: string): void;
  rejectedBeforeDispatch(run: string): boolean;
  token(run: string, token: string): void;
}
