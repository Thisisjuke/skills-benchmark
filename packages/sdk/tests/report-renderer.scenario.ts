// Registered by the SDK artifact scenario suite.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import type { ComparisonSummary } from "@skillbench/sdk/comparator";
import type { EvaluationSummary } from "@skillbench/sdk/evaluator";
import type { InspectResult } from "@skillbench/sdk/inspect";
import {
  createComparisonTemplateRenderer,
  renderComparisonReport,
  renderEvaluationBundleReport,
  renderInspectBundleReport,
  renderMergeBundleReport,
  type ComparisonReportPayloadV1,
} from "@skillbench/sdk/reports";
import type { MergeResult } from "@skillbench/sdk/results";

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

    const template = [
      "# {{sourceA.name}} vs {{sourceB.name}}",
      "{{#dimensions}}- {{label}}: {{scoreA}} / {{scoreB}} ({{winner}}){{/dimensions}}",
      "{{^judgments}}No qualitative judgment.{{/judgments}}",
    ].join("\n");
    const renderer = createComparisonTemplateRenderer(template, "a".repeat(64));
    expect(renderer.version).toBe("comparison-template-v1:aaaaaaaaaaaa");
    expect(renderer.render(payload)).toContain("- Functional correctness: 80.0% / 70.0% (A)");
    expect(renderer.render(payload)).toContain("No qualitative judgment.");
    expect(() =>
      createComparisonTemplateRenderer("{{missing}}", "b".repeat(64)).render(payload),
    ).toThrow(/Unknown template variable/u);
  });
});

describe("bundle report renderers", () => {
  it("makes an inspection understandable without opening result.json", () => {
    const markdown = renderInspectBundleReport({
      result: {
        schemaVersion: 1,
        kind: "inspect",
        name: "Accessible forms",
        description: "Reviews form accessibility",
        origin: { type: "github", originalInput: "github:example/skills/forms@main" },
        repository: {
          owner: "example",
          name: "skills",
          requestedRef: "main",
          resolvedCommit: "abc123",
        },
        rootPath: "skills/forms",
        files: [{ relativePath: "SKILL.md", contentHash: "a".repeat(64), sizeBytes: 120 }],
        fingerprint: "b".repeat(64),
        fingerprintAlgorithm: "sha256-tree-v1",
        snapshotId: "snapshot-1",
      } satisfies InspectResult,
      metadata: { category: "accessibility" },
      warnings: ["Reference file is optional."],
    });

    expect(markdown).toContain("Resolved repository: example/skills at abc123");
    expect(markdown).toContain('"category": "accessibility"');
    expect(markdown).toContain("Reference file is optional.");
    expect(markdown).toContain("## Next action");
  });

  it("summarizes evaluation failures and points to their evidence", () => {
    const markdown = renderEvaluationBundleReport({
      status: "completed",
      partition: "development",
      passRate: 0.5,
      meanScore: 0.5,
      runnerType: "mock",
      repeat: 2,
      attempts: [{}, {}],
      cases: [
        {
          evalCaseId: "create-form",
          passRate: 0.5,
          meanScore: 0.5,
          attempts: 2,
          completedAttempts: 2,
        },
      ],
    } as unknown as EvaluationSummary);

    expect(markdown).toContain("Pass rate: 50.0%");
    expect(markdown).toContain("`create-form`");
    expect(markdown).toContain("`result.json`");
  });

  it("explains a skipped merge in plain language with concrete alternatives", () => {
    const markdown = renderMergeBundleReport({
      comparisonReused: true,
      scope: {
        compatibility: "LOW",
        confidence: 0.9,
        shared: [],
        specificToA: ["accessibility"],
        specificToB: ["database"],
        evaluatedCapabilities: ["audit", "query"],
        reasons: ["No shared task category."],
      },
      plan: { reason: "Different task categories." },
    } as unknown as MergeResult);

    expect(markdown).toContain("No merged skill was generated");
    expect(markdown).toContain("Reused an existing compatible comparison");
    expect(markdown).toContain("Keep and evaluate the skills separately");
    expect(markdown).not.toContain("scopes are disjoint");
  });

  it("distinguishes development recommendation from holdout-approved final output", () => {
    const result = {
      comparisonReused: false,
      runId: "merge-1",
      scope: {
        compatibility: "PARTIAL",
        confidence: 0.8,
        shared: ["forms"],
        specificToA: [],
        specificToB: [],
        evaluatedCapabilities: ["forms"],
        reasons: ["Shared task."],
      },
      candidates: [
        { id: "candidate-1", name: "Merged forms", strategy: "balanced", files: [{ relativePath: "SKILL.md" }] },
      ],
      tournament: {
        entries: [{ id: "candidate-1", score: 0.9 }],
        selectedCandidateIds: ["candidate-1"],
      },
    } as unknown as MergeResult;

    const markdown = renderMergeBundleReport(result);
    expect(markdown).toContain("`artifacts/recommended/`");
    expect(markdown).toContain("`artifacts/candidates/candidate-1/`");
    expect(markdown).toContain("`artifacts/final/` was not created");
    expect(markdown).toContain("--holdout <path>");
  });
});
