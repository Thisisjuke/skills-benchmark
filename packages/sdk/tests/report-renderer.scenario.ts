// Registered by the SDK artifact scenario suite.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import type { ComparisonSummary } from "@skillbench/sdk/comparator";
import { renderComparisonReport, type ComparisonReportPayloadV1 } from "@skillbench/sdk/reports";

describe("renderComparisonReport", () => {
  it("renders a stable Markdown projection from a versioned payload", () => {
    const comparison = {
      runId: "compare-1",
      evaluationA: { runId: "eval-a" },
      evaluationB: { runId: "eval-b" },
      plan: {
        suiteId: "suite-1",
        partition: "development",
        runnerType: "codex",
        executionProfile: {
          runner: "codex",
          runnerVersion: "codex-cli 0.153.0",
          model: "gpt-test",
          reasoningEffort: "low",
        },
        repeat: 3,
        timeoutMs: 5000,
      },
      scope: {
        compatibility: "PARTIAL",
        confidence: 0.8,
        shared: ["react"],
        specificToA: ["accessibility"],
        specificToB: ["performance"],
        reasons: ["One shared capability."],
      },
      verdict: {
        winner: "A",
        scoreA: 0.8,
        scoreB: 0.7,
        tieThreshold: 0.01,
        statement: "A scores higher on suite suite-1; this is not a universal ranking.",
      },
      dimensions: [
        {
          label: "Functional correctness",
          scoreA: 0.8,
          scoreB: 0.7,
          effectiveWeight: 1,
        },
      ],
      capabilityMatrix: {
        evalCases: [{ capability: "render", scoreA: 0.8, scoreB: 0.7, winner: "A" }],
      },
      judgments: [],
    } as unknown as ComparisonSummary;
    const payload: ComparisonReportPayloadV1 = {
      schemaVersion: 1,
      comparison,
      sourceA: {
        name: "Alpha",
        origin: "github",
        originalInput: "github:owner/repo/alpha@main",
        rootPath: "alpha",
        fingerprint: "aaa",
        snapshotId: "snapshot-a",
        repository: {
          owner: "owner",
          name: "repo",
          requestedRef: "main",
          resolvedCommit: "abc123",
        },
      },
      sourceB: {
        name: "Beta",
        origin: "local",
        originalInput: "./beta",
        rootPath: ".",
        fingerprint: "bbb",
        snapshotId: "snapshot-b",
      },
    };

    const markdown = renderComparisonReport(payload);
    expect(markdown).toContain("Winner: **A**");
    expect(markdown).toContain("Runner version: codex-cli 0.153.0");
    expect(markdown).toContain("Model: gpt-test");
    expect(markdown).toContain("Reasoning effort: low");
    expect(createHash("sha256").update(markdown).digest("hex")).toBe(
      "b34f53c9aaef977bce6b905cd0ace227b9ad864da3d702700f53dbcf4f09a2fd",
    );
  });
});
