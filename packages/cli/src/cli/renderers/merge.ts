import type { MergeOperationResult } from "../../application/merge";

export function renderMergeResult(input: {
  sourceA: string;
  sourceB: string;
  evals: string;
  operation: MergeOperationResult;
}): string {
  const { result, bundle } = input.operation;
  if (!("runId" in result)) {
    return `${[
      "No merged skill was generated.",
      result.plan.reason,
      `Comparison: ${result.comparisonReused ? "reused" : "created"}`,
      "Next: keep the skills separate, narrow them to a shared responsibility, or add evals for a shared task.",
      ...(bundle === undefined ? [] : [`Report: ${bundle.reportPath}`, `Bundle: ${bundle.path}`]),
    ].join("\n")}\n`;
  }
  return `${[
    "Merge complete",
    `Source A: ${input.sourceA}`,
    `Source B: ${input.sourceB}`,
    `Eval suite: ${input.evals}`,
    `Comparison: ${result.comparisonReused ? "reused" : "created"}`,
    ...result.candidates.map(
      (candidate) =>
        `${candidate.name}: ${candidate.strategy} (${candidate.files.length} files)`,
    ),
    ...(result.holdoutValidation === undefined
      ? []
      : [
          `Holdout verdict: ${result.holdoutValidation.verdict.status}`,
          `Winner: ${result.holdoutValidation.verdict.winnerId}`,
          `Reason: ${result.holdoutValidation.verdict.reason}`,
        ]),
    ...(bundle === undefined ? [] : [`Report: ${bundle.reportPath}`, `Bundle: ${bundle.path}`]),
  ].join("\n")}\n`;
}
