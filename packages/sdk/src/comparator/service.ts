import type { EvalSuite, EvaluationService } from "../evaluator";
import type { BlindPairwiseResult } from "../judge";
import { silentLogger, type Logger } from "../logging";
import type { ExecutionProfile, RunnerPermissions } from "../runners";
import type { ResolvedSkill } from "../skills";
import { scoreComparison } from "./scoring";
import { ScopeAnalyzer } from "./scope";
import { transientComparisonStore, type ComparisonJudge, type ComparisonStore } from "./store";
import type { ComparisonPlan, ComparisonSummary, ComparisonWeights } from "./types";

export type CompareInput = {
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  suite: EvalSuite;
  repeat: number;
  timeoutMs: number;
  executionProfile: ExecutionProfile;
  permissions: RunnerPermissions;
  weights: ComparisonWeights;
  tieThreshold: number;
  effectiveConfig: Record<string, unknown>;
  keepWorkspaces?: boolean;
  signal?: AbortSignal;
};

export type ComparisonServiceOptions = {
  id?: () => string;
  now?: () => Date;
  judge?: ComparisonJudge;
  logger?: Logger;
  scopeAnalyzer?: ScopeAnalyzer;
  store?: ComparisonStore;
};

export class ComparisonService {
  private readonly id: () => string;
  private readonly now: () => Date;
  private readonly judge: ComparisonJudge | undefined;
  private readonly logger: Logger;
  private readonly scopeAnalyzer: ScopeAnalyzer;
  private readonly store: ComparisonStore;

  constructor(
    private readonly evaluator: EvaluationService,
    options: ComparisonServiceOptions = {},
  ) {
    this.id = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.judge = options.judge;
    this.logger = options.logger ?? silentLogger;
    this.scopeAnalyzer = options.scopeAnalyzer ?? new ScopeAnalyzer();
    this.store = options.store ?? transientComparisonStore;
  }

  async compare(input: CompareInput): Promise<ComparisonSummary> {
    const runId = this.id();
    const comparisonId = this.id();
    const createdAt = this.now().toISOString();
    this.logger.debug("comparison.run.start", {
      runId,
      comparisonId,
      snapshotAId: input.skillA.snapshot.id,
      snapshotBId: input.skillB.snapshot.id,
      suiteId: input.suite.id,
      runner: input.executionProfile.runner,
    });
    const plan: ComparisonPlan = {
      suiteId: input.suite.id,
      partition: input.suite.partition,
      repeat: input.repeat,
      timeoutMs: input.timeoutMs,
      runnerType: input.executionProfile.runner,
      executionProfile: structuredClone(input.executionProfile),
      permissions: { ...input.permissions },
      effectiveConfig: structuredClone(input.effectiveConfig),
    };
    this.store.createRun({
      id: runId,
      config: {
        snapshotAId: input.skillA.snapshot.id,
        snapshotBId: input.skillB.snapshot.id,
        plan: jsonRecord(plan),
      },
      createdAt,
    });
    this.logger.debug("comparison.run.persisted", { runId, status: "running" });

    try {
      const shared = {
        suite: input.suite,
        repeat: input.repeat,
        timeoutMs: input.timeoutMs,
        executionProfile: input.executionProfile,
        permissions: input.permissions,
        config: jsonRecord(plan),
        keepWorkspaces: input.keepWorkspaces === true,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      } as const;
      const evaluationA = await this.evaluator.evaluate({
        ...shared,
        resolvedSkill: input.skillA,
      });
      const evaluationB = await this.evaluator.evaluate({
        ...shared,
        resolvedSkill: input.skillB,
      });
      const scope = this.scopeAnalyzer.analyze(input.skillA.skill, input.skillB.skill, input.suite);
      const judgments = await this.judgeComparisons(input, evaluationA, evaluationB);
      const qualitative = qualitativeScores(judgments.map((item) => item.result));
      const scored = scoreComparison(
        evaluationA,
        evaluationB,
        input.weights,
        input.tieThreshold,
        qualitative === undefined ? {} : { outputQuality: qualitative },
      );
      const summary: ComparisonSummary = {
        comparisonId,
        runId,
        snapshotAId: input.skillA.snapshot.id,
        snapshotBId: input.skillB.snapshot.id,
        evaluationA,
        evaluationB,
        plan,
        scope,
        judgments,
        ...scored,
        createdAt,
        finishedAt: this.now().toISOString(),
      };
      this.store.complete(summary);
      this.logger.debug("comparison.run.persisted", { runId, status: "completed" });
      return summary;
    } catch (error) {
      this.store.failRun(runId, error, this.now().toISOString());
      this.logger.debug("comparison.run.persisted", {
        runId,
        status: "failed",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }

  private async judgeComparisons(
    input: CompareInput,
    evaluationA: Awaited<ReturnType<EvaluationService["evaluate"]>>,
    evaluationB: Awaited<ReturnType<EvaluationService["evaluate"]>>,
  ): Promise<ComparisonSummary["judgments"]> {
    if (this.judge === undefined) return [];
    const results: ComparisonSummary["judgments"] = [];
    for (const evalCase of input.suite.cases) {
      const attemptsA = evaluationA.attempts.filter(
        (attempt) => attempt.evalCaseId === evalCase.id,
      );
      const attemptsB = evaluationB.attempts.filter(
        (attempt) => attempt.evalCaseId === evalCase.id,
      );
      for (const assertion of evalCase.assertions) {
        if (assertion.type !== "llm-rubric") continue;
        results.push({
          evalCaseId: evalCase.id,
          rubric: assertion.rubric,
          result: await this.judge.compare({
            rubric: assertion.rubric,
            prompt: evalCase.prompt,
            candidateA: candidate(attemptsA),
            candidateB: candidate(attemptsB),
            redactions: [
              input.skillA.skill.name,
              input.skillB.skill.name,
              input.skillA.snapshot.id,
              input.skillB.snapshot.id,
              input.skillA.snapshot.fingerprint,
              input.skillB.snapshot.fingerprint,
            ],
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          }),
        });
      }
    }
    return results;
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function candidate(attempts: Awaited<ReturnType<EvaluationService["evaluate"]>>["attempts"]) {
  return {
    output: attempts
      .map((attempt) => `Repetition ${attempt.repetition}:\n${attempt.runnerResult.stdout}`)
      .join("\n\n"),
    artifacts: attempts.flatMap((attempt) =>
      attempt.runnerResult.artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        content: `sha256:${artifact.contentHash} size:${artifact.sizeBytes}`,
      })),
    ),
  };
}

function qualitativeScores(
  judgments: readonly BlindPairwiseResult[],
): readonly [number, number] | undefined {
  const usable = judgments.filter(
    (judgment) =>
      judgment.forward.status === "completed" && judgment.reverse.status === "completed",
  );
  if (usable.length === 0) return undefined;
  const scores = usable.map((judgment): readonly [number, number] => {
    if (judgment.winner === "tie") return [0.5, 0.5];
    const advantage = judgment.confidence / 2;
    return judgment.winner === "A"
      ? [0.5 + advantage, 0.5 - advantage]
      : [0.5 - advantage, 0.5 + advantage];
  });
  return [
    scores.reduce((sum, score) => sum + score[0], 0) / scores.length,
    scores.reduce((sum, score) => sum + score[1], 0) / scores.length,
  ];
}
