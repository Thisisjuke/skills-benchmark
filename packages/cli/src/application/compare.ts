import { ComparisonService, type ComparisonSummary } from "@skillbench/sdk/comparator";
import { EvaluationService, loadEvalSuite, type EvalPartition } from "@skillbench/sdk/evaluator";
import {
  ComparisonReportService,
  createComparisonTemplateRenderer,
  type StoredReport,
} from "@skillbench/sdk/reports";
import { createRunnerPermissions } from "@skillbench/sdk/runners";
import type { ResolveOptions } from "@skillbench/sdk/sources";
import type { InstructionAssetReference } from "@skillbench/sdk/results";
import { isAbsolute, resolve } from "node:path";

import type { ApplicationContext, OperationEvents, OutputRequest } from "./context";
import { resolveApplicationSource } from "./source";
import type { WrittenBundle } from "../bundles";
import { effectiveRunConfig } from "./effective-config";
import type { RunnerSelection, SkillbenchConfig } from "../config";
import { loadProjectFileAsset } from "../assets";
import {
  evaluationRunCount,
  judgeWithProgress,
  qualitativeJudgmentCount,
  runnerWithProgress,
} from "./progress";

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
  selectRunner: () => Promise<RunnerSelection>;
  sourceA: string;
  sourceB: string;
  resolveOptionsA: ResolveOptions;
  resolveOptionsB: ResolveOptions;
  evals: string;
  reportTemplate?: string;
  partition?: EvalPartition;
  repeat?: number;
  keepWorkspaces?: boolean;
  recordHistory?: boolean;
  historyOutput?: string;
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
  const evalsPath = projectPath(request.projectRoot, request.evals);
  const suite = loadEvalSuite(
    evalsPath,
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
  const runnerSelection = await request.selectRunner();
  const runtime = await context.executionRuntime(
    request.config,
    runnerSelection,
    request.projectRoot,
  );
  const instructionAssets = comparisonInstructionAssets(runtime, suite);
  const reportTemplate = loadProjectFileAsset(
    request.projectRoot,
    "comparison-template",
    request.reportTemplate ?? request.config.reports.template,
  );
  const reportRenderer = createComparisonTemplateRenderer(
    reportTemplate.text,
    reportTemplate.contentHash,
  );
  const repeat = request.repeat ?? request.config.eval.repeat;
  const evaluator = new EvaluationService(
    runnerWithProgress({
      runner: runtime.runner,
      events: request.events,
      executionProfile: runtime.executionProfile,
      suite,
      totalRuns: evaluationRunCount(suite, repeat, 2),
      snapshotLabels: new Map([
        [skillA.snapshot.id, `skill A (${skillA.skill.name})`],
        [skillB.snapshot.id, `skill B (${skillB.skill.name})`],
      ]),
    }),
    runtime.assertions,
    {
      logger: context.logger,
      id: context.createId,
      now: context.now,
      workspaceParent: resolve(request.projectRoot, ".skillbench", "tmp"),
    },
  );
  const effectiveConfig = effectiveRunConfig(
    request.config,
    repeat,
    runtime.executionProfile,
    runtime.configuration,
  );
  await request.events.confirmPreflight(
    {
      operation: "compare",
      skills: [skillA, skillB],
      suite,
      suiteInput: evalsPath,
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
      ...(runtime.judge === undefined
        ? {}
        : {
            judge: judgeWithProgress({
              judge: runtime.judge,
              events: request.events,
              totalJudgments: qualitativeJudgmentCount(suite),
            }),
          }),
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
      permissions: createRunnerPermissions(runtime.configuration.sandbox),
      weights: request.config.comparison.weights,
      tieThreshold: request.config.comparison.tieThreshold,
      effectiveConfig,
      keepWorkspaces: request.keepWorkspaces === true,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    }),
  );
  const report = request.config.reports.markdown
    ? new ComparisonReportService({
        id: context.createId,
        now: context.now,
        renderer: reportRenderer,
      }).create(
        summary,
        skillA,
        skillB,
      )
    : undefined;
  const bundleReport =
    request.output === undefined || report !== undefined
      ? report
      : new ComparisonReportService({
          id: context.createId,
          now: context.now,
          renderer: reportRenderer,
        }).create(
          summary,
          skillA,
          skillB,
        );
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
          reportTemplates: [reportTemplate],
          reportMarkdown: (bundleReport ?? report)?.markdown ?? "# Skill comparison\n",
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
      ...(request.historyOutput === undefined ? {} : { output: request.historyOutput }),
      partition: suite.partition,
      repeat,
      runner: runnerSelection.choice.runner,
      ...(runnerSelection.choice.model === undefined
        ? {}
        : { model: runnerSelection.choice.model }),
      ...(runnerSelection.choice.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: runnerSelection.choice.reasoningEffort }),
      ...(runnerSelection.choice.runner === "opencode" &&
      runnerSelection.choice.variant !== undefined
        ? { variant: runnerSelection.choice.variant }
        : {}),
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
    ? [runtime.instructionAssets.judgeSkill]
    : [];
}

function projectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
