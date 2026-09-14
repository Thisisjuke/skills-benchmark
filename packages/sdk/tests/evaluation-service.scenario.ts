// Registered by the SDK evaluation scenario suite.
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  EvaluationService,
  type EvalSuite,
  type EvaluationAssertionEngine,
} from "@skillbench/sdk/evaluator";
import { MOCK_EXECUTION_PROFILE, type Runner } from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe("EvaluationService ports", () => {
  it("evaluates through ports without creating persistent storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "skillbench-sdk-evaluation-"));
    const resolvedSkill = await new LocalSourceResolver(policy).resolve(
      "tests/fixtures/skills/basic",
    );
    const suite: EvalSuite = {
      id: "portable-suite",
      partition: "development",
      rootPath: directory,
      cases: [
        {
          id: "portable-case",
          name: "Portable case",
          prompt: "Run the portable evaluation",
          partition: "development",
          fixtures: [],
          assertions: [{ type: "exit-code", value: 0 }],
          sourcePath: join(directory, "case.yaml"),
          contentHash: "case-hash",
        },
      ],
    };
    const runner: Runner = {
      run: async () => ({
        status: "completed",
        exitCode: 0,
        stdout: "portable",
        stderr: "",
        durationMs: 4,
        artifacts: [],
      }),
    };
    const assertions: EvaluationAssertionEngine = {
      evaluate: async (assertion) => ({
        type: assertion.type,
        status: "passed",
        passed: true,
        score: 1,
        message: "passed",
        evidence: {},
        durationMs: 0,
      }),
    };
    const evaluator = new EvaluationService(runner, assertions, {
      id: () => "portable-run",
      now: () => new Date(0),
      workspaceParent: join(directory, "workspaces"),
    });

    const result = await evaluator.evaluate({
      resolvedSkill,
      suite,
      repeat: 1,
      timeoutMs: 100,
      executionProfile: MOCK_EXECUTION_PROFILE,
      config: {},
    });

    expect(result).toMatchObject({
      runId: "portable-run",
      status: "completed",
      passRate: 1,
      meanScore: 1,
    });
    expect(existsSync(join(directory, ".skillbench"))).toBe(false);
    expect(existsSync(join(directory, "skillbench.sqlite"))).toBe(false);
  });
});
