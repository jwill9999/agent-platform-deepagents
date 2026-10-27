// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { App } from "../apps/desktop/src/renderer/App.js";
import {
  textContent,
  effectiveModel,
} from "../apps/desktop/src/renderer/api.js";
const mock = vi.hoisted(() => ({
  connect: vi.fn(),
  request: vi.fn(),
  search: vi.fn(),
  state: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("../apps/desktop/src/renderer/api.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../apps/desktop/src/renderer/api.js")
  >()),
  connect: mock.connect,
}));
const defaults = { general: "selected/general", coding: "selected/coding" };
const chat = {
  thread_id: "saved-thread",
  metadata: { model: defaults.general, title: "Saved discussion" },
};
const models = [
  { id: defaults.general, name: "General model" },
  { id: defaults.coding, name: "Coding model" },
];
let saved = true;
let initialDefaults: typeof defaults | null;
let failPath = "";
beforeEach(() => {
  vi.resetAllMocks();
  window.harness = { connection: vi.fn() };
  saved = true;
  initialDefaults = null;
  failPath = "";
  mock.request.mockImplementation(
    async (path: string, method: string, body: unknown) => {
      if (path === failPath) throw new Error("Synthetic request failed");
      if (path === "/activity/preferences")
        return { enabled: false, theme: "system" };
      if (path === "/activity") return { events: [], unread: 0 };
      if (path === "/activity/session") return { session: "synthetic" };
      if (path === "/setup")
        return { saved, writable: true, defaults: initialDefaults };
      if (path === "/setup/connection") {
        saved = true;
        return { connected: true };
      }
      if (path === "/setup/models" && method === "PUT") {
        initialDefaults = body as typeof defaults;
        return initialDefaults;
      }
      if (path === "/setup/models") return models;
      if (path === "/threads") return chat;
      if (path === "/tasks" && method === "POST")
        return {
          id: "submitted-task",
          thread_id: chat.thread_id,
          state: "queued",
          allowance: 1000000000,
          confirmed: 0,
          reserved: 0,
        };
      if (path === "/tasks") return [];
    },
  );
  mock.search.mockResolvedValue([chat]);
  mock.state.mockResolvedValue({
    values: {
      messages: [
        { type: "human", content: "Saved question" },
        {
          type: "ai",
          content: "Saved answer",
          response_metadata: { model_name: "reported/model" },
        },
      ],
    },
  });
  mock.connect.mockResolvedValue({
    request: mock.request,
    client: {
      threads: { search: mock.search, getState: mock.state },
      runs: { stream: mock.stream },
    },
  });
  mock.stream.mockImplementation(async function* () {
    yield {
      event: "messages/partial",
      data: [
        {
          type: "ai",
          content: "Streamed",
          response_metadata: { model: "reported/model" },
        },
      ],
    };
    yield {
      event: "values",
      data: {
        messages: [
          { type: "human", content: "Question" },
          { type: "ai", content: "Reply" },
        ],
      },
    };
  });
});
afterEach(cleanup);
async function readyConnection() {
  render(<App />);
  await screen.findByRole("heading", { name: "Connect OpenRouter" });
}
async function chatScreen() {
  initialDefaults = defaults;
  render(<App />);
  await screen.findByRole("heading", { name: "General Chat" });
}
async function click(name: string | RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

test("reconnect remains usable after setup fails; saved key validation does not send a model request", async () => {
  failPath = "/setup";
  render(<App />);
  await screen.findByRole("button", { name: "Retry connection" });
  failPath = "";
  await click("Retry connection");
  await screen.findByRole("heading", { name: "Connect OpenRouter" });
  await click("Check connection");
  await screen.findByRole("heading", { name: "Choose your models" });
  fireEvent.change(screen.getByLabelText("General Chat default"), {
    target: { value: defaults.general },
  });
  fireEvent.change(
    screen.getByLabelText("Coding default · for future Coding chats"),
    { target: { value: defaults.coding } },
  );
  fireEvent.click(screen.getByLabelText("Use General Chat model for both"));
  await click("Start General Chat");
  await screen.findByRole("heading", { name: "General Chat" });
  expect(initialDefaults).toEqual({
    general: defaults.general,
    coding: defaults.general,
  });
  expect(mock.stream).not.toHaveBeenCalled();
});
test("replacement key is cleared on failure; catalogue failure has explicit retry and no lost defaults", async () => {
  saved = false;
  await readyConnection();
  fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
    target: { value: "synthetic-only" },
  });
  failPath = "/setup/connection";
  await click("Check connection");
  await screen.findByRole("alert");
  expect(
    (screen.getByLabelText("OpenRouter API key") as HTMLInputElement).value,
  ).toBe("");
  failPath = "/setup/models";
  fireEvent.change(screen.getByLabelText("OpenRouter API key"), {
    target: { value: "synthetic-only" },
  });
  await click("Check connection");
  await screen.findByRole("button", { name: "Retry model catalogue" });
  failPath = "";
  await click("Retry model catalogue");
  await screen.findAllByRole("option", { name: "General model" });
  fireEvent.change(screen.getByLabelText("General Chat default"), {
    target: { value: defaults.general },
  });
  fireEvent.change(
    screen.getByLabelText("Coding default · for future Coding chats"),
    { target: { value: defaults.coding } },
  );
  failPath = "/setup/models";
  await click("Start General Chat");
  await screen.findByRole("alert");
  expect(initialDefaults).toBeNull();
});
test("restored history uses stored model; new chats separate messages; stream and response identity render", async () => {
  await chatScreen();
  await click(/Saved discussion/);
  await screen.findByText("Saved answer");
  expect(screen.getByText("Response model · reported/model")).toBeTruthy();
  await click("New chat");
  expect(screen.queryByText("Saved answer")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Question" },
  });
  fireEvent.change(
    screen.getByLabelText("Allowance for this instruction (USD)"),
    { target: { value: "1" } },
  );
  await click("Send with allowance");
  await screen.findByText("Saved answer");
  expect(mock.stream).toHaveBeenCalledWith(
    "saved-thread",
    "general-chat",
    expect.objectContaining({
      metadata: { task_id: "submitted-task" },
    }),
  );
  await click("Connection & models");
  await screen.findByRole("heading", { name: "Connect OpenRouter" });
  await click("Back to chats");
  await screen.findByRole("heading", { name: "General Chat" });
});
test("history and stream errors preserve controls and never automatically resend", async () => {
  await chatScreen();
  mock.state.mockRejectedValueOnce(new Error("Unavailable"));
  await click(/Saved discussion/);
  await screen.findByRole("alert");
  mock.stream.mockImplementation(async function* () {
    yield { event: "error", data: { message: "private provider detail" } };
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Question" },
  });
  fireEvent.change(
    screen.getByLabelText("Allowance for this instruction (USD)"),
    { target: { value: "1" } },
  );
  await click("Send with allowance");
  await waitFor(() => expect(mock.stream).toHaveBeenCalledOnce());
  expect(mock.stream).toHaveBeenCalledOnce();
  expect(screen.queryByText("private provider detail")).toBeNull();
});
test("message rendering tolerates structured content without exposing non-text blocks", () => {
  expect(textContent("text")).toBe("text");
  expect(textContent(null)).toBe("");
  expect(
    textContent([
      { type: "text", text: "visible" },
      { type: "image", url: "private" },
    ]),
  ).toBe("visible");
  expect(effectiveModel(undefined)).toBe("");
  expect(
    effectiveModel({
      type: "ai",
      content: "",
      response_metadata: { model: "m" },
    }),
  ).toBe("m");
});

