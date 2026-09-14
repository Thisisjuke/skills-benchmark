import type { RunResult } from "../runners";
import type {
  AssertionResult,
  EvalAssertion,
  EvalAttempt,
  EvalCase,
  EvaluationSummary,
} from "./types";

export type EvaluationAssertionContext = {
  workspacePath: string;
  prompt: string;
  runnerResult: RunResult;
  defaultCommandTimeoutMs: number;
  signal?: AbortSignal;
};

export interface AssertionEngine {
  evaluate(assertion: EvalAssertion, context: EvaluationAssertionContext): Promise<AssertionResult>;
}

export type EvaluationAssertionEngine = AssertionEngine;

export type CreateEvaluationRunInput = {
  id: string;
  config: Record<string, unknown>;
  createdAt: string;
};

export interface EvaluationStore {
  createRun(input: CreateEvaluationRunInput): void;
  saveCase(suiteId: string, evalCase: EvalCase): string;
  saveAttempt(
    runId: string,
    storedEvalCaseId: string,
    snapshotId: string,
    attempt: EvalAttempt,
  ): void;
  completeRun(summary: EvaluationSummary): void;
  failRun(runId: string, error: unknown, finishedAt: string): void;
}

export const transientEvaluationStore: EvaluationStore = Object.freeze({
  createRun: () => undefined,
  saveCase: (_suiteId: string, evalCase: EvalCase) => evalCase.id,
  saveAttempt: () => undefined,
  completeRun: () => undefined,
  failRun: () => undefined,
});
