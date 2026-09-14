import { join } from "node:path";

import type { CompareOperationResult } from "../../application/compare";
import { executionProfileLabel } from "../runner-label";

export function renderCompareResult(input: {
  sourceA: string;
  sourceB: string;
  evals: string;
  operation: CompareOperationResult;
}): string {
  const { result, bundle } = input.operation;
  return `${[
    "Comparison complete",
    `Source A: ${input.sourceA}`,
    `Source B: ${input.sourceB}`,
    `Eval suite: ${input.evals}`,
    `Runner: ${executionProfileLabel(result.plan.executionProfile)}`,
    `Scope compatibility: ${result.scope.compatibility} (${(result.scope.confidence * 100).toFixed(0)}%)`,
    `Score A: ${(result.verdict.scoreA * 100).toFixed(1)}%`,
    `Score B: ${(result.verdict.scoreB * 100).toFixed(1)}%`,
    `Winner: ${result.verdict.winner}`,
    ...(bundle === undefined
      ? ["Artifacts: not written. Save next time with: --output ./results/comparison.skillbench"]
      : [
          `Bundle: ${bundle.path}`,
          ...(result.report === undefined ? [] : [`Reports: ${join(bundle.path, "reports")}`]),
        ]),
  ].join("\n")}\n`;
}
