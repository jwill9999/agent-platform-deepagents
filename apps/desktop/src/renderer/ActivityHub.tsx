import { useEffect, useRef, useState } from "react";
import type { Api } from "./api.js";
import { Button } from "./components/ui/button.js";
export type Activity = {
  id: number;
  task_id: string;
  thread_id: string;
  kind: string;
  created_at: number;
  read_at: number | null;
};
type Preferences = { enabled: boolean; theme: "system" | "light" | "dark" };
const titles: Record<string, string> = {
  completed: "Reply completed",
  failed: "Task failed",
  stopped: "Task stopped",
  interrupted: "Task interrupted",
  decision: "Decision required",
};
export function ActivityHub({
  api,
  view,
  onOpen,
  onUnread,
}: {
  api: Api;
  view: "chat" | "inbox" | "preferences";
  onOpen: (event: Activity | null) => Promise<void>;
  onUnread: (count: number) => void;
}) {
  const [events, setEvents] = useState<Activity[]>([]),
    [preferences, setPreferences] = useState<Preferences>(),
    [error, setError] = useState(""),
    [offline, setOffline] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [status, setStatus] = useState("unknown");
  const before = useRef<number | null>(null),
    preferenceVersion = useRef(0),
    refreshSequence = useRef(0),
    mounted = useRef(true),
    saving = useRef(false);
  const session = useRef<string | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    open = useRef(onOpen),
    unread = useRef(onUnread);
  open.current = onOpen;
  unread.current = onUnread;
  useEffect(() => {
    if (view !== "chat") heading.current?.focus();
  }, [view]);
  async function refresh() {
    const sequence = ++refreshSequence.current;
    const data = await api.request<{ events: Activity[]; unread: number }>(
      before.current === null
        ? "/activity"
        : `/activity?before=${before.current}`,
    );
    if (!mounted.current || sequence !== refreshSequence.current) return;
    setEvents(data.events);
    setMore(data.events.length === 50);
    unread.current(data.unread);
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const offStatus = window.harness.onNotificationStatus?.((value) => {
      if (active) setStatus(value);
    });
    const offOpen = window.harness.onActivity?.((id) => {
      void (async () => {
        try {
          const event =
            id === null ? null : await api.request<Activity>(`/activity/${id}`);
          if (active) await open.current(event);
        } catch {
          if (active) {
            await open.current(null);
            setError("Activity target unavailable. Your inbox is preserved.");
          }
        }
      })();
    });
    async function poll() {
      try {
        if (saving.current) return;
        const version = preferenceVersion.current;
        const prefs = await api.request<Preferences>("/activity/preferences");
        if (!active || version !== preferenceVersion.current) return;
        setPreferences(prefs);
        document.documentElement.dataset.theme = prefs.theme;
        await refresh();
        if (!active || version !== preferenceVersion.current) return;
        if (!session.current) {
          const next = await api.request<{ session: string }>(
            "/activity/session",
            "POST",
            {},
          );
          if (!active || version !== preferenceVersion.current) return;
          session.current = next.session;
        }
        if (!active || version !== preferenceVersion.current) return;
        if (prefs.enabled && window.harness.notify) {
          const result = await window.harness.notify(session.current);
          if (active && result === "unavailable") setStatus(result);
          if (result === "superseded") session.current = null;
        }
        if (active) setOffline(false);
      } catch {
        session.current = null;
        if (active) setOffline(true);
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      active = false;
      mounted.current = false;
      refreshSequence.current++;
      preferenceVersion.current++;
      clearTimeout(timer);
      offOpen?.();
      offStatus?.();
      session.current = null;
      void window.harness.cancelNotifications?.();
    };
  }, [api]);
  async function save(next: Preferences) {
    setBusy(true);
    preferenceVersion.current++;
    saving.current = true;
    setError("");
    try {
      await window.harness.cancelNotifications?.();
      const saved = await api.request<Preferences>(
        "/activity/preferences",
        "PUT",
        next,
      );
      setPreferences(saved);
      document.documentElement.dataset.theme = saved.theme;
      session.current = null;
      setStatus("unknown");
    } catch {
      setError(
        "Preferences could not be saved. Your previous choices are unchanged.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function read(id: number) {
    setBusy(true);
    try {
      await api.request(`/activity/${id}/read`, "POST", {});
      await refresh();
    } catch {
      setError("Read state was not confirmed. Retry when connected.");
    } finally {
      setBusy(false);
    }
  }
  async function older() {
    setBusy(true);
    try {
      before.current = events.at(-1)!.id;
      await refresh();
    } catch {
      setError("Could not load older activity.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="activity-panel"
      hidden={view === "chat"}
      aria-label={view === "preferences" ? "Preferences" : "Activity inbox"}
    >
      <h1 ref={heading} tabIndex={-1}>
        {view === "preferences" ? "Preferences" : "Activity inbox"}
      </h1>
      {offline && (
        <p role="alert" className="alert">
          Activity connection unavailable. Saved events may be out of date;
          changes are not confirmed.
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {view === "preferences" ? (
        <>
          {!preferences ? (
            <p role="status">Loading preferences…</p>
          ) : (
            <>
              <fieldset disabled={busy}>
                <legend>Appearance</legend>
                <div className="activity-actions">
                  {(["system", "light", "dark"] as const).map((theme) => (
                    <Button
                      key={theme}
                      variant="outline"
                      aria-pressed={preferences.theme === theme}
                      onClick={() => void save({ ...preferences, theme })}
                    >
                      {theme[0]!.toUpperCase() + theme.slice(1)}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Desktop notifications</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={preferences.enabled}
                    onChange={(e) =>
                      void save({ ...preferences, enabled: e.target.checked })
                    }
                  />
                  Enable notifications for new activity
                </label>
                <p>
                  The inbox always retains activity. Banners are requested only
                  while this window is connected; older events are not replayed
                  on reconnect or enable.
                </p>
                <p className="footnote" role="status">
                  {status === "shown"
                    ? "macOS reported a notification shown."
                    : status === "unavailable"
                      ? "Notification could not be shown. Your inbox remains available."
                      : "macOS controls permission and Focus. Delivery status is unknown."}{" "}
                  App opt-in does not confirm system permission.
                </p>
                <Button
                  variant="outline"
                  disabled={
                    !preferences.enabled ||
                    busy ||
                    !window.harness.testNotification
                  }
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setStatus(await window.harness.testNotification!());
                    } catch {
                      setStatus("unavailable");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Send test notification
                </Button>
              </fieldset>
              {busy && <p role="status">Saving or requesting notification…</p>}
            </>
          )}
        </>
      ) : (
        <>
          {!loaded ? (
            <p role="status">Loading activity…</p>
          ) : events.length === 0 ? (
            <p>
              No activity yet. Completion, failure and required decisions will
              appear here.
            </p>
          ) : (
            events.map((event) => (
              <article className="activity-event" key={event.id}>
                <h2>
                  {titles[event.kind] ?? "Activity update"} ·{" "}
                  {event.read_at === null ? "Unread" : "Read"}
                </h2>
                <p className="footnote">
                  {new Date(event.created_at).toLocaleString()} · Task{" "}
                  {event.task_id.slice(0, 8)}
                </p>
                <p>
                  {event.kind === "completed"
                    ? "Execution finished. Billing may still need confirmation."
                    : event.kind === "decision"
                      ? "Open the conversation to review the current decision. This event may have been resolved."
                      : "Open the conversation for the current state. No automatic replacement task was started."}
                </p>
                <div className="activity-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void open.current(event).catch(async () => {
                        await open.current(null);
                        setError(
                          "Conversation unavailable. This event remains in your inbox.",
                        );
                      })
                    }
                  >
                    {event.kind === "decision"
                      ? "Review decision"
                      : "Open conversation"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || event.read_at !== null || offline}
                    onClick={() => void read(event.id)}
                  >
                    Mark read
                  </Button>
                </div>
              </article>
            ))
          )}
          {before.current !== null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                before.current = null;
                void refresh().catch(() =>
                  setError("Could not refresh activity."),
                );
              }}
            >
              Newest activity
            </Button>
          )}
          {more && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void older()}
            >
              Load older activity
            </Button>
          )}
          <p className="footnote">
            Opening activity never approves, submits or resumes a task.
          </p>
        </>
      )}
    </section>
  );
}
