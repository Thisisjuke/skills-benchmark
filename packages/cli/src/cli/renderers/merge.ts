import type { MergeOperationResult } from "../../application/merge";

export function renderMergeResult(input: {
  sourceA: string;
  sourceB: string;
  evals: string;
  operation: MergeOperationResult;
}): string {
  const { result, bundle } = input.operation;
  if (!("runId" in result)) {
    return `Merge not recommended: ${result.plan.reason}${bundle === undefined ? "" : `\nBundle: ${bundle.path}`}\n`;
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
    ...(bundle === undefined
      ? ["Artifacts: not written. Save next time with: --output ./results/merge.skillbench"]
      : [`Bundle: ${bundle.path}`]),
  ].join("\n")}\n`;
}
