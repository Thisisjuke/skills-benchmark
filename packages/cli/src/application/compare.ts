import { ComparisonService, type ComparisonSummary } from "@skillbench/sdk/comparator";
import { EvaluationService, loadEvalSuite, type EvalPartition } from "@skillbench/sdk/evaluator";
import { ComparisonReportService, type StoredReport } from "@skillbench/sdk/reports";
import { createRunnerPermissions } from "@skillbench/sdk/runners";
import type { ResolveOptions } from "@skillbench/sdk/sources";
import type { InstructionAssetReference } from "@skillbench/sdk/results";
import { isAbsolute, resolve } from "node:path";

import type { ApplicationContext, OperationEvents, OutputRequest } from "./context";
import { resolveApplicationSource } from "./source";
import type { WrittenBundle } from "../bundles";
import { effectiveRunConfig } from "./effective-config";
import type { RunnerChoice } from "../composition/runner-registry";
import type { SkillbenchConfig } from "../config";

export type CompareResult = ComparisonSummary & {
  sources: {
    A: { fingerprint: string };
    B: { fingerprint: string };
  };
  report?: StoredReport;
  instructionAssets: InstructionAssetReference[];
};

export type CompareRequest = OutputRequest & {
  config: SkillbenchConfig;
  projectRoot: string;
  selectRunner: () => Promise<RunnerChoice>;
  sourceA: string;
  sourceB: string;
  resolveOptionsA: ResolveOptions;
  resolveOptionsB: ResolveOptions;
  evals: string;
  partition?: EvalPartition;
  repeat?: number;
  keepWorkspaces?: boolean;
  recordHistory?: boolean;
  events: OperationEvents;
};

export type CompareOperationResult = {
  result: CompareResult;
  bundle?: WrittenBundle;
};

export async function executeCompare(
  context: ApplicationContext,
  request: CompareRequest,
): Promise<CompareOperationResult> {
  const suite = loadEvalSuite(
    projectPath(request.projectRoot, request.evals),
    request.partition === undefined ? {} : { partition: request.partition },
  );
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
  const runnerChoice = await request.selectRunner();
  const runtime = await context.executionRuntime(
    request.config,
    runnerChoice,
    request.projectRoot,
  );
  const instructionAssets = comparisonInstructionAssets(runtime, suite);
  const evaluator = new EvaluationService(runtime.runner, runtime.assertions, {
    logger: context.logger,
    id: context.createId,
    now: context.now,
    workspaceParent: resolve(request.projectRoot, ".skillbench", "tmp"),
  });
  const repeat = request.repeat ?? request.config.eval.repeat;
  const effectiveConfig = effectiveRunConfig(request.config, repeat, runtime.executionProfile);
  await request.events.confirmPreflight(
    {
      operation: "compare",
      skills: [skillA, skillB],
      suite,
      suiteInput: request.evals,
      repeat,
      executionProfile: runtime.executionProfile,
      instructionAssets: instructionAssets.map(({ id, path, contentHash, sizeBytes }) => ({
        id,
        path,
        contentHash,
        sizeBytes,
      })),
      ...(request.output === undefined ? {} : { output: request.output }),
    },
  );
  const summary = await request.events.progress("Comparing skills", () =>
    new ComparisonService(evaluator, {
      ...(runtime.judge === undefined ? {} : { judge: runtime.judge }),
      logger: context.logger,
      id: context.createId,
      now: context.now,
    }).compare({
      skillA,
      skillB,
      suite,
      repeat,
      timeoutMs: request.config.eval.timeoutMs,
      executionProfile: runtime.executionProfile,
      permissions: createRunnerPermissions(request.config.runner.sandbox),
      weights: request.config.comparison.weights,
      tieThreshold: request.config.comparison.tieThreshold,
      effectiveConfig,
      keepWorkspaces: request.keepWorkspaces === true,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    }),
  );
  const report = request.config.reports.markdown
    ? new ComparisonReportService({ id: context.createId, now: context.now }).create(
        summary,
        skillA,
        skillB,
      )
    : undefined;
  const result: CompareResult = {
    ...summary,
    instructionAssets: instructionAssets.map(({ id, path, contentHash, sizeBytes }) => ({
      id,
      path,
      contentHash,
      sizeBytes,
    })),
    sources: {
      A: { fingerprint: skillA.snapshot.fingerprint },
      B: { fingerprint: skillB.snapshot.fingerprint },
    },
    ...(report === undefined ? {} : { report }),
  };
  const bundle =
    request.output === undefined
      ? undefined
      : context.writeBundle({
          cwd: request.projectRoot,
          command: "compare",
          output: request.output,
          result,
          sources: [
            { role: "A", skill: skillA },
            { role: "B", skill: skillB },
          ],
          instructionAssets,
          ...(report === undefined ? {} : { reports: [report] }),
          force: request.force === true,
        });
  if (request.recordHistory === true) {
    context.recordComparison({
      cwd: request.projectRoot,
      sourceA: request.sourceA,
      sourceB: request.sourceB,
      ...(request.resolveOptionsA.skillPath === undefined
        ? {}
        : { skillPathA: request.resolveOptionsA.skillPath }),
      ...(request.resolveOptionsB.skillPath === undefined
        ? {}
        : { skillPathB: request.resolveOptionsB.skillPath }),
      evals: request.evals,
      ...(request.output === undefined ? {} : { output: request.output }),
      partition: suite.partition,
      repeat,
      runner: runnerChoice.runner,
      ...(runnerChoice.model === undefined ? {} : { model: runnerChoice.model }),
      ...(runnerChoice.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: runnerChoice.reasoningEffort }),
    });
  }
  return { result, ...(bundle === undefined ? {} : { bundle }) };
}

function comparisonInstructionAssets(
  runtime: Awaited<ReturnType<ApplicationContext["executionRuntime"]>>,
  suite: ReturnType<typeof loadEvalSuite>,
) {
  const usesJudge =
    runtime.judge !== undefined &&
    suite.cases.some((evalCase) =>
      evalCase.assertions.some((assertion) => assertion.type === "llm-rubric"),
    );
  return usesJudge
    ? [runtime.instructionAssets.judgeSkill, runtime.instructionAssets.judgeInstruction]
    : [];
}

function projectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
