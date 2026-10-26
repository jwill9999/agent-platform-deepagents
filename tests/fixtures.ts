import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

// Local runs must use the agreed external collection; CI uses its disposable runner.
export function privateFixture() {
  const root = process.env.HARNESS_TEST_ROOT ?? process.env.RUNNER_TEMP;
  if (!root)
    throw new Error("Set HARNESS_TEST_ROOT to the owned test collection.");
  const path = mkdtempSync(join(root, "regression-"));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

// Attempt every teardown even if a close fails, then preserve all failures.
export function cleanUp(actions: (() => void)[]) {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Test cleanup failed");
}
