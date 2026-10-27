// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  ActivityHub,
  type Activity,
} from "../apps/desktop/src/renderer/ActivityHub.js";
import type { Api } from "../apps/desktop/src/renderer/api.js";
let events: Activity[],
  prefs: { enabled: boolean; theme: string },
  fail: string;
let request: ReturnType<typeof vi.fn>,
  open: Mock<(event: Activity | null) => Promise<void>>,
  unread: Mock<(count: number) => void>;
const event = (id: number): Activity => ({
  id,
  task_id: "task-" + id,
  thread_id: "thread",
  kind: "completed",
  created_at: 1,
  read_at: null,
});
beforeEach(() => {
  events = [event(1)];
  prefs = { enabled: false, theme: "system" };
  fail = "";
  open = vi.fn().mockResolvedValue(undefined);
  unread = vi.fn();
  window.harness = {
    connection: vi.fn(),
    cancelNotifications: vi.fn().mockResolvedValue(undefined),
    testNotification: vi.fn().mockResolvedValue("requested"),
  };
  request = vi.fn(async (path: string, method?: string, body?: unknown) => {
    if (path === fail) throw new Error("synthetic");
    if (path === "/activity/preferences") {
      if (method === "PUT") prefs = body as typeof prefs;
      return prefs;
    }
    if (path === "/activity/session") return { session: "synthetic" };
    if (path.startsWith("/activity?before="))
      return {
        events: events
          .filter((e) => e.id < Number(path.split("=")[1]))
          .slice(0, 50),
        unread: events.filter((e) => !e.read_at).length,
      };
    if (path === "/activity")
      return {
        events: events.slice(0, 50),
        unread: events.filter((e) => !e.read_at).length,
      };
    if (path.endsWith("/read")) {
      events.find((e) => e.id === Number(path.split("/")[2]))!.read_at = 10;
      return {};
    }
    return events.find((e) => e.id === Number(path.split("/")[2]));
  });
});
afterEach(() => cleanup());
const mount = (view: "chat" | "inbox" | "preferences" = "inbox") =>
  render(
    <ActivityHub
      api={{ request } as unknown as Api}
      view={view}
      onOpen={open}
      onUnread={unread}
    />,
  );
test("read is explicit and opening an event preserves decision authority", async () => {
  events = [
    { ...event(1), kind: "decision" },
    { ...event(2), kind: "failed" },
  ];
  mount();
  await screen.findByText("Decision required · Unread");
  fireEvent.click(screen.getByText("Review decision"));
  await waitFor(() => expect(open).toHaveBeenCalledWith(events[0]));
  expect(events[0]!.read_at).toBeNull();
  fireEvent.click(screen.getAllByText("Mark read")[0]!);
  await screen.findByText("Decision required · Read");
  expect(unread).toHaveBeenLastCalledWith(1);
});
test("read on an older page refreshes that page rather than jumping to newest", async () => {
  events = Array.from({ length: 52 }, (_, i) => event(52 - i));
  mount();
  await screen.findByText("Load older activity");
  fireEvent.click(screen.getByText("Load older activity"));
  await screen.findByText("Newest activity");
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  fireEvent.click(screen.getAllByText("Mark read")[0]!);
  await screen.findByText("Reply completed · Read");
  expect(request).toHaveBeenLastCalledWith("/activity?before=3");
  fireEvent.click(screen.getByText("Newest activity"));
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(50));
});
test("themes and opt-in use saved preferences; failures retain actionable fallback", async () => {
  mount("preferences");
  await screen.findByText("Dark");
  fireEvent.click(screen.getByText("Dark"));
  await waitFor(() =>
    expect(document.documentElement.dataset.theme).toBe("dark"),
  );
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(prefs.enabled).toBe(true));
  fireEvent.click(screen.getByText("Send test notification"));
  await waitFor(() =>
    expect(window.harness.testNotification).toHaveBeenCalledOnce(),
  );
  window.harness.testNotification = vi
    .fn()
    .mockRejectedValue(new Error("native unavailable"));
  fireEvent.click(screen.getByText("Send test notification"));
  await screen.findByText(/Notification could not be shown/);
  fail = "/activity/preferences";
  fireEvent.click(screen.getByText("Light"));
  await screen.findByText(/Preferences could not be saved/);
  expect(prefs.theme).toBe("dark");
});
test("service failures and missing targets preserve inbox and show errors", async () => {
  fail = "/activity";
  mount();
  await screen.findByText(/Activity connection unavailable/);
  cleanup();
  fail = "";
  open.mockRejectedValueOnce(new Error("missing"));
  mount();
  await screen.findByText("Open conversation");
  fireEvent.click(screen.getByText("Open conversation"));
  await screen.findByText(/Conversation unavailable/);
  expect(open).toHaveBeenLastCalledWith(null);
  fail = "/activity/1/read";
  fireEvent.click(screen.getByText("Mark read"));
  await screen.findByText(/Read state was not confirmed/);
});
test("empty and unknown historical events are bounded presentation states", async () => {
  events = [];
  mount();
  await screen.findByText(/No activity yet/);
  cleanup();
  events = [{ ...event(1), kind: "future", read_at: 1 }];
  mount();
  await screen.findByText("Activity update · Read");
  expect((screen.getByText("Mark read") as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("native callbacks resolve current event state, preserve missing targets and unsubscribe", async () => {
  let activity!: (id: number | null) => void, status!: (value: string) => void;
  const offActivity = vi.fn(),
    offStatus = vi.fn();
  window.harness.onActivity = (cb) => {
    activity = cb;
    return offActivity;
  };
  window.harness.onNotificationStatus = (cb) => {
    status = cb;
    return offStatus;
  };
  prefs.enabled = true;
  window.harness.notify = vi
    .fn()
    .mockResolvedValueOnce("superseded")
    .mockResolvedValue("unavailable");
  const view = mount("preferences");
  await screen.findByText("Dark");
  status("shown");
  await screen.findByText(/macOS reported a notification shown/);
  activity(1);
  await waitFor(() => expect(open).toHaveBeenCalledWith(events[0]));
  activity(null);
  await waitFor(() => expect(open).toHaveBeenCalledWith(null));
  fail = "/activity/2";
  activity(2);
  await screen.findByText(/Activity target unavailable/);
  await screen.findByText(
    /Notification could not be shown/,
    {},
    { timeout: 2500 },
  );
  expect(
    request.mock.calls.filter((c) => c[0] === "/activity/session").length,
  ).toBeGreaterThan(1);
  view.unmount();
  expect(offActivity).toHaveBeenCalledOnce();
  expect(offStatus).toHaveBeenCalledOnce();
  expect(window.harness.cancelNotifications).toHaveBeenCalled();
});

test("pagination errors leave a retry path and missing native capability disables testing", async () => {
  events = Array.from({ length: 51 }, (_, i) => event(51 - i));
  mount();
  await screen.findByText("Load older activity");
  fail = "/activity?before=2";
  fireEvent.click(screen.getByText("Load older activity"));
  await screen.findByText("Could not load older activity.");
  fail = "/activity";
  fireEvent.click(screen.getByText("Newest activity"));
  await screen.findByText("Could not refresh activity.");
  cleanup();
  fail = "";
  delete window.harness.testNotification;
  mount("preferences");
  await screen.findByText("Send test notification");
  expect(
    (screen.getByText("Send test notification") as HTMLButtonElement).disabled,
  ).toBe(true);
});
