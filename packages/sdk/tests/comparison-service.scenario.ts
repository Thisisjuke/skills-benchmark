// Registered by the SDK comparison scenario suite.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { ComparisonService } from "@skillbench/sdk/comparator";
import {
  EvaluationService,
  type EvalSuite,
  type EvaluationAssertionEngine,
} from "@skillbench/sdk/evaluator";
import { MOCK_EXECUTION_PROFILE, type Runner } from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe("ComparisonService ports", () => {
  it("compares without a persistence adapter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "skillbench-sdk-comparison-"));
    const resolver = new LocalSourceResolver(policy);
    const [skillA, skillB] = await Promise.all([
      resolver.resolve("tests/fixtures/skills/basic"),
      resolver.resolve("tests/fixtures/skills/basic"),
    ]);
    const suite: EvalSuite = {
      id: "portable-comparison-suite",
      partition: "development",
      rootPath: directory,
      cases: [
        {
          id: "portable-case",
          name: "Portable case",
          prompt: "Compare",
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
        stdout: "same output",
        stderr: "",
        durationMs: 1,
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
    let evaluationId = 0;
    const evaluator = new EvaluationService(runner, assertions, {
      id: () => `evaluation-${++evaluationId}`,
      now: () => new Date(0),
      workspaceParent: join(directory, "workspaces"),
    });
    let comparisonId = 0;
    const comparator = new ComparisonService(evaluator, {
      id: () => `comparison-${++comparisonId}`,
      now: () => new Date(0),
    });

    const result = await comparator.compare({
      skillA,
      skillB,
      suite,
      repeat: 1,
      timeoutMs: 100,
      executionProfile: MOCK_EXECUTION_PROFILE,
      permissions: { schemaVersion: 1 },
      weights: {
        functionalCorrectness: 0.4,
        outputQuality: 0.2,
        edgeCases: 0.15,
        skillTriggering: 0.1,
        instructionFollowing: 0.05,
        tokenEfficiency: 0.05,
        latency: 0.05,
      },
      tieThreshold: 0.01,
      effectiveConfig: {},
    });

    expect(result).toMatchObject({
      comparisonId: "comparison-2",
      runId: "comparison-1",
      verdict: { winner: "tie" },
    });
  });
});
