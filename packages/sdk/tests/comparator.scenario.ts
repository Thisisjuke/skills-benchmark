// Registered by the SDK comparison scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  ScopeAnalyzer,
  scoreComparison,
  validateWeights,
  type ComparisonWeights,
} from "@skillbench/sdk/comparator";
import type { EvalAttempt, EvalSuite, EvaluationSummary } from "@skillbench/sdk/evaluator";
import { MOCK_EXECUTION_PROFILE } from "@skillbench/sdk/runners";
import type { ParsedSkill } from "@skillbench/sdk/skills";

const weights: ComparisonWeights = {
  functionalCorrectness: 0.4,
  outputQuality: 0.2,
  edgeCases: 0.15,
  skillTriggering: 0.1,
  instructionFollowing: 0.05,
  tokenEfficiency: 0.05,
  latency: 0.05,
};

function summary(
  side: string,
  score: number,
  durationMs: number,
  tokens?: { input: number; output: number },
): EvaluationSummary {
  const runnerResult = {
    status: "completed" as const,
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs,
    artifacts: [],
    ...(tokens === undefined ? {} : { tokens }),
  };
  const attempt: EvalAttempt = {
    id: `${side}-attempt`,
    evalCaseId: "case",
    repetition: 1,
    status: "completed",
    passed: score === 1,
    score,
    durationMs,
    runnerResult,
    assertions: [],
  };
  return {
    runId: `${side}-run`,
    snapshotId: `${side}-snapshot`,
    suiteId: "suite",
    partition: "development",
    runnerType: "mock",
    executionProfile: MOCK_EXECUTION_PROFILE,
    repeat: 1,
    status: "completed",
    passRate: score === 1 ? 1 : 0,
    meanScore: score,
    cases: [
      {
        evalCaseId: "case",
        attempts: 1,
        completedAttempts: 1,
        passRate: score === 1 ? 1 : 0,
        meanScore: score,
        medianScore: score,
        scoreVariance: 0,
        meanDurationMs: durationMs,
        ...(tokens === undefined ? {} : { tokens }),
      },
    ],
    attempts: [attempt],
    createdAt: "2026-09-03T00:00:00.000Z",
    finishedAt: "2026-09-03T00:00:01.000Z",
  };
}

function skill(capabilities: string[]): ParsedSkill {
  return {
    name: capabilities.join("-"),
    description: capabilities.join(" "),
    metadata: { capabilities },
    markdown: "",
    relativeReferences: [],
  };
}

const suite: EvalSuite = {
  id: "suite",
  partition: "development",
  rootPath: "/suite",
  cases: [
    {
      id: "react-rendering",
      name: "React rendering",
      prompt: "test",
      partition: "development",
      fixtures: [],
      assertions: [{ type: "exit-code", value: 0 }],
      sourcePath: "/suite/case.yaml",
      contentHash: "hash",
    },
  ],
};

describe("comparison scoring", () => {
  it("selects A, B after inversion, and an exact tie reproducibly", () => {
    const a = summary("a", 1, 100, { input: 8, output: 2 });
    const b = summary("b", 0, 200, { input: 18, output: 2 });
    const forward = scoreComparison(a, b, weights, 0.01);
    const reversed = scoreComparison(b, a, weights, 0.01);
    const tied = scoreComparison(a, structuredClone(a), weights, 0.01);

    expect(forward.verdict.winner).toBe("A");
    expect(reversed.verdict.winner).toBe("B");
    expect(reversed.verdict.scoreA).toBe(forward.verdict.scoreB);
    expect(reversed.verdict.scoreB).toBe(forward.verdict.scoreA);
    expect(tied.verdict).toMatchObject({ winner: "tie", difference: 0 });
    expect(forward.verdict.statement).toContain("not a universal ranking");
  });

  it("renormalizes available weights when token telemetry is absent", () => {
    const result = scoreComparison(summary("a", 1, 100), summary("b", 0.5, 100), weights, 0);
    const tokens = result.dimensions.find((dimension) => dimension.name === "tokenEfficiency");
    const functional = result.dimensions.find(
      (dimension) => dimension.name === "functionalCorrectness",
    );
    expect(tokens).toMatchObject({
      available: false,
      effectiveWeight: 0,
      scoreA: null,
      scoreB: null,
    });
    expect(functional?.effectiveWeight).toBeCloseTo(0.4 / 0.45, 12);
    expect(result.dimensions.reduce((sum, item) => sum + item.effectiveWeight, 0)).toBeCloseTo(
      1,
      12,
    );
  });

  it("rejects non-normalized or non-dominant weights", () => {
    expect(() => validateWeights({ ...weights, latency: 0.1 })).toThrow(/sum to 1/u);
    expect(() =>
      validateWeights({
        ...weights,
        functionalCorrectness: 0.2,
        outputQuality: 0.4,
      }),
    ).toThrow(/dominant/u);
  });
});

describe("ScopeAnalyzer", () => {
  it.each([
    [["react", "rendering", "state"], ["react", "rendering", "state"], "HIGH"],
    [["react", "rendering", "accessibility"], ["react", "performance", "bundle"], "PARTIAL"],
    [["accessibility", "aria"], ["database", "indexes"], "LOW"],
  ] as const)("classifies %s vs %s as %s", (left, right, expected) => {
    const analysis = new ScopeAnalyzer().analyze(skill([...left]), skill([...right]), suite);
    expect(analysis.compatibility).toBe(expected);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(analysis.confidence).toBeLessThanOrEqual(1);
  });

  it("is stable when A and B are inverted", () => {
    const analyzer = new ScopeAnalyzer();
    const left = skill(["react", "rendering", "accessibility"]);
    const right = skill(["react", "performance", "bundle"]);
    const forward = analyzer.analyze(left, right, suite);
    const reversed = analyzer.analyze(right, left, suite);
    expect(reversed.compatibility).toBe(forward.compatibility);
    expect(reversed.confidence).toBe(forward.confidence);
    expect(reversed.shared).toEqual(forward.shared);
    expect(reversed.specificToA).toEqual(forward.specificToB);
    expect(reversed.specificToB).toEqual(forward.specificToA);
  });
});
