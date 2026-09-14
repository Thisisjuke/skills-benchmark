import type { InspectOperationResult } from "../../application/inspect";

export function renderInspectResult(input: {
  source: string;
  operation: InspectOperationResult;
}): string {
  const { result, bundle } = input.operation;
  return `${[
    "Skill inspection complete",
    `Name: ${result.name}`,
    `Description: ${result.description}`,
    `Input: ${input.source}`,
    `Origin: ${providerLabel(result.origin.type)}`,
    ...(result.repository === undefined
      ? []
      : [
          `Repository: ${result.repository.owner}/${result.repository.name}`,
          `Requested ref: ${result.repository.requestedRef}`,
          `Resolved commit: ${result.repository.resolvedCommit.slice(0, 12)}`,
        ]),
    `Files: ${result.files.length}`,
    ...(bundle === undefined
      ? ["Artifacts: not written. Save next time with: --output ./results/inspection.skillbench"]
      : [`Bundle: ${bundle.path}`]),
  ].join("\n")}\n`;
}

function providerLabel(provider: string): string {
  if (provider === "github") return "GitHub";
  if (provider === "local") return "Local";
  return provider;
}
