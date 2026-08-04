import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { declareOpenRouterInvocation } from "../../src/client-signals.js";

let originalInvokedBy: string | undefined;

beforeEach(() => {
  originalInvokedBy = process.env.FLY_INVOKED_BY;
});

afterEach(() => {
  if (originalInvokedBy === undefined) {
    delete process.env.FLY_INVOKED_BY;
  } else {
    process.env.FLY_INVOKED_BY = originalInvokedBy;
  }
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
