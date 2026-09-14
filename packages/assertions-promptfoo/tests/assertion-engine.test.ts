import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { PROMPTFOO_VERSION, PromptfooAssertionEngine } from "@skillbench/assertions-promptfoo";
import { verifyAssertionHandlerContract } from "@skillbench/test-contracts";
import { AssertionEvaluator } from "@skillbench/sdk/assertions";
import type { RunResult } from "@skillbench/sdk/runners";

const runnerResult: RunResult = {
  status: "completed",
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  artifacts: [],
};

function context(result = runnerResult) {
  return {
    workspacePath: mkdtempSync(join(tmpdir(), "skillbench-promptfoo-")),
    prompt: "test prompt",
    runnerResult: result,
    defaultCommandTimeoutMs: 1_000,
  };
}

describe("PromptfooAssertionEngine", () => {
  it("satisfies the reusable assertion handler contract", async () => {
    const promptfoo = new PromptfooAssertionEngine(async () => ({
      pass: true,
      score: 1,
      reason: "contract",
    }));
    await verifyAssertionHandlerContract({
      type: "promptfoo",
      handler: promptfoo.evaluate.bind(promptfoo),
      assertion: { type: "promptfoo", assertion: { type: "contains", value: "ok" } },
      context: context({ ...runnerResult, stdout: "ok" }),
    });
  });

  it("routes output assertions and exposes versioned evidence", async () => {
    const promptfoo = new PromptfooAssertionEngine();
    const evaluator = new AssertionEvaluator({
      handlers: { promptfoo: promptfoo.evaluate.bind(promptfoo) },
    });
    const passed = await evaluator.evaluate(
      { type: "promptfoo", assertion: { type: "icontains", value: "hello" } },
      context({ ...runnerResult, stdout: "Hello world", tokens: { input: 2, output: 3 } }),
    );
    expect(passed).toMatchObject({
      status: "passed",
      passed: true,
      score: 1,
      evidence: {
        engine: "promptfoo",
        version: PROMPTFOO_VERSION,
        assertionType: "icontains",
      },
    });

    const failed = await evaluator.evaluate(
      { type: "promptfoo", assertion: { type: "is-json" } },
      context({ ...runnerResult, stdout: "not json" }),
    );
    expect(failed).toMatchObject({ status: "failed", passed: false, score: 0 });
  });

  it("returns an assertion error when Promptfoo throws", async () => {
    const broken = new PromptfooAssertionEngine(async () => {
      throw new Error("promptfoo unavailable");
    });
    const evaluator = new AssertionEvaluator({
      handlers: { promptfoo: broken.evaluate.bind(broken) },
    });

    await expect(
      evaluator.evaluate(
        { type: "promptfoo", assertion: { type: "contains", value: "ok" } },
        context(),
      ),
    ).resolves.toMatchObject({
      status: "error",
      passed: false,
      message: "promptfoo unavailable",
      evidence: { engine: "promptfoo", version: PROMPTFOO_VERSION },
    });
  });
});
