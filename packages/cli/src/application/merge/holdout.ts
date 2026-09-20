import { EvaluationService, loadEvalSuite } from "@skillbench/sdk/evaluator";
import { SkillbenchError } from "@skillbench/sdk/errors";
import {
  createLocalHoldoutExecutionHandle,
  HoldoutGate,
  HoldoutValidationService,
  type HoldoutValidation,
} from "@skillbench/sdk/holdout";
import type {
  DevelopmentTournament,
  MergeGenerationSummary,
} from "@skillbench/sdk/merger";
import type { RunnerPermissions } from "@skillbench/sdk/runners";
import type { ResolvedSkill } from "@skillbench/sdk/skills";
import { isAbsolute, resolve } from "node:path";

import type { ApplicationContext, OperationEvents } from "../context";
import type { ExecutionRuntime } from "../../composition/execution-runtime";
import type { SkillbenchConfig } from "../../config";
import { evaluationRunCount, runnerWithProgress } from "../progress";

export async function validateMergeHoldout(input: {
  context: ApplicationContext;
  events: OperationEvents;
  config: SkillbenchConfig;
  projectRoot: string;
  holdout?: string;
  runtime: ExecutionRuntime;
  generation: MergeGenerationSummary;
  tournament: DevelopmentTournament;
  snapshots: Map<string, ResolvedSkill>;
  repeat: number;
  permissions: RunnerPermissions;
  effectiveConfig: Record<string, unknown>;
}): Promise<HoldoutValidation | undefined> {
  const holdout = input.holdout;
  if (holdout === undefined) return undefined;
  const selection = {
    mergeRunId: input.generation.runId,
    bestParentId: input.tournament.bestParentId,
    candidateIds: input.tournament.selectedCandidateIds,
  };
  const holdoutSuite = loadEvalSuite(projectPath(input.projectRoot, holdout), {
    partition: "holdout",
  });
  const handle = createLocalHoldoutExecutionHandle({
    loadSuite: () => holdoutSuite,
    evaluator: new EvaluationService(
      runnerWithProgress({
        runner: input.runtime.runner,
        events: input.events,
        executionProfile: input.runtime.executionProfile,
        suite: holdoutSuite,
        totalRuns: evaluationRunCount(
          holdoutSuite,
          input.repeat,
          selection.candidateIds.length + 1,
        ),
        snapshotLabels: new Map(
          [...input.snapshots.values()].map((skill) => [skill.snapshot.id, skill.skill.name]),
        ),
      }),
      input.runtime.assertions,
      {
        logger: input.context.logger,
        id: input.context.createId,
        now: input.context.now,
        workspaceParent: resolve(input.projectRoot, ".skillbench", "tmp"),
      },
    ),
    snapshots: {
      getById: (snapshotId) => {
        const snapshot = input.snapshots.get(snapshotId);
        if (snapshot === undefined) {
          throw new SkillbenchError(`Holdout snapshot not found: ${snapshotId}`, {
            code: "HOLDOUT_SNAPSHOT_NOT_FOUND",
          });
        }
        return snapshot;
      },
    },
    config: {
      repeat: input.repeat,
      timeoutMs: input.config.eval.timeoutMs,
      executionProfile: input.runtime.executionProfile,
      permissions: input.permissions,
      effectiveConfig: input.effectiveConfig,
      ...(input.context.signal === undefined ? {} : { signal: input.context.signal }),
    },
  });
  const execution = await input.events.progress("Validating holdout", () =>
    new HoldoutGate({
      getTournament: (runId) => {
        if (runId !== input.generation.runId) {
          throw new SkillbenchError(`Tournament not found: ${runId}`, {
            code: "MERGE_TOURNAMENT_NOT_FOUND",
          });
        }
        return input.tournament;
      },
    }).execute(selection, handle),
  );
  return new HoldoutValidationService({ now: input.context.now }).complete({
    execution,
    selection,
    tournament: input.tournament,
    policy: {
      requireImprovement: input.config.merge.requireImprovement,
      minimumImprovement: input.config.merge.minimumImprovement,
    },
  });
}

function projectPath(projectRoot: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}
