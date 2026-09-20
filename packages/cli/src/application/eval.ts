import {
  EvaluationService,
  loadEvalSuite,
  type EvalPartition,
  type EvaluationSummary,
} from "@skillbench/sdk/evaluator";
import { createRunnerPermissions } from "@skillbench/sdk/runners";
import type { InstructionAssetReference } from "@skillbench/sdk/results";
import { renderEvaluationBundleReport } from "@skillbench/sdk/reports";
import type { ResolveOptions } from "@skillbench/sdk/sources";
import { isAbsolute, resolve } from "node:path";

import type { ApplicationContext, OperationEvents, OutputRequest } from "./context";
import { resolveApplicationSource } from "./source";
import type { WrittenBundle } from "../bundles";
import type { RunnerSelection, SkillbenchConfig } from "../config";
import { effectiveRunConfig } from "./effective-config";
import { evaluationRunCount, runnerWithProgress } from "./progress";

export type EvalRequest = OutputRequest & {
  config: SkillbenchConfig;
  projectRoot: string;
  selectRunner: () => Promise<RunnerSelection>;
  source: string;
  resolveOptions: ResolveOptions;
  evals: string;
  partition?: EvalPartition;
  repeat?: number;
  keepWorkspaces?: boolean;
  events: OperationEvents;
};

export type EvalOperationResult = {
  result: EvaluationSummary & { instructionAssets: InstructionAssetReference[] };
  bundle?: WrittenBundle;
};

export async function executeEval(
  context: ApplicationContext,
  request: EvalRequest,
): Promise<EvalOperationResult> {
  const evalsPath = projectPath(request.projectRoot, request.evals);
  const suite = loadEvalSuite(
    evalsPath,
    request.partition === undefined ? {} : { partition: request.partition },
  );
  const resolvedSkill = await request.events.progress("Resolving source", () =>
    resolveApplicationSource(
      context.sourceService(request.config, request.projectRoot),
      request.source,
      request.resolveOptions,
      context.now(),
    ),
  );
  const runnerSelection = await request.selectRunner();
  const runtime = await context.executionRuntime(
    request.config,
    runnerSelection,
    request.projectRoot,
  );
  const repeat = request.repeat ?? request.config.eval.repeat;
  const evaluator = new EvaluationService(
    runnerWithProgress({
      runner: runtime.runner,
      events: request.events,
      executionProfile: runtime.executionProfile,
      suite,
      totalRuns: evaluationRunCount(suite, repeat),
      snapshotLabels: new Map([[resolvedSkill.snapshot.id, resolvedSkill.skill.name]]),
    }),
    runtime.assertions,
    {
      logger: context.logger,
      id: context.createId,
      now: context.now,
      workspaceParent: resolve(request.projectRoot, ".skillbench", "tmp"),
    },
  );
  await request.events.confirmPreflight(
    {
      operation: "eval",
      skills: [resolvedSkill],
      suite,
      suiteInput: evalsPath,
      repeat,
      executionProfile: runtime.executionProfile,
      ...(request.output === undefined ? {} : { output: request.output }),
    },
  );
  const evaluation = await request.events.progress("Evaluating skill", () =>
    evaluator.evaluate({
      resolvedSkill,
      suite,
      repeat,
      timeoutMs: request.config.eval.timeoutMs,
      executionProfile: runtime.executionProfile,
      config: effectiveRunConfig(
        request.config,
        repeat,
        runtime.executionProfile,
        runtime.configuration,
      ),
      permissions: createRunnerPermissions(runtime.configuration.sandbox),
      keepWorkspaces: request.keepWorkspaces === true,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    }),
  );
  const result = {
    ...evaluation,
    instructionAssets: [],
  };
  const bundle =
    request.output === undefined
      ? undefined
      : context.writeBundle({
          cwd: request.projectRoot,
          command: "eval",
          output: request.output,
          result,
          sources: [{ role: "skill", skill: resolvedSkill }],
          reportMarkdown: renderEvaluationBundleReport(result),
          instructionAssets: [],
          force: request.force === true,
        });
  return { result, ...(bundle === undefined ? {} : { bundle }) };
}

function projectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
