import type { EvalSuite } from "@skillbench/sdk/evaluator";
import type { ExecutionProfile } from "@skillbench/sdk/runners";
import type { InstructionAssetReference } from "@skillbench/sdk/results";
import type { ResolvedSkill } from "@skillbench/sdk/skills";

import { profileIncursModelCalls } from "../composition/runner-registry";

export type PreflightInput = {
  operation: "eval" | "compare" | "merge";
  skills: readonly ResolvedSkill[];
  suite: EvalSuite;
  suiteInput: string;
  repeat: number;
  executionProfile: ExecutionProfile;
  candidateCount?: number;
  holdoutSuite?: EvalSuite;
  holdoutRequested?: boolean;
  output?: string;
  instructionAssets?: readonly InstructionAssetReference[];
};

export function estimateModelCalls(input: PreflightInput): number {
  if (!profileIncursModelCalls(input.executionProfile)) return 0;
  const caseRuns = input.suite.cases.length * input.repeat;
  const rubricCalls =
    input.suite.cases.reduce(
      (sum, evalCase) =>
        sum + evalCase.assertions.filter((assertion) => assertion.type === "llm-rubric").length,
      0,
    ) * 2;
  if (input.operation === "eval") return caseRuns;
  if (input.operation === "compare") return caseRuns * 2 + rubricCalls;
  const comparison = caseRuns * 2 + rubricCalls;
  const tournament = caseRuns * (input.candidateCount ?? 3);
  const holdout =
    input.holdoutSuite === undefined ? 0 : input.holdoutSuite.cases.length * input.repeat * 2;
  return comparison + tournament + holdout;
}
