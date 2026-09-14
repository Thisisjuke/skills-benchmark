import { SkillbenchError } from "../errors";
import type { ComparisonSummary } from "../comparator";
import type { DevelopmentEvidence } from "./types";

export function projectDevelopmentEvidence(summary: ComparisonSummary): DevelopmentEvidence {
  if (summary.plan.partition !== "development") {
    throw new SkillbenchError("Merge planning requires a development comparison", {
      code: "MERGE_DEVELOPMENT_REQUIRED",
    });
  }
  return {
    comparisonId: summary.comparisonId,
    comparisonRunId: summary.runId,
    snapshotAId: summary.snapshotAId,
    snapshotBId: summary.snapshotBId,
    suiteId: summary.plan.suiteId,
    partition: "development",
    scope: structuredClone(summary.scope),
    dimensions: summary.dimensions.map((dimension) => ({
      name: dimension.name,
      scoreA: dimension.scoreA,
      scoreB: dimension.scoreB,
      available: dimension.available,
    })),
    capabilityMatrix: structuredClone(summary.capabilityMatrix),
  };
}
