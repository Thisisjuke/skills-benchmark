import { loadEvalSuite } from "@skillbench/sdk/evaluator";
import { SkillbenchError } from "@skillbench/sdk/errors";
import type { MergeResult } from "@skillbench/sdk/results";
import { createRunnerPermissions } from "@skillbench/sdk/runners";
import type { ResolveOptions } from "@skillbench/sdk/sources";
import { isAbsolute, resolve } from "node:path";

import type { ApplicationContext, OperationEvents, OutputRequest } from "./context";
import { resolveApplicationSource } from "./source";
import type { WrittenBundle } from "../bundles";
import { effectiveRunConfig } from "./effective-config";
import type { RunnerSelection, SkillbenchConfig } from "../config";
import { createMergeComparisonStage } from "./merge/comparison";
import {
  generateMergeCandidates,
  runDevelopmentTournament,
} from "./merge/generation";
import { validateMergeHoldout } from "./merge/holdout";
import { planMerge } from "./merge/planning";
import {
  assetReference,
  materializeCompletedMerge,
  materializeMergeNotRecommended,
} from "./merge/materialization";

export type MergeRequest = OutputRequest & {
  config: SkillbenchConfig;
  projectRoot: string;
  selectRunner: () => Promise<RunnerSelection>;
  sourceA: string;
  sourceB: string;
  resolveOptionsA: ResolveOptions;
  resolveOptionsB: ResolveOptions;
  evals: string;
  holdout?: string;
  comparison?: string;
  repeat?: number;
  events: OperationEvents;
};

export type MergeOperationResult = {
  result: MergeResult;
  bundle?: WrittenBundle;
};

export async function executeMerge(
  context: ApplicationContext,
  request: MergeRequest,
): Promise<MergeOperationResult> {
  const evalsPath = projectPath(request.projectRoot, request.evals);
  const suite = loadEvalSuite(evalsPath, {
    partition: "development",
  });
  if (suite.partition !== "development") {
    throw new SkillbenchError("Merge generation accepts development evals only", {
      code: "MERGE_DEVELOPMENT_REQUIRED",
    });
  }
  const sources = context.sourceService(request.config, request.projectRoot);
  const [skillA, skillB] = await request.events.progress(
    "Resolving sources",
    async () =>
      [
        await resolveApplicationSource(
          sources,
          request.sourceA,
          request.resolveOptionsA,
          context.now(),
        ),
        await resolveApplicationSource(
          sources,
          request.sourceB,
          request.resolveOptionsB,
          context.now(),
        ),
      ] as const,
  );
  const runnerSelection = await request.selectRunner();
  const runtime = await context.executionRuntime(
    request.config,
    runnerSelection,
    request.projectRoot,
  );
  const repeat = request.repeat ?? request.config.eval.repeat;
  const effectiveConfig = effectiveRunConfig(
    request.config,
    repeat,
    runtime.executionProfile,
    runtime.configuration,
  );
  const permissions = createRunnerPermissions(runtime.configuration.sandbox);
  const comparisonStage = createMergeComparisonStage({
    context,
    config: request.config,
    projectRoot: request.projectRoot,
    ...(request.comparison === undefined ? {} : { comparisonPath: request.comparison }),
    runtime,
    suite,
    skillA,
    skillB,
    repeat,
    permissions,
    effectiveConfig,
    events: request.events,
  });
  await request.events.confirmPreflight(
    {
      operation: "merge",
      skills: [skillA, skillB],
      suite,
      suiteInput: evalsPath,
      repeat,
      executionProfile: runtime.executionProfile,
      instructionAssets: [
        ...comparisonStage.comparisonAssets,
        runtime.instructionAssets.mergeCandidateTemplate,
      ].map(assetReference),
      candidateCount: request.config.merge.candidates,
      holdoutRequested: request.holdout !== undefined,
      ...(request.output === undefined ? {} : { output: request.output }),
    },
  );
  const planning = await planMerge({
    events: request.events,
    comparison: comparisonStage,
    skillA,
    skillB,
  });

  if (planning.plan.status === "MERGE_NOT_RECOMMENDED") {
    return materializeMergeNotRecommended({
      context,
      projectRoot: request.projectRoot,
      ...(request.output === undefined ? {} : { output: request.output }),
      force: request.force === true,
      planning,
      skillA,
      skillB,
      instructionAssets: comparisonStage.comparisonAssets,
    });
  }

  const instructionAssets = [
    ...comparisonStage.comparisonAssets,
    runtime.instructionAssets.mergeCandidateTemplate,
  ];
  const generation = generateMergeCandidates({
    context,
    runtime,
    planning,
    skillA,
    skillB,
    effectiveConfig,
  });
  const { tournament, snapshots } = await runDevelopmentTournament({
    context,
    events: request.events,
    projectRoot: request.projectRoot,
    runtime,
    generation,
    planning,
    skillA,
    skillB,
    suite,
  });
  const holdoutValidation = await validateMergeHoldout({
    context,
    events: request.events,
    config: request.config,
    projectRoot: request.projectRoot,
    ...(request.holdout === undefined ? {} : { holdout: request.holdout }),
    runtime,
    generation,
    tournament,
    snapshots,
    repeat,
    permissions,
    effectiveConfig,
  });
  return materializeCompletedMerge({
    context,
    projectRoot: request.projectRoot,
    ...(request.output === undefined ? {} : { output: request.output }),
    force: request.force === true,
    planning,
    generation,
    tournament,
    ...(holdoutValidation === undefined ? {} : { holdoutValidation }),
    skillA,
    skillB,
    instructionAssets,
  });
}

function projectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
