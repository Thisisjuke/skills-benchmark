import type { ComparisonPlan, ComparisonSummary } from "../comparator";
import type { ResolvedSkill } from "../skills";
import { projectDevelopmentEvidence } from "./evidence";
import { CapabilityExtractor } from "./extractor";
import type { MergePlan } from "./types";

export type ComparisonRequest = {
  snapshotAId: string;
  snapshotBId: string;
  plan: ComparisonPlan;
};

export interface MergeComparisonResolver {
  findCompatible(request: ComparisonRequest): Promise<ComparisonSummary | undefined>;
  createDevelopmentComparison(request: ComparisonRequest): Promise<ComparisonSummary>;
}

export type PrepareMergeInput = {
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  comparisonPlan: ComparisonPlan;
};

export type PreparedMerge = {
  comparisonReused: boolean;
  comparison: ComparisonSummary;
  plan: MergePlan;
};

export class MergePlanningService {
  constructor(
    private readonly comparisons: MergeComparisonResolver,
    private readonly extractor = new CapabilityExtractor(),
  ) {}

  async prepare(input: PrepareMergeInput): Promise<PreparedMerge> {
    const request: ComparisonRequest = {
      snapshotAId: input.skillA.snapshot.id,
      snapshotBId: input.skillB.snapshot.id,
      plan: input.comparisonPlan,
    };
    const found = await this.comparisons.findCompatible(request);
    const comparisonReused = found !== undefined && compatible(found, request);
    const summary = comparisonReused
      ? found
      : await this.comparisons.createDevelopmentComparison(request);
    if (!compatible(summary, request)) throw new Error("Comparison resolver returned an incompatible comparison");
    return {
      comparisonReused,
      comparison: summary,
      plan: this.extractor.extract(projectDevelopmentEvidence(summary), input.skillA, input.skillB),
    };
  }
}

function compatible(summary: ComparisonSummary, request: ComparisonRequest): boolean {
  return (
    summary.snapshotAId === request.snapshotAId &&
    summary.snapshotBId === request.snapshotBId &&
    summary.plan.partition === "development" &&
    request.plan.partition === "development" &&
    JSON.stringify(summary.plan) === JSON.stringify(request.plan)
  );
}
