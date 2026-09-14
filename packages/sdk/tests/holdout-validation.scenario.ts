// Registered by the SDK merge scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  decideHoldoutVerdict,
  type HoldoutExecutionResult,
  type HoldoutFinalistSelection,
} from "@skillbench/sdk/holdout";
import type { DevelopmentTournament } from "@skillbench/sdk/merger";

const selection: HoldoutFinalistSelection = {
  mergeRunId: "merge-1",
  bestParentId: "B",
  candidateIds: ["C1", "C2"],
};

const tournament: DevelopmentTournament = {
  suiteId: "development",
  entries: [
    {
      kind: "parent",
      id: "A",
      snapshotId: "snapshot-a",
      evaluationRunId: "dev-a",
      score: 0.8,
      passRate: 0.8,
      status: "completed",
    },
    {
      kind: "parent",
      id: "B",
      snapshotId: "snapshot-b",
      evaluationRunId: "dev-b",
      score: 0.9,
      passRate: 0.9,
      status: "completed",
    },
    {
      kind: "candidate",
      id: "C1",
      snapshotId: "snapshot-c1",
      evaluationRunId: "dev-c1",
      score: 0.95,
      passRate: 1,
      status: "completed",
    },
    {
      kind: "candidate",
      id: "C2",
      snapshotId: "snapshot-c2",
      evaluationRunId: "dev-c2",
      score: 0.92,
      passRate: 1,
      status: "completed",
    },
  ],
  bestParentId: "B",
  bestParentScore: 0.9,
  selectedCandidateIds: ["C1", "C2"],
};

function execution(
  parentScore: number,
  candidateScores: number[],
  status: "completed" | "failed" = "completed",
): HoldoutExecutionResult {
  return {
    mergeRunId: "merge-1",
    suiteId: "holdout",
    partition: "holdout",
    entries: [
      {
        kind: "parent",
        id: "B",
        snapshotId: "snapshot-b",
        evaluationRunId: "holdout-b",
        score: parentScore,
        passRate: parentScore,
        status,
      },
      ...candidateScores.map((score, index) => ({
        kind: "candidate" as const,
        id: `C${index + 1}`,
        snapshotId: `snapshot-c${index + 1}`,
        evaluationRunId: `holdout-c${index + 1}`,
        score,
        passRate: score,
        status,
      })),
    ],
  };
}

describe("holdout acceptance policy", () => {
  it("accepts 94 over 89 and rejects candidates at or below 89 when the parent scores 91", () => {
    const accepted = decideHoldoutVerdict({
      execution: execution(0.89, [0.88, 0.94]),
      selection,
      tournament,
      policy: { requireImprovement: true, minimumImprovement: 0 },
    });
    expect(accepted).toMatchObject({ status: "ACCEPTED", winnerId: "C2" });
    expect(accepted.improvement).toBeCloseTo(0.05, 12);

    expect(
      decideHoldoutVerdict({
        execution: execution(0.91, [0.87, 0.89]),
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0 },
      }),
    ).toMatchObject({ status: "REJECTED", winnerId: "B", bestCandidateId: "C2" });
  });

  it("handles equality according to requireImprovement and enforces minimumImprovement", () => {
    const tied = execution(0.9, [0.9, 0.8]);
    expect(
      decideHoldoutVerdict({
        execution: tied,
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0 },
      }).status,
    ).toBe("REJECTED");
    expect(
      decideHoldoutVerdict({
        execution: tied,
        selection,
        tournament,
        policy: { requireImprovement: false, minimumImprovement: 0 },
      }).status,
    ).toBe("ACCEPTED");
    expect(
      decideHoldoutVerdict({
        execution: execution(0.9, [0.919, 0.8]),
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0.02 },
      }).status,
    ).toBe("REJECTED");
    expect(
      decideHoldoutVerdict({
        execution: execution(0.9, [0.92, 0.8]),
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0.02 },
      }).status,
    ).toBe("ACCEPTED");
  });

  it("rejects incomplete and failed holdout runs while retaining the parent", () => {
    const incomplete = execution(0.9, [0.95]);
    expect(
      decideHoldoutVerdict({
        execution: incomplete,
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0 },
      }),
    ).toMatchObject({
      status: "REJECTED",
      winnerId: "B",
      confidence: 0,
      reason: expect.stringContaining("incomplete"),
    });
    expect(
      decideHoldoutVerdict({
        execution: execution(0.9, [1, 1], "failed"),
        selection,
        tournament,
        policy: { requireImprovement: true, minimumImprovement: 0 },
      }),
    ).toMatchObject({
      status: "REJECTED",
      winnerId: "B",
      confidence: 0,
    });
  });

  it("keeps confidence explicitly bounded without claiming statistical significance", () => {
    const verdict = decideHoldoutVerdict({
      execution: execution(0.5, [0.8, 0.7]),
      selection,
      tournament,
      policy: { requireImprovement: true, minimumImprovement: 0 },
    });
    expect(verdict.confidence).toBeGreaterThanOrEqual(0);
    expect(verdict.confidence).toBeLessThanOrEqual(1);
    expect(verdict.confidenceBasis).toBe("mean-pass-rate-not-statistical");
  });
});
