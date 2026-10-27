import React, { useEffect, useState } from "react";
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
} from "./api.js";

export function App() {
  const [api, setApi] = useState<Api>();
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
    setBusy(true);
    setError("");
    try {
      const state = await api!.client.threads.getState(item.thread_id);
      const saved = (state.values as { messages?: Message[] }).messages ?? [];
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
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError("");
    setPartial("");
    setActualModel("");
    let current = chat;
    try {
      current ??= await api!.request<Chat>("/threads", "POST", {});
      setChat(current);
      const content = draft.trim();
      setDraft("");
      setMessages((old) => [...old, { type: "human", content }]);
      for await (const part of api!.client.runs.stream(
        current.thread_id,
        "general-chat",
        {
          input: { messages: [{ type: "human", content }] },
          streamMode: ["messages", "values"],
        },
      )) {
        if (part.event === "error")
          throw new Error(
            "The model could not complete this reply. No automatic resend or model switch was made.",
          );
        if (part.event === "messages/partial") {
          const message = (part.data as unknown as [Message])[0];
          setPartial(textContent(message.content));
          if (effectiveModel(message)) setActualModel(effectiveModel(message));
        }
        if (part.event === "values") {
          setMessages((part.data as { messages?: Message[] }).messages ?? []);
          setPartial("");
        }
      }
      const state = await api!.client.threads.getState(current.thread_id);
      const saved = (state.values as { messages?: Message[] }).messages ?? [];
      setMessages(saved);
      setActualModel(effectiveModel(saved.findLast((m) => m.type === "ai")));
    } catch {
      setError(
        "Reply failed or the connection was interrupted. Check Connection & models before sending another message. No automatic resend or model switch.",
      );
    } finally {
      setPartial("");
      setBusy(false);
      try {
        await refreshChats(api!);
      } catch {
        /* preserve current chat */
      }
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
            <strong>General Chat</strong>
            <span className="muted">Coding · coming later</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
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
                  <span>Saved on this Mac</span>
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
          <section className="conversation">
            <div className="conversation-head">
              <h1>General Chat</h1>
              <span aria-live="polite">
                {busy
                  ? "Replying…"
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
            <form className="composer" onSubmit={send}>
              <textarea
                aria-label="Message"
                placeholder="Ask a question…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
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
                <Button type="submit" disabled={busy || !draft.trim()}>
                  {busy ? "Replying…" : "Send"}
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
