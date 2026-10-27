import { useState } from "react";
import { Button } from "./components/ui/button.js";
import type { Api, Task } from "./api.js";

export const dollars = (nanos: number) =>
  (nanos / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, ".00");
export const unfinished = (task: Task) =>
  [
    "queued",
    "running",
    "awaiting_approval",
    "uncertain",
    "interrupted",
  ].includes(task.state);

const titles: Record<Task["state"], string> = {
  queued: "Your task is queued",
  running: "Task running",
  awaiting_approval: "Approve an allowance increase",
  completed: "Reply and charge saved",
  failed: "Task failed",
  denied: "Increase denied",
  uncertain: "Charge pending",
  interrupted: "Execution interrupted",
};

export function TaskPanel({
  task,
  api,
  refresh,
  start,
}: {
  task: Task;
  api: Api;
  refresh: () => Promise<void>;
  start: (task: Task) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      const updated = await api.request<Task>(
        `/tasks/${task.id}/decision`,
        "POST",
        {
          decisionId: task.decision_id,
          revision: task.revision,
          approved,
          allowanceUsd: approved ? amount : dollars(task.allowance),
        },
      );
      if (approved && updated.state === "queued") start(updated);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      try {
        await refresh();
      } catch {
        /* preserve actionable error */
      }
    } finally {
      setBusy(false);
    }
  }
  async function accounting() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/tasks/${task.id}/accounting`, "POST", {
        revision: task.revision,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="task-panel" aria-label="Task allowance">
      <h2>{titles[task.state]}</h2>
      {task.state === "queued" && (
        <p>
          No model request yet. This task starts once when capacity is
          available. You can open another chat.
        </p>
      )}
      {task.state === "awaiting_approval" && (
        <p>
          No model request has been sent. Waiting for your decision releases the
          execution slot.
        </p>
      )}
      {task.state === "denied" && (
        <p>
          No additional model request was sent. Your allowance is unchanged.
        </p>
      )}
      {task.state === "uncertain" && (
        <p>
          The provider has not confirmed this charge. Its reservation remains
          held; no further request will be sent for this task.
        </p>
      )}
      {task.state === "interrupted" && (
        <p>
          Execution was interrupted. Accounting can be refreshed without
          restarting the task. Resume is not available in this slice.
        </p>
      )}
      {task.state === "failed" && (
        <p>
          Pricing, admission or execution failed. No automatic resend or model
          switch was made.
        </p>
      )}
      <p className="task-amounts">
        Allowance ${dollars(task.allowance)} · Confirmed $
        {dollars(task.confirmed)} · Reserved ${dollars(task.reserved)} ·
        Available $
        {dollars(Math.max(0, task.allowance - task.confirmed - task.reserved))}
      </p>
      {task.confirmed > task.allowance && (
        <p className="alert" role="alert">
          The provider-reported charge exceeded this allowance. No further
          dispatch is permitted for this task.
        </p>
      )}
      {task.state === "awaiting_approval" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void decide(true);
          }}
        >
          <p className="footnote">
            Required reservation ${dollars(task.estimate)}
          </p>
          <label htmlFor={`increase-${task.id}`}>
            New total allowance (USD)
          </label>
          <input
            id={`increase-${task.id}`}
            type="number"
            min="0.000000001"
            step="any"
            required
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="task-actions">
            <Button type="submit" disabled={busy || !amount}>
              Approve increase
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Deny increase
            </Button>
          </div>
        </form>
      )}
      {["uncertain", "interrupted"].includes(task.state) &&
        task.generation_id &&
        !task.attempt_settled && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void accounting()}
          >
            {busy ? "Checking accounting…" : "Refresh accounting"}
          </Button>
        )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <p className="footnote">
        Reservations are estimates, not guaranteed billing caps. Accounting
        refresh never generates a reply.
      </p>
    </section>
  );
}
