// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  TaskPanel,
  dollars,
  unfinished,
} from "../apps/desktop/src/renderer/TaskPanel.js";
import type { Api, Task } from "../apps/desktop/src/renderer/api.js";
afterEach(cleanup);
const task: Task = {
  input_identity_version: 1,
  id: "task",
  thread_id: "chat",
  state: "awaiting_approval",
  revision: 1,
  allowance: 100,
  confirmed: 0,
  reserved: 0,
  estimate: 200,
  decision_id: "decision",
  generation_id: null,
  attempt_settled: 0,
  execution_outcome: null,
  attempt_id: null,
  partial_text: "",
  provider_attempts: 0,
  retry_waiting: 0,
};
function mount(t = task) {
  const request = vi.fn(),
    refresh = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskPanel
      task={t}
      api={{ request } as unknown as Api}
      refresh={refresh}
    />,
  );
  return { request, refresh };
}
test("approval remains service-owned when incidental refresh fails", async () => {
  const { request, refresh } = mount();
  request.mockResolvedValue({ ...task, state: "queued" });
  refresh.mockRejectedValue(new Error("refresh unavailable"));
  fireEvent.change(screen.getByLabelText("New total allowance (USD)"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve increase" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(request).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(request).toHaveBeenCalledWith("/tasks/task/decision", "POST", {
    decisionId: "decision",
    revision: 1,
    approved: true,
    allowanceUsd: "1",
  });
});
test("denial preserves allowance; stale failures show an actionable error and do not dispatch", async () => {
  const { request } = mount();
  request.mockRejectedValue(new Error("Decision is stale"));
  fireEvent.click(screen.getByRole("button", { name: "Deny increase" }));
  await screen.findByText("Decision is stale");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[2]).toMatchObject({
    approved: false,
    allowanceUsd: dollars(100),
  });
});
test("accounting refresh preserves uncertainty and never starts execution", async () => {
  const { request, refresh } = mount({
    ...task,
    state: "uncertain",
    generation_id: "gen-one",
    reserved: 200,
  });
  request.mockResolvedValue(task);
  fireEvent.click(screen.getByRole("button", { name: "Refresh accounting" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledTimes(1);
  request.mockRejectedValueOnce(new Error("Unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh accounting" }));
  await screen.findByText("Unavailable");
});
test.each([
  "queued",
  "running",
  "completed",
  "failed",
  "denied",
  "interrupted",
] as const)(
  "renders %s without inventing available funds or recovery",
  (state) => {
    mount({ ...task, state, confirmed: 150 });
    expect(screen.getByRole("region", { name: "Task allowance" })).toBeTruthy();
    expect(screen.getByText(/Available \$0.00/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("exceeded");
    expect(unfinished({ ...task, state })).toBe(
      ["queued", "running", "interrupted"].includes(state),
    );
    expect(dollars(0)).toBe("0.00");
  },
);

test("Stop carries current attempt/revision; request failure refreshes state without claiming termination", async () => {
  const { request, refresh } = mount({
    ...task,
    state: "running",
    attempt_id: "run",
    provider_attempts: 1,
    retry_waiting: 1,
  });
  request.mockRejectedValue(new Error("Task changed"));
  fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(request).toHaveBeenCalledWith("/tasks/task/stop", "POST", {
    attemptId: "run",
    revision: 1,
  });
  expect(screen.getByRole("alert").textContent).toContain("Task changed");
});
test("Stopping is not terminal; stopped billing remains distinct", () => {
  mount({ ...task, state: "stopping" });
  expect(
    screen.getByRole("button", { name: "Stopping…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(unfinished({ ...task, state: "stopping" })).toBe(true);
  cleanup();
  mount({ ...task, state: "stopped", provider_attempts: 1 });
  expect(screen.getByText(/Local execution has ended/)).toBeTruthy();
  expect(unfinished({ ...task, state: "stopped" })).toBe(false);
});
test("successful Stop refreshes; failed refresh remains explicitly unconfirmed", async () => {
  const { request, refresh } = mount({
    ...task,
    state: "running",
    attempt_id: "run",
  });
  request.mockResolvedValue({ state: "stopping" });
  refresh.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not confirm Stop",
    ),
  );
});

test("Resume carries revision, exposes errors, and never submits a new instruction", async () => {
  const { request, refresh } = mount({
    ...task,
    state: "interrupted",
    attempt_settled: 1,
  });
  request.mockRejectedValueOnce(new Error("Saved progress unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Resume task" }));
  await screen.findByText("Saved progress unavailable");
  request.mockResolvedValue(task);
  fireEvent.click(screen.getByRole("button", { name: "Resume task" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(request).toHaveBeenLastCalledWith("/tasks/task/resume", "POST", {
    revision: 1,
  });
});
test.each([
  {
    provider_attempts: 1,
    reserved: 10,
    generation_id: null,
    input_identity_version: 1,
  },
  {
    provider_attempts: 1,
    reserved: 10,
    generation_id: "gen-pending",
    input_identity_version: 1,
  },
  {
    provider_attempts: 0,
    reserved: 0,
    generation_id: null,
    input_identity_version: 0,
  },
])("blocked recovery never exposes an unusable Resume", (overrides) => {
  mount({ ...task, state: "interrupted", attempt_id: "old", ...overrides });
  expect(screen.queryByRole("button", { name: "Resume task" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "Resume unavailable",
  );
});