test("a returned queued task still starts if incidental refresh fails", async () => {
  await chatScreen();
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (path, method, body) => {
    const value = await original(path, method, body);
    if (path === "/tasks" && method === "POST") {
      mock.search.mockRejectedValue(new Error("refresh failed"));
      return value;
    }
    return value;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Question" },
  });
  fireEvent.change(
    screen.getByLabelText("Allowance for this instruction (USD)"),
    { target: { value: "1" } },
  );
  await click("Send with allowance");
  await waitFor(() => expect(mock.stream).toHaveBeenCalledOnce());
  await screen.findByRole("alert");
});
test("selected task state drives approval controls without sending another instruction", async () => {
  await chatScreen();
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(async (path, method, body) =>
    path === "/tasks"
      ? [
          {
            id: "queued",
            thread_id: chat.thread_id,
            state: "awaiting_approval",
            revision: 1,
            allowance: 0,
            confirmed: 0,
            reserved: 0,
            estimate: 100,
            decision_id: "decision",
            attempt_settled: 0,
          },
        ]
      : original(path, method, body),
  );
  await click(/Saved discussion/);
  await screen.findByRole("button", { name: "Approve increase" });
  expect(
    (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  expect(mock.stream).not.toHaveBeenCalled();
});

test("a newer task does not hide a retained incomplete reply from the same conversation", async () => {
  initialDefaults = defaults;
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation(
    async (path: string, method: string, body: unknown) =>
      path === "/tasks"
        ? [
            {
              id: "old",
              thread_id: chat.thread_id,
              state: "stopped",
              partial_text: "Earlier incomplete reply",
              execution_outcome: "error",
              allowance: 100,
              reserved: 10,
              confirmed: 0,
            },
            {
              id: "new",
              thread_id: chat.thread_id,
              state: "awaiting_approval",
              partial_text: "",
              allowance: 100,
              confirmed: 0,
              reserved: 0,
              estimate: 200,
            },
          ]
        : original(path, method, body),
  );
  render(<App />);
  await screen.findByRole("button", { name: /Saved discussion/ });
  fireEvent.click(screen.getByRole("button", { name: /Saved discussion/ }));
  expect(await screen.findByText("Earlier incomplete reply")).toBeTruthy();
  expect(screen.getByText("General Chat · Incomplete reply")).toBeTruthy();
  expect(mock.stream).not.toHaveBeenCalled();
});
