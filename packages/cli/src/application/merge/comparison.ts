import {
  ComparisonService,
  type ComparisonPlan,
  type ComparisonSummary,
} from "@skillbench/sdk/comparator";
import { EvaluationService, type EvalSuite } from "@skillbench/sdk/evaluator";
import type { RunnerPermissions } from "@skillbench/sdk/runners";
import type { ResolvedSkill } from "@skillbench/sdk/skills";
import { resolve } from "node:path";

import type { ApplicationContext } from "../context";
import type { ProjectAsset } from "../../assets";
import { loadComparisonInput } from "../../comparison";
import type { ExecutionRuntime } from "../../composition/execution-runtime";
import type { SkillbenchConfig } from "../../config";

export type MergeComparisonStage = {
  comparisonPlan: ComparisonPlan;
  importedComparison?: ComparisonSummary;
  comparisonAssets: ProjectAsset[];
  createDevelopmentComparison(): Promise<ComparisonSummary>;
};

export function createMergeComparisonStage(input: {
  context: ApplicationContext;
  config: SkillbenchConfig;
  projectRoot: string;
  comparisonPath?: string;
  runtime: ExecutionRuntime;
  suite: EvalSuite;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  repeat: number;
  permissions: RunnerPermissions;
  effectiveConfig: Record<string, unknown>;
}): MergeComparisonStage {
  const comparisonPlan: ComparisonPlan = {
    suiteId: input.suite.id,
    partition: "development",
    repeat: input.repeat,
    timeoutMs: input.config.eval.timeoutMs,
    runnerType: input.runtime.executionProfile.runner,
    executionProfile: input.runtime.executionProfile,
    permissions: input.permissions,
    effectiveConfig: input.effectiveConfig,
  };
  const importedComparison =
    input.comparisonPath === undefined
      ? undefined
      : loadComparisonInput(
          input.comparisonPath,
          input.projectRoot,
          input.skillA,
          input.skillB,
        ).summary;
  const comparisonAssets =
    importedComparison === undefined ? comparisonInstructionAssets(input.runtime, input.suite) : [];

  return {
    comparisonPlan,
    ...(importedComparison === undefined ? {} : { importedComparison }),
    comparisonAssets,
    createDevelopmentComparison: () => createDevelopmentComparison(input),
  };
}

async function createDevelopmentComparison(
  input: Parameters<typeof createMergeComparisonStage>[0],
) {
  const evaluator = new EvaluationService(input.runtime.runner, input.runtime.assertions, {
    logger: input.context.logger,
    id: input.context.createId,
    now: input.context.now,
    workspaceParent: resolve(input.projectRoot, ".skillbench", "tmp"),
  });
  return new ComparisonService(evaluator, {
    ...(input.runtime.judge === undefined ? {} : { judge: input.runtime.judge }),
    logger: input.context.logger,
    id: input.context.createId,
    now: input.context.now,
  }).compare({
    skillA: input.skillA,
    skillB: input.skillB,
    suite: input.suite,
    repeat: input.repeat,
    timeoutMs: input.config.eval.timeoutMs,
    executionProfile: input.runtime.executionProfile,
    permissions: input.permissions,
    weights: input.config.comparison.weights,
    tieThreshold: input.config.comparison.tieThreshold,
    effectiveConfig: input.effectiveConfig,
    ...(input.context.signal === undefined ? {} : { signal: input.context.signal }),
  });
}

function comparisonInstructionAssets(
  runtime: ExecutionRuntime,
  suite: EvalSuite,
): ProjectAsset[] {
  const usesJudge =
    runtime.judge !== undefined &&
    suite.cases.some((evalCase) =>
      evalCase.assertions.some((assertion) => assertion.type === "llm-rubric"),
    );
  return usesJudge
    ? [runtime.instructionAssets.judgeSkill, runtime.instructionAssets.judgeInstruction]
    : [];
}
