import type { EvalOperationResult } from "../../application/eval";
import { executionProfileLabel } from "../runner-label";

export function renderEvalResult(input: {
  source: string;
  evals: string;
  operation: EvalOperationResult;
}): string {
  const { result, bundle } = input.operation;
  return `${[
    "Evaluation complete",
    `Source: ${input.source}`,
    `Eval suite: ${input.evals}`,
    `Runner: ${executionProfileLabel(result.executionProfile)}`,
    `Partition: ${result.partition}`,
    `Attempts: ${result.attempts.length}`,
    `Pass rate: ${(result.passRate * 100).toFixed(1)}%`,
    `Mean score: ${(result.meanScore * 100).toFixed(1)}%`,
    ...(result.workspaceRoot === undefined ? [] : [`Workspaces: ${result.workspaceRoot}`]),
    ...(bundle === undefined
      ? ["Artifacts: not written. Save next time with: --output ./results/evaluation.skillbench"]
      : [`Bundle: ${bundle.path}`]),
  ].join("\n")}\n`;
}
