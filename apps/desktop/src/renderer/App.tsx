import React, { useEffect, useState, useRef } from "react";
import { ActivityHub, type Activity } from "./ActivityHub.js";
import { TaskPanel, unfinished } from "./TaskPanel.js";
import { Button } from "./components/ui/button.js";
import {
  connect,
  textContent,
  effectiveModel,
  type Api,
  type Setup,
  type Model,
  type Chat,
  type Message,
  type Task,
} from "./api.js";

export function App() {
  const [api, setApi] = useState<Api>();
  const [view, setView] = useState<"chat" | "inbox" | "preferences">("chat");
  const [unread, setUnread] = useState(0);
  const [setup, setSetup] = useState<Setup>();
  const [screen, setScreen] = useState<"connection" | "models" | "chat">(
    "connection",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [general, setGeneral] = useState("");
  const [coding, setCoding] = useState("");
  const [same, setSame] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chat, setChat] = useState<Chat>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [actualModel, setActualModel] = useState("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [allowance, setAllowance] = useState("");
  const selectedChat = useRef<string | undefined>(undefined);
  const historyVersion = useRef(0);
  const [disconnected, setDisconnected] = useState(false);
  const submission = useRef<
    | {
        id: string;
        threadId: string;
        instruction: string;
        allowanceUsd: string;
      }
    | undefined
  >(undefined);
  const currentTask = tasks.findLast((t) => t.thread_id === chat?.thread_id);
  const blocked = Boolean(currentTask && unfinished(currentTask));
  async function refreshTasks() {
    if (api) setTasks(await api.request<Task[]>("/tasks"));
  }
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const list = await api!.request<Task[]>("/tasks");
        if (!cancelled) {
          setTasks(list);
          setDisconnected(false);
        }
        const id = selectedChat.current;
        const version = historyVersion.current;
        if (id) {
          const state = await api!.client.threads.getState(id);
          if (
            !cancelled &&
            selectedChat.current === id &&
            historyVersion.current === version
          ) {
            const saved =
              (state.values as { messages?: Message[] }).messages ?? [];
            setMessages(saved);
            setActualModel(
              effectiveModel(saved.findLast((m) => m.type === "ai")),
            );
            const task = list.findLast((t) => t.thread_id === id);
            setPartial(
              task?.state === "running" &&
                !saved.some(
                  (m) => m.type === "ai" && m.id === task.generation_id,
                )
                ? task.partial_text
                : "",
            );
          }
        }
      } catch {
        if (!cancelled) setDisconnected(true);
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api]);

  async function refreshChats(connection: Api) {
    const items = await connection.client.threads.search({ limit: 100 });
    setChats(items as unknown as Chat[]);
  }
  async function initialise() {
    setBusy(true);
    setError("");
    try {
      const connection = await connect();
      const state = await connection.request<Setup>("/setup");
      setSetup(state);
      setApi(connection);
      void connection
        .request<{ theme: string }>("/activity/preferences")
        .then((p) => {
          if (["system", "light", "dark"].includes(p.theme))
            document.documentElement.dataset.theme = p.theme;
        })
        .catch(() => {});
      setGeneral(state.defaults?.general ?? "");
      setCoding(state.defaults?.coding ?? "");
      setSame(
        Boolean(
          state.defaults && state.defaults.general === state.defaults.coding,
        ),
      );
      if (state.saved && state.defaults) {
        await refreshChats(connection);
        setScreen("chat");
      }
    } catch {
      setApi(undefined);
      setError(
        "Local service unavailable. Start or reconnect the local service, then retry. Saved keys and chats are preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void initialise();
  }, []);
  async function chooseModels() {
    setScreen("models");
    setBusy(true);
    setError("");
    try {
      setModels(await api!.request<Model[]>("/setup/models"));
    } catch {
      setModels([]);
      setError("Model catalogue unavailable. Saved choices are unchanged.");
    } finally {
      setBusy(false);
    }
  }
  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api!.request("/setup/connection", "POST", key ? { key } : {});
      setKey("");
      setSetup(await api!.request<Setup>("/setup"));
      await chooseModels();
    } catch (e) {
      setKey("");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveModels(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api!.request("/setup/models", "PUT", {
        general,
        coding: same ? general : coding,
      });
      setSetup(await api!.request<Setup>("/setup"));
      await refreshChats(api!);
      setScreen("chat");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openChat(item: Chat) {
    setView("chat");
    selectedChat.current = item.thread_id;
    const version = ++historyVersion.current;
    setChat(item);
    setMessages([]);
    setPartial("");
    setDraft("");
    setActualModel("");
    setBusy(true);
    setError("");
    try {
      const state = await api!.client.threads.getState(item.thread_id);
      const saved = (state.values as { messages?: Message[] }).messages ?? [];
      if (
        selectedChat.current !== item.thread_id ||
        historyVersion.current !== version
      )
        return;
      setChat(item);
      setMessages(saved);
      setPartial("");
      setDraft("");
      setActualModel(effectiveModel(saved.findLast((m) => m.type === "ai")));
    } catch {
      setError(
        "Could not restore this conversation. Saved history is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openActivity(event: Activity | null) {
    if (!event) {
      setView("inbox");
      return;
    }
    const current = await api!.request<Activity>(`/activity/${event.id}`);
    const thread = await api!.client.threads.get(current.thread_id);
    await refreshTasks();
    await openChat(thread as unknown as Chat);
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy || blocked || !allowance) return;
    setBusy(true);
    setError("");
    setPartial("");
    setActualModel("");
    try {
      const current =
        chat ?? (await api!.request<Chat>("/threads", "POST", {}));
      selectedChat.current = current.thread_id;
      setChat(current);
      const content = draft.trim();
      const previous = submission.current;
      const request =
        previous &&
        previous.threadId === current.thread_id &&
        previous.instruction === content &&
        previous.allowanceUsd === allowance
          ? previous
          : {
              id: crypto.randomUUID(),
              threadId: current.thread_id,
              instruction: content,
              allowanceUsd: allowance,
            };
      submission.current = request;
      const task = await api!.request<Task>("/tasks", "POST", request);
      setDraft("");
      submission.current = undefined;
      setTasks((previous) => [
        ...previous.filter((t) => t.id !== task.id),
        task,
      ]);
      await refreshTasks();
      await refreshChats(api!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const label = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const modelOptions = (selected: string) => (
    <>
      {!selected && <option value="">Choose a model</option>}
      {selected && !models.some((m) => m.id === selected) && (
        <option value={selected}>{selected} · unavailable</option>
      )}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </>
  );
  return (
    <>
      <header>
        <strong>
          DA <span>/</span> Agent Platform Deep Agents
        </strong>
        <small>MILESTONE ONE · DEVELOPMENT</small>
      </header>
      {screen !== "chat" ? (
        <main className="setup">
          <aside className="intro">
            <small>A LOCAL START</small>
            <h1>
              Your agent.
              <br />
              Your machine.
            </h1>
            <p>
              A straightforward setup for a private desktop workspace, using the
              model connection you choose.
            </p>
            <ol>
              <li>Connect OpenRouter</li>
              <li>Choose your models</li>
              <li>Start General Chat</li>
            </ol>
            <p className="footnote">
              One local profile. No app account required.
              <br />
              <br />
              Apple Silicon macOS first.
            </p>
          </aside>
          <section className="setup-content">
            <div className="form-card">
              <small>{screen === "connection" ? "CONNECTION" : "MODELS"}</small>
              <h2>
                {!api
                  ? "Connect your local service"
                  : screen === "connection"
                    ? "Connect OpenRouter"
                    : "Choose your models"}
              </h2>
              {error && (
                <p className="alert" role="alert">
                  {error}
                </p>
              )}
              {!api ? (
                <>
                  <p>Your service runs independently of this desktop window.</p>
                  <Button disabled={busy} onClick={() => void initialise()}>
                    {busy ? "Connecting…" : "Retry connection"}
                  </Button>
                </>
              ) : screen === "connection" ? (
                <form onSubmit={authenticate}>
                  <p>Use your own API key to connect to your chosen models.</p>
                  {setup?.saved && (
                    <p className="success">
                      Saved connection available · key is not shown
                    </p>
                  )}
                  <label htmlFor="key">
                    OpenRouter API key
                    {setup?.saved ? " · optional replacement" : ""}
                  </label>
                  <input
                    id="key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    disabled={busy || !setup?.writable}
                    placeholder={
                      setup?.saved ? "Saved securely" : "Paste your API key"
                    }
                  />
                  <p className="footnote">
                    Protected by macOS Keychain. Your saved key is not shown
                    again.
                  </p>
                  <Button
                    disabled={busy || (!key && !setup?.saved)}
                    type="submit"
                  >
                    {busy ? "Checking…" : "Check connection"}
                  </Button>
                  <p className="notice">
                    Checking the key validates access only. It does not generate
                    a response or start a chargeable model test.
                  </p>
                  <p className="footnote">
                    When you chat, your messages and necessary context are sent
                    through OpenRouter to the selected provider.
                  </p>
                  {setup?.defaults && (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setScreen("chat");
                      }}
                    >
                      Back to chats
                    </Button>
                  )}
                </form>
              ) : (
                <form onSubmit={saveModels}>
                  <p>
                    New chats inherit these choices. Existing chats keep their
                    selected model.
                  </p>
                  <p className="success">OpenRouter connected</p>
                  <label htmlFor="general">General Chat default</label>
                  <select
                    id="general"
                    value={general}
                    onChange={(e) => setGeneral(e.target.value)}
                    disabled={busy || !models.length}
                  >
                    {modelOptions(general)}
                  </select>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={same}
                      onChange={(e) => setSame(e.target.checked)}
                      disabled={busy}
                    />
                    Use General Chat model for both
                  </label>
                  <label htmlFor="coding">
                    Coding default · for future Coding chats
                  </label>
                  <select
                    id="coding"
                    value={same ? general : coding}
                    onChange={(e) => setCoding(e.target.value)}
                    disabled={busy || same || !models.length}
                  >
                    {modelOptions(same ? general : coding)}
                  </select>
                  <p className="notice">
                    Coding is not available in milestone one. You can save its
                    default now. Models are never switched automatically.
                  </p>
                  {!models.length ? (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void chooseModels()}
                    >
                      {busy ? "Loading models…" : "Retry model catalogue"}
                    </Button>
                  ) : (
                    <Button
                      disabled={busy || !general || (!same && !coding)}
                      type="submit"
                    >
                      {busy ? "Saving…" : "Start General Chat"}
                    </Button>
                  )}
                </form>
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="chat-layout">
          <aside className="sidebar">
            <small>WORKSPACE</small>
            <Button
              variant="ghost"
              aria-pressed={view === "chat"}
              onClick={() => setView("chat")}
            >
              General Chat
            </Button>
            <Button
              variant="ghost"
              aria-pressed={view === "inbox"}
              onClick={() => setView("inbox")}
            >
              Activity inbox ({unread} unread)
            </Button>
            <Button
              variant="ghost"
              aria-pressed={view === "preferences"}
              onClick={() => setView("preferences")}
            >
              Preferences
            </Button>
            <span className="muted">Coding · coming later</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setView("chat");
                selectedChat.current = undefined;
                historyVersion.current++;
                setChat(undefined);
                setMessages([]);
                setDraft("");
                setPartial("");
                setActualModel("");
                setError("");
              }}
            >
              New chat
            </Button>
            <p className="task-capacity" aria-live="polite">
              {
                tasks.filter((t) => ["running", "stopping"].includes(t.state))
                  .length
              }{" "}
              active · {tasks.filter((t) => t.state === "queued").length} queued
            </p>
            <small>RECENT CHATS</small>
            <nav aria-label="Recent chats">
              {chats.map((item) => (
                <button
                  disabled={busy}
                  className={
                    chat?.thread_id === item.thread_id ? "selected" : ""
                  }
                  key={item.thread_id}
                  onClick={() => void openChat(item)}
                >
                  {item.metadata.title}
                  <span>
                    {tasks
                      .findLast((t) => t.thread_id === item.thread_id)
                      ?.state.replaceAll("_", " ") ?? "Saved on this Mac"}
                  </span>
                </button>
              ))}
            </nav>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setError("");
                setScreen("connection");
              }}
            >
              Connection & models
            </Button>
            <p className="footnote">
              Local profile
              <br />
              On this Mac
            </p>
          </aside>
          {api && (
            <ActivityHub
              api={api}
              view={view}
              onOpen={openActivity}
              onUnread={setUnread}
            />
          )}
          <section className="conversation" hidden={view !== "chat"}>
            <div className="conversation-head">
              <h1>General Chat</h1>
              <span aria-live="polite">
                {currentTask?.state === "running"
                  ? "Replying…"
                  : currentTask?.state === "stopping"
                    ? "Stopping requested"
                    : currentTask?.state === "stopped"
                      ? "Stopped"
                      : chat
                        ? "Saved on this Mac"
                        : "A fresh conversation"}
              </span>
            </div>
            <div className="messages" role="log" aria-label="Conversation">
              {!messages.length && (
                <div className="empty">
                  <h2>What would you like to explore?</h2>
                  <p>Ask a question or work through an idea.</p>
                  <p className="footnote">
                    Text chat only in this first slice. Research, documents and
                    Coding come later.
                  </p>
                </div>
              )}
              {messages
                .filter((m) => m.type === "human" || m.type === "ai")
                .map((m, i) => (
                  <article
                    key={i}
                    className={m.type === "human" ? "human" : "assistant"}
                  >
                    <small>{m.type === "human" ? "You" : "General Chat"}</small>
                    <p>{textContent(m.content)}</p>
                  </article>
                ))}
              {tasks
                .filter(
                  (t) =>
                    t.thread_id === chat?.thread_id &&
                    t.partial_text &&
                    (t.state === "stopping" ||
                      t.state === "stopped" ||
                      t.execution_outcome === "error" ||
                      t.state === "interrupted") &&
                    !(t.id === currentTask?.id && partial),
                )
                .map((t) => (
                  <article className="assistant" key={`incomplete-${t.id}`}>
                    <small>General Chat · Incomplete reply</small>
                    <p>{t.partial_text}</p>
                    <p className="footnote">
                      Retained from an earlier attempt for reference; not
                      replayed automatically.
                    </p>
                  </article>
                ))}
              {partial && (
                <article className="assistant">
                  <small>General Chat</small>
                  <p>{partial}</p>
                </article>
              )}
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            {disconnected && (
              <p className="alert" role="status">
                Connection unavailable. This task may still be running and using
                API credits. Reconnecting checks the same task; it does not
                resend your instruction.
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void initialise()}
                >
                  Reconnect
                </Button>
              </p>
            )}
            <p className="footnote">
              Closing the window or quitting the desktop does not stop accepted
              tasks. They may keep using API credits while the service and Mac
              remain available. Use Stop task to request cancellation.
            </p>
            {currentTask && api && (
              <TaskPanel
                key={currentTask.id}
                task={currentTask}
                disconnected={disconnected}
                api={api}
                refresh={refreshTasks}
              />
            )}
            <form className="composer" onSubmit={send}>
              <label htmlFor="task-allowance">
                Allowance for this instruction (USD)
              </label>
              <input
                id="task-allowance"
                type="number"
                min="0"
                step="any"
                required
                value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
                disabled={busy || blocked}
                aria-describedby="allowance-help"
              />
              <p id="allowance-help" className="footnote">
                Choose an amount. Retries share this task's allowance; new
                instructions have their own allowance.
              </p>
              <textarea
                aria-label="Message"
                placeholder="Ask a question…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy || blocked}
                maxLength={8000}
              />
              <div>
                <span title={chat?.metadata.model ?? general}>
                  Requested model · {label(chat?.metadata.model ?? general)}
                  {messages.some((m) => m.type === "ai") && (
                    <small>
                      {actualModel
                        ? `Response model · ${actualModel}`
                        : "Response model not reported by this integration"}
                    </small>
                  )}
                </span>
                <Button
                  type="submit"
                  disabled={busy || blocked || !draft.trim() || !allowance}
                >
                  {busy ? "Submitting…" : "Send with allowance"}
                </Button>
              </div>
            </form>
            <p className="footnote">
              Chats are saved on this Mac. Model requests use your OpenRouter
              credits. Pilot replies are limited to 512 tokens.
            </p>
          </section>
        </main>
      )}
      <footer>
        <span>Local desktop · independent service</span>
        <span>M1 · first connected journey</span>
      </footer>
    </>
  );
}
