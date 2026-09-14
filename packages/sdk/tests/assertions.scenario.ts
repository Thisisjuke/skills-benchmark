// Registered by the SDK evaluation scenario suite.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { AssertionEvaluator, splitCommand, type RubricEvaluator } from "@skillbench/sdk/assertions";
import type { EvalAssertion } from "@skillbench/sdk/evaluator";
import type { RunResult } from "@skillbench/sdk/runners";

const runnerResult: RunResult = {
  status: "completed",
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  artifacts: [],
};

function context(workspacePath: string, result = runnerResult) {
  return {
    workspacePath,
    prompt: "test prompt",
    runnerResult: result,
    defaultCommandTimeoutMs: 1_000,
  };
}

describe("AssertionEvaluator", () => {
  it("evaluates filesystem, content, regex and runner exit code independently", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    writeFileSync(join(workspace, "output.txt"), "hello deterministic world\n");
    const evaluator = new AssertionEvaluator();
    const assertions: EvalAssertion[] = [
      { type: "file-exists", value: "output.txt" },
      { type: "contains", path: "output.txt", value: "deterministic" },
      { type: "regex", path: "output.txt", pattern: "hello .* world", flags: "m" },
      { type: "exit-code", value: 0 },
    ];

    const results = await Promise.all(
      assertions.map((assertion) => evaluator.evaluate(assertion, context(workspace))),
    );
    expect(results.every((result) => result.passed)).toBe(true);
    expect(
      (await evaluator.evaluate({ type: "file-exists", value: "missing" }, context(workspace)))
        .status,
    ).toBe("failed");
    expect(
      (
        await evaluator.evaluate(
          { type: "contains", path: "output.txt", value: "absent" },
          context(workspace),
        )
      ).status,
    ).toBe("failed");
  });

  it("executes argv without a shell, captures bounded output and honors expected exit codes", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const evaluator = new AssertionEvaluator();
    const success = await evaluator.evaluate(
      {
        type: "command",
        command: ["printf", "x".repeat(20_000)],
        expectedExitCode: 0,
      },
      context(workspace),
    );

    expect(success.status).toBe("passed");
    expect(String(success.evidence.stdout)).toContain("[truncated]");
    expect(splitCommand(`${process.execPath} -e "console.log('hello world')"`)).toHaveLength(3);
    expect(() => splitCommand("tool 'unfinished")).toThrow(/unfinished/);
  });

  it("distinguishes timeout and command-not-found errors", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const evaluator = new AssertionEvaluator();
    const timedOut = await evaluator.evaluate(
      {
        type: "command",
        command: [process.execPath, "-e", "setTimeout(() => undefined, 100)"],
        timeoutMs: 5,
        expectedExitCode: 0,
      },
      context(workspace),
    );
    expect(timedOut).toMatchObject({ status: "failed", passed: false });
    expect(timedOut.message).toContain("timed out");

    const missing = await evaluator.evaluate(
      { type: "command", command: ["skillbench-command-that-does-not-exist"], expectedExitCode: 0 },
      context(workspace),
    );
    expect(missing.status).toBe("error");
  });

  it("propagates cancellation from command assertions", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const controller = new AbortController();
    const evaluation = new AssertionEvaluator().evaluate(
      {
        type: "command",
        command: [process.execPath, "-e", "setTimeout(() => undefined, 10000)"],
        expectedExitCode: 0,
      },
      { ...context(workspace), signal: controller.signal },
    );

    controller.abort(new Error("cancelled by test"));

    await expect(evaluation).rejects.toThrow("cancelled by test");
  });

  it("does not let an unavailable rubric erase deterministic grading", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const unavailable = await new AssertionEvaluator().evaluate(
      { type: "llm-rubric", rubric: "quality" },
      context(workspace),
    );
    expect(unavailable).toMatchObject({ status: "not-evaluated", passed: null, score: null });

    const rubric: RubricEvaluator = {
      evaluate: async () => ({ passed: true, score: 0.8, message: "good" }),
    };
    const evaluated = await new AssertionEvaluator({ rubricEvaluator: rubric }).evaluate(
      { type: "llm-rubric", rubric: "quality" },
      context(workspace),
    );
    expect(evaluated).toMatchObject({ status: "passed", passed: true, score: 0.8 });
  });

  it("fails explicitly when an assertion handler is not registered", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const assertion = {
      type: "promptfoo" as const,
      assertion: { type: "contains" as const, value: "ok" },
    };
    expect(await new AssertionEvaluator().evaluate(assertion, context(workspace))).toMatchObject({
      status: "error",
      passed: false,
      message: "No assertion handler registered for promptfoo",
    });
  });

  it("allows a typed assertion handler to be registered without changing the evaluator", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "skillbench-assertions-"));
    const evaluator = new AssertionEvaluator();
    evaluator.register("regex", async (assertion) => ({
      type: assertion.type,
      status: "passed",
      passed: true,
      score: 1,
      message: `custom:${assertion.pattern}`,
      evidence: {},
      durationMs: 0,
    }));

    await expect(
      evaluator.evaluate(
        { type: "regex", path: "unused", pattern: "third-party" },
        context(workspace),
      ),
    ).resolves.toMatchObject({ status: "passed", message: "custom:third-party" });
  });
});
