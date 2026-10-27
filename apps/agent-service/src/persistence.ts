import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";
import { closeSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { MetadataStore } from "./metadata.js";
import { TaskLedger } from "./task-ledger.js";

/** The caller provides an existing private data directory; never fall back to cwd. */
export function openPersistence(directory: string) {
  if (!isAbsolute(directory))
    throw new Error("HARNESS_DATA_DIR must be absolute.");
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  ) {
    throw new Error(
      "HARNESS_DATA_DIR must be an owned private directory (mode 0700).",
    );
  }
  const root = realpathSync(directory);
  const connections: Database.Database[] = [];
  const open = (name: string) => {
    const path = join(root, name);
    try {
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.uid !== info.uid ||
        (stat.mode & 0o077) !== 0
      )
        throw new Error("Unsafe persistence file permissions or type.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      closeSync(openSync(path, "wx", 0o600));
    }
    const db = new Database(path, { timeout: 0 });
    connections.push(db);
    return db;
  };
  const close = () => {
    for (const db of connections.toReversed()) if (db.open) db.close();
  };
  try {
    // Native SQLite ownership lock releases on process exit, including crashes.
    // It prevents a second service from reconciling a live owner's runs.
    const owner = open("owner.sqlite");
    owner.exec("BEGIN EXCLUSIVE");
    const metadataDb = open("metadata.sqlite");
    metadataDb.pragma("foreign_keys = ON");
    metadataDb.pragma("journal_mode = WAL");
    metadataDb.pragma("synchronous = FULL");
    const metadata = new MetadataStore(metadataDb);
    const tasks = new TaskLedger(metadataDb);
    const checkpointDb = open("checkpoints.sqlite");
    checkpointDb.pragma("journal_mode = WAL");
    checkpointDb.pragma("synchronous = FULL");
    const checkpointer = new SqliteSaver(checkpointDb);
    metadata.reconcileInterruptedRuns();
    tasks.interruptOnRestart();
    return { metadata, tasks, checkpointer, close };
  } catch (error) {
    close();
    throw error;
  }
}
