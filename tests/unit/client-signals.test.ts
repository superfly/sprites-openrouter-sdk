import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { afterEach, test } from "node:test";

// Captured before the dynamic import below, so the restore in afterEach sees
// the real pre-test value rather than the one the module declares on load.
const originalInvokedBy = process.env.FLY_INVOKED_BY;
const { declareOpenRouterInvocation } = await import(
  "../../src/client-signals.js"
);

const ENTRY_POINT = new URL("../../src/index.ts", import.meta.url).href;

/**
 * Import the package entry point in a clean child process and report the
 * declaration it leaves behind. Consumers never call the exported function
 * themselves, so only this path proves the entry point is still wired up.
 */
function invokedByAfterImportingPackage(existing?: string): string {
  const env = { ...process.env };
  delete env.FLY_INVOKED_BY;
  if (existing !== undefined) {
    env.FLY_INVOKED_BY = existing;
  }
  return execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(ENTRY_POINT)});
       process.stdout.write(process.env.FLY_INVOKED_BY ?? "");`,
    ],
    { env, encoding: "utf8" },
  );
}

afterEach(() => {
  if (originalInvokedBy === undefined) {
    delete process.env.FLY_INVOKED_BY;
  } else {
    process.env.FLY_INVOKED_BY = originalInvokedBy;
  }
});

test("importing the package declares OpenRouter as the invoking agent", () => {
  assert.equal(invokedByAfterImportingPackage(), "openrouter");
});

test("importing the package preserves an existing declaration", () => {
  assert.equal(invokedByAfterImportingPackage("outer-harness"), "outer-harness");
});

test("declares OpenRouter as the invoking agent when unset", () => {
  delete process.env.FLY_INVOKED_BY;

  declareOpenRouterInvocation();

  assert.equal(process.env.FLY_INVOKED_BY, "openrouter");
});

test("preserves an existing invoking agent declaration", () => {
  process.env.FLY_INVOKED_BY = "outer-harness";

  declareOpenRouterInvocation();

  assert.equal(process.env.FLY_INVOKED_BY, "outer-harness");
});
