import type { AssertionResult, EvalAssertion } from "../evaluator";
import type { RunResult } from "../runners";

export type RubricInput = {
  rubric: string;
  prompt: string;
  workspacePath: string;
  runnerResult: RunResult;
  signal?: AbortSignal;
};

export type RubricResult = {
  passed: boolean;
  score: number;
  message: string;
  evidence?: Record<string, unknown>;
};

export interface RubricEvaluator {
  evaluate(input: RubricInput): Promise<RubricResult>;
}

export type AssertionContext = {
  workspacePath: string;
  prompt: string;
  runnerResult: RunResult;
  defaultCommandTimeoutMs: number;
  signal?: AbortSignal;
};

export type AssertionHandler<Type extends EvalAssertion["type"] = EvalAssertion["type"]> = (
  assertion: Extract<EvalAssertion, { type: Type }>,
  context: AssertionContext,
) => Promise<AssertionResult>;

export type AssertionHandlers = Partial<{
  [Type in EvalAssertion["type"]]: AssertionHandler<Type>;
}>;

export type AssertionEvaluatorOptions = {
  rubricEvaluator?: RubricEvaluator;
  handlers?: AssertionHandlers;
};
