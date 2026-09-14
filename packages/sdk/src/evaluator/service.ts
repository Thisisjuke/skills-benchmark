import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { toErrorMessage } from "../errors";
import { silentLogger, type Logger } from "../logging";
import {
  createRunnerPermissions,
  type ExecutionProfile,
  type RunnerPermissions,
  type RunResult,
  type Runner,
} from "../runners";
import type { ResolvedSkill } from "../skills";
import { aggregateCase, meanScore } from "./aggregate";
import { transientEvaluationStore, type AssertionEngine, type EvaluationStore } from "./store";
import type { EvalAttempt, EvalSuite, EvaluationSummary } from "./types";

export type EvaluateInput = {
  resolvedSkill: ResolvedSkill;
  suite: EvalSuite;
  repeat: number;
  timeoutMs: number;
  executionProfile: ExecutionProfile;
  config: Record<string, unknown>;
  permissions?: RunnerPermissions;
  keepWorkspaces?: boolean;
  signal?: AbortSignal;
};

export type EvaluationServiceOptions = {
  now?: () => Date;
  id?: () => string;
  workspaceParent?: string;
  logger?: Logger;
  store?: EvaluationStore;
};

export class EvaluationService {
  private readonly now: () => Date;
  private readonly id: () => string;
  private readonly workspaceParent: string;
  private readonly logger: Logger;
  private readonly store: EvaluationStore;

  constructor(
    private readonly runner: Runner,
    private readonly assertionEvaluator: AssertionEngine,
    options: EvaluationServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? (() => crypto.randomUUID());
    this.workspaceParent = options.workspaceParent ?? tmpdir();
    this.logger = options.logger ?? silentLogger;
    this.store = options.store ?? transientEvaluationStore;
  }

  async evaluate(input: EvaluateInput): Promise<EvaluationSummary> {
    const runId = this.id();
    const createdAt = this.now().toISOString();
    this.logger.debug("evaluation.run.start", {
      runId,
      snapshotId: input.resolvedSkill.snapshot.id,
      suiteId: input.suite.id,
      partition: input.suite.partition,
      repeat: input.repeat,
      runner: input.executionProfile.runner,
    });
    this.store.createRun({
      id: runId,
      config: {
        ...input.config,
        executionProfile: structuredClone(input.executionProfile),
      },
      createdAt,
    });
    this.logger.debug("evaluation.run.persisted", { runId, status: "running" });
    await mkdir(this.workspaceParent, { recursive: true });
    const workspaceRoot = await mkdtemp(join(this.workspaceParent, `skillbench-${runId}-`));
    const attempts: EvalAttempt[] = [];

    try {
      for (const evalCase of input.suite.cases) {
        input.signal?.throwIfAborted();
        const storedEvalCaseId = this.store.saveCase(input.suite.id, evalCase);
        for (let repetition = 1; repetition <= input.repeat; repetition += 1) {
          const workspacePath = join(workspaceRoot, evalCase.id, `repeat-${repetition}`);
          await mkdir(dirname(workspacePath), { recursive: true });
          let runnerResult: RunResult;
          try {
            input.signal?.throwIfAborted();
            runnerResult = await this.runner.run({
              runId,
              evalCaseId: evalCase.id,
              repetition,
              snapshot: input.resolvedSkill.snapshot,
              prompt: evalCase.prompt,
              fixtures: evalCase.fixtures,
              timeoutMs: input.timeoutMs,
              workspacePath,
              permissions: input.permissions ?? createRunnerPermissions("workspace-write"),
              executionProfile: input.executionProfile,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            });
            input.signal?.throwIfAborted();
          } catch (error) {
            if (input.signal?.aborted === true) throw error;
            runnerResult = {
              status: "failed",
              exitCode: null,
              stdout: "",
              stderr: toErrorMessage(error),
              durationMs: 0,
              artifacts: [],
            };
          }

          const assertionResults = [];
          for (const assertion of evalCase.assertions) {
            assertionResults.push(
              await this.assertionEvaluator.evaluate(assertion, {
                workspacePath,
                prompt: evalCase.prompt,
                runnerResult,
                defaultCommandTimeoutMs: input.timeoutMs,
                ...(input.signal === undefined ? {} : { signal: input.signal }),
              }),
            );
          }
          const graded = assertionResults.filter((assertion) => assertion.score !== null);
          const score =
            graded.length === 0
              ? 0
              : graded.reduce((sum, assertion) => sum + (assertion.score ?? 0), 0) / graded.length;
          const passed =
            runnerResult.status !== "timed-out" &&
            graded.length > 0 &&
            graded.every((assertion) => assertion.passed === true);
          const attempt: EvalAttempt = {
            id: this.id(),
            evalCaseId: evalCase.id,
            repetition,
            status: runnerResult.status,
            passed,
            score,
            durationMs: runnerResult.durationMs,
            runnerResult,
            assertions: assertionResults,
          };
          attempts.push(attempt);
          this.store.saveAttempt(runId, storedEvalCaseId, input.resolvedSkill.snapshot.id, attempt);
        }
      }

      const cases = input.suite.cases.map((evalCase) =>
        aggregateCase(
          evalCase.id,
          attempts.filter((attempt) => attempt.evalCaseId === evalCase.id),
        ),
      );
      const finishedAt = this.now().toISOString();
      const summary: EvaluationSummary = {
        runId,
        snapshotId: input.resolvedSkill.snapshot.id,
        suiteId: input.suite.id,
        partition: input.suite.partition,
        runnerType: input.executionProfile.runner,
        executionProfile: structuredClone(input.executionProfile),
        repeat: input.repeat,
        status: "completed",
        passRate:
          attempts.length === 0
            ? 0
            : attempts.filter((attempt) => attempt.passed).length / attempts.length,
        meanScore: meanScore(attempts),
        cases,
        attempts,
        ...(input.keepWorkspaces === true ? { workspaceRoot } : {}),
        createdAt,
        finishedAt,
      };
      this.store.completeRun(summary);
      this.logger.debug("evaluation.run.persisted", { runId, status: "completed" });
      return summary;
    } catch (error) {
      this.store.failRun(runId, error, this.now().toISOString());
      this.logger.debug("evaluation.run.persisted", {
        runId,
        status: "failed",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    } finally {
      if (input.keepWorkspaces !== true) await rm(workspaceRoot, { recursive: true, force: true });
    }
  }
}
