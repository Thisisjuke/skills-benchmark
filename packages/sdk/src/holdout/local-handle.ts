import { SkillbenchError } from "../errors";
import type { EvalSuite, EvaluationSummary } from "../evaluator";
import type { ExecutionProfile, RunnerPermissions } from "../runners";
import type { ResolvedSkill } from "../skills";
import type {
  HoldoutExecutionHandle,
  HoldoutExecutionRequest,
  HoldoutExecutionResult,
} from "./types";

export type HoldoutEvaluationConfig = {
  repeat: number;
  timeoutMs: number;
  executionProfile: ExecutionProfile;
  permissions: RunnerPermissions;
  effectiveConfig: Record<string, unknown>;
  signal?: AbortSignal;
};

export type HoldoutEvaluator = {
  evaluate(input: {
    resolvedSkill: ResolvedSkill;
    suite: EvalSuite;
    repeat: number;
    timeoutMs: number;
    executionProfile: ExecutionProfile;
    permissions: RunnerPermissions;
    config: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<EvaluationSummary>;
};

export type HoldoutSnapshotReader = {
  getById(snapshotId: string): ResolvedSkill;
};

export type LocalHoldoutHandleInput = {
  loadSuite: () => EvalSuite;
  evaluator: HoldoutEvaluator;
  snapshots: HoldoutSnapshotReader;
  config: HoldoutEvaluationConfig;
};

export function createLocalHoldoutExecutionHandle(
  input: LocalHoldoutHandleInput,
): HoldoutExecutionHandle {
  const execute = async (request: HoldoutExecutionRequest): Promise<HoldoutExecutionResult> => {
    const suite = input.loadSuite();
    if (suite.partition !== "holdout") {
      throw new SkillbenchError("Holdout handle loaded a non-holdout suite", {
        code: "HOLDOUT_PARTITION_REQUIRED",
      });
    }
    const entries = [];
    for (const subject of request.subjects) {
      input.config.signal?.throwIfAborted();
      const summary = await input.evaluator.evaluate({
        resolvedSkill: input.snapshots.getById(subject.snapshotId),
        suite,
        repeat: input.config.repeat,
        timeoutMs: input.config.timeoutMs,
        executionProfile: input.config.executionProfile,
        permissions: input.config.permissions,
        config: structuredClone(input.config.effectiveConfig),
        ...(input.config.signal === undefined ? {} : { signal: input.config.signal }),
      });
      entries.push({
        ...subject,
        evaluationRunId: summary.runId,
        score: summary.meanScore,
        passRate: summary.passRate,
        status: summary.status,
      });
    }
    return {
      mergeRunId: request.mergeRunId,
      suiteId: suite.id,
      partition: "holdout",
      entries,
    };
  };
  return Object.freeze({ execute });
}
