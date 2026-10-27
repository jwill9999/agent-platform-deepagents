import { useState } from "react";
import { Button } from "./components/ui/button.js";
import type { Api, Task } from "./api.js";

export const dollars = (nanos: number) =>
  (nanos / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, ".00");
export const unfinished = (task: Task) =>
  [
    "queued",
    "running",
    "stopping",
    "awaiting_approval",
    "uncertain",
    "interrupted",
  ].includes(task.state);

const titles: Record<Task["state"], string> = {
  queued: "Your task is queued",
  running: "Task running",
  stopping: "Stopping requested",
  stopped: "Stopped",
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
  disconnected = false,
}: {
  task: Task;
  api: Api;
  refresh: () => Promise<void>;
  disconnected?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(approved: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.request<Task>(`/tasks/${task.id}/decision`, "POST", {
        decisionId: task.decision_id,
        revision: task.revision,
        approved,
        allowanceUsd: approved ? amount : dollars(task.allowance),
      });
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
  async function resume() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/tasks/${task.id}/resume`, "POST", {
        revision: task.revision,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    setError("");
    try {
      await api.request(`/tasks/${task.id}/stop`, "POST", {
        attemptId: task.attempt_id,
        revision: task.revision,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await refresh();
      } catch {
        setError("Could not confirm Stop. Refresh the task status.");
      }
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
      <h2>
        {task.retry_waiting
          ? "Brief connection failure · retry waiting"
          : titles[task.state]}
      </h2>
      {task.state === "running" && (
        <>
          <p>
            {task.retry_waiting
              ? `Retry ${task.provider_attempts} of 2. Same task, model and allowance.`
              : "Your reply is running. Stop requests cancellation of this task only."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void stop()}
          >
            Stop task
          </Button>
        </>
      )}
      {task.state === "stopping" && (
        <>
          <p>
            Waiting for local execution to end. No new attempt will start.
            Provider charges may still arrive.
          </p>
          <Button disabled>Stopping…</Button>
        </>
      )}
      {task.state === "stopped" && (
        <p>
          Local execution has ended. This task stays stopped after restart and
          cannot be resumed. Any retained partial reply is incomplete; provider
          billing may still be pending.
        </p>
      )}
      {task.provider_attempts > 0 && (
        <p className="footnote">
          Provider attempts: {task.provider_attempts} of at most 3
        </p>
      )}
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
          Nothing restarts automatically. Resume continues this task from saved
          progress using its remaining allowance. A model step may need to run
          again.
        </p>
      )}
      {task.state === "interrupted" &&
        (task.reserved === 0 &&
        (task.input_identity_version > 0 || !task.attempt_id) &&
        (task.provider_attempts === 0 || task.attempt_settled) ? (
          <Button
            type="button"
            disabled={busy || task.confirmed > task.allowance}
            onClick={() => void resume()}
          >
            Resume task
          </Button>
        ) : (
          <p role="status">
            {task.input_identity_version === 0 && task.attempt_id ? (
              "Resume unavailable. This older task’s saved progress needs review before it can safely continue."
            ) : (
              <>
                Resume unavailable while the previous charge is unresolved.{" "}
                {task.generation_id
                  ? "Refresh accounting before continuing."
                  : "The provider charge cannot currently be looked up. No new request will be sent; unknown cost is not zero cost."}
              </>
            )}
          </p>
        ))}
      {task.state === "failed" && (
        <p>
          Pricing, admission or execution failed. No further attempts will
          start. Any bounded retries used this task’s original allowance and
          model.
        </p>
      )}
      <p className="task-amounts">
        {disconnected ? "Last known allowance" : "Allowance"} $
        {dollars(task.allowance)} · Confirmed ${dollars(task.confirmed)} ·
        Reserved ${dollars(task.reserved)} · Available $
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
      {["uncertain", "interrupted", "stopped"].includes(task.state) &&
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
