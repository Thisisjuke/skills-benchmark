import { MergePlanningService, type PreparedMerge } from "@skillbench/sdk/merger";
import type { ResolvedSkill } from "@skillbench/sdk/skills";

import type { OperationEvents } from "../context";
import type { MergeComparisonStage } from "./comparison";

export function planMerge(input: {
  events: OperationEvents;
  comparison: MergeComparisonStage;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
}): Promise<PreparedMerge> {
  return input.events.progress("Planning merge", () =>
    new MergePlanningService({
      findCompatible: async () => input.comparison.importedComparison,
      createDevelopmentComparison: () => input.comparison.createDevelopmentComparison(),
    }).prepare({
      skillA: input.skillA,
      skillB: input.skillB,
      comparisonPlan: input.comparison.comparisonPlan,
    }),
  );
}
