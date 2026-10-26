import { afterEach, expect, test } from "vitest";
import {
  chmodSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPersistence } from "../apps/agent-service/src/persistence.js";
import { MetadataStore } from "../apps/agent-service/src/metadata.js";
import { cleanUp, privateFixture } from "./fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanUp(cleanup.splice(0).reverse());
});
function fixture() {
  const f = privateFixture();
  cleanup.push(f.remove);
  return f.path;
}
function open(path = fixture()) {
  const p = openPersistence(path);
  cleanup.push(p.close);
  return p;
}

test("private durable storage rejects a concurrent owner and releases ownership", async () => {
  const path = fixture();
  const first = open(path);
  await first.metadata.set("one", {
    kind: "put",
    metadata: { label: "retained" },
  });
  expect(() => openPersistence(path)).toThrow();
  expect((await first.metadata.get("one")).metadata.label).toBe("retained");
  for (const name of [
    "owner.sqlite",
    "metadata.sqlite",
    "checkpoints.sqlite",
  ]) {
    expect(statSync(join(path, name)).mode & 0o777).toBe(0o600);
  }
  first.close();
  first.close();
  const second = open(path);
  expect((await second.metadata.get("one")).metadata.label).toBe("retained");
});

test("restart interrupts unfinished runs without resuming or changing terminal outcomes", async () => {
  const path = fixture();
  const first = open(path);
  for (const state of [
    "pending",
    "running",
    "success",
    "error",
    "stopped",
    "interrupted",
  ] as const) {
    await first.metadata.set(state, { kind: "put", metadata: {} });
    first.metadata.createRun(state, state);
    if (["running", "success", "error"].includes(state))
      first.metadata.markRunning(state);
    if (state === "success" || state === "error" || state === "stopped")
      first.metadata.finishRun(state, state);
  }
  first.close();
  const second = open(path);
  for (const id of ["pending", "running", "interrupted"])
    expect(second.metadata.getRun(id)?.status).toBe("interrupted");
  for (const id of ["success", "error", "stopped"])
    expect(second.metadata.getRun(id)?.status).toBe(id);
  expect(second.metadata.reconcileInterruptedRuns()).toBe(0);
  second.metadata.requestResume("pending");
  expect(second.metadata.getRun("pending")?.status).toBe("pending");
  second.metadata.markRunning("pending");
  second.metadata.finishRun("pending", "success");
  expect(() => second.metadata.requestResume("stopped")).toThrow();
  expect(() => second.metadata.markRunning("missing")).toThrow();
  expect(second.metadata.getRun("missing")).toBeUndefined();
});

test("metadata enforces identity, partial updates, graph ownership and unfinished-run uniqueness", async () => {
  const { metadata: m } = open();
  await expect(m.get("missing")).rejects.toMatchObject({ status: 404 });
  await expect(
    m.set("missing", { kind: "patch", metadata: {} }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    m.set("bad", { kind: "put", metadata: { graph_id: "coding" } }),
  ).rejects.toMatchObject({ status: 400 });
  await m.set("one", { kind: "put", metadata: { keep: true, change: 1 } });
  await expect(
    m.set("one", { kind: "put", metadata: {} }),
  ).rejects.toMatchObject({ status: 409 });
  const patched = await m.set("one", {
    kind: "patch",
    metadata: { change: 2, graph_id: "general-chat" },
  });
  expect(patched.metadata).toEqual({
    keep: true,
    change: 2,
    graph_id: "general-chat",
  });
  m.createRun("one", "run");
  expect(() => m.createRun("one", "duplicate")).toThrow();
  expect(() => m.createRun("absent", "orphan")).toThrow();
  expect(() => m.finishRun("run", "success")).toThrow();
  m.finishRun("run", "stopped");
  m.createRun("one", "next");
  await expect(m.delete("one")).rejects.toMatchObject({ status: 405 });
  expect((await m.get("one")).metadata.keep).toBe(true);
});

test("search applies deep metadata filters, stable sorting and pagination", async () => {
  const path = fixture();
  const { metadata: m } = open(path);
  for (const id of ["a", "b", "c"])
    await m.set(id, {
      kind: "put",
      metadata: { group: { value: id === "c" ? 2 : 1 } },
    });
  const db = new Database(join(path, "metadata.sqlite"));
  try {
    for (const [i, id] of ["a", "b", "c"].entries())
      db.prepare(
        "UPDATE threads SET created_at=?, updated_at=? WHERE thread_id=?",
      ).run(i, 3 - i, id);
  } finally {
    db.close();
  }
  const collect = async (options: Parameters<MetadataStore["search"]>[0]) => {
    const rows = [];
    for await (const item of m.search(options)) rows.push(item);
    return rows;
  };
  const filtered = await collect({
    metadata: { group: { value: 1 } },
    offset: 1,
    limit: 1,
    sortBy: "created_at",
    sortOrder: "asc",
  });
  expect(filtered.map((x) => x.thread.thread_id)).toEqual(["b"]);
  expect(filtered[0]?.total).toBe(2);
  expect(
    (
      await collect({
        offset: 0,
        limit: 3,
        sortBy: "updated_at",
        sortOrder: "desc",
      })
    ).map((x) => x.thread.thread_id),
  ).toEqual(["a", "b", "c"]);
  expect(
    await collect({
      offset: 9,
      limit: 1,
      sortBy: "created_at",
      sortOrder: "desc",
    }),
  ).toEqual([]);
});

test("unsafe directory or database paths fail closed", () => {
  const root = fixture();
  expect(() => openPersistence("relative")).toThrow(/absolute/);
  const file = join(root, "file");
  writeFileSync(file, "unchanged", { mode: 0o600 });
  expect(() => openPersistence(file)).toThrow(/private directory/);
  const shared = join(root, "shared");
  mkdirSync(shared, { mode: 0o755 });
  chmodSync(shared, 0o755);
  expect(() => openPersistence(shared)).toThrow(/private directory/);
  const link = join(root, "link");
  symlinkSync(root, link);
  expect(() => openPersistence(link)).toThrow(/private directory/);
  const data = join(root, "data");
  mkdirSync(data, { mode: 0o700 });
  symlinkSync(file, join(data, "owner.sqlite"));
  expect(() => openPersistence(data)).toThrow(/Unsafe persistence/);
});

test("schema/corruption failures retain data and release partially opened connections", () => {
  const path = fixture();
  const file = join(path, "metadata.sqlite");
  const db = new Database(file);
  db.pragma("user_version = 99");
  db.close();
  chmodSync(file, 0o600);
  expect(() => openPersistence(path)).toThrow(/Unsupported metadata/);
  const owner = new Database(join(path, "owner.sqlite"));
  try {
    owner.exec("BEGIN EXCLUSIVE");
  } finally {
    owner.close();
  }
  const original = new Database(file);
  expect(original.pragma("user_version", { simple: true })).toBe(99);
  original.close();
  const bad = fixture();
  writeFileSync(join(bad, "metadata.sqlite"), "not a database", {
    mode: 0o600,
  });
  expect(() => openPersistence(bad)).toThrow();
});
