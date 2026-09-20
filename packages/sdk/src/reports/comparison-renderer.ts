import type { ComparisonReportPayloadV1 } from "./types";

export const COMPARISON_RENDERER_VERSION = "comparison-markdown-v2";
const MARKDOWN_HARD_BREAK = "  \n";

export function renderComparisonReport(payload: ComparisonReportPayloadV1): string {
  const { comparison, sourceA, sourceB } = payload;
  const dimensionRows = comparison.dimensions
    .map((dimension) => {
      const rowWinner = dimensionWinner(dimension.scoreA, dimension.scoreB);
      return `| ${escapeCell(dimension.label)} | ${score(dimension.scoreA)} | ${score(dimension.scoreB)} | ${rowWinner} | ${percent(dimension.effectiveWeight)} |`;
    })
    .join("\n");
  const capabilityRows = comparison.capabilityMatrix.evalCases
    .map(
      (capability) =>
        `| ${escapeCell(capability.capability)} | ${score(capability.scoreA)} | ${score(capability.scoreB)} | ${capability.winner} |`,
    )
    .join("\n");
  const judgment =
    comparison.judgments.length === 0
      ? "No qualitative rubric was evaluated."
      : comparison.judgments
          .map(
            (item) =>
              `- ${escapeCell(item.evalCaseId)} — ${item.result.winner} (${percent(item.result.confidence)} confidence): ${item.result.reasons.join(" ")}`,
          )
          .join("\n");

  return `# Skill comparison

Report schema: ${payload.schemaVersion}${MARKDOWN_HARD_BREAK}Renderer: ${COMPARISON_RENDERER_VERSION}

## Sources

### A — ${escapeText(sourceA.name)}

${sourceBlock(sourceA)}

### B — ${escapeText(sourceB.name)}

${sourceBlock(sourceB)}

## Scope compatibility

**${comparison.scope.compatibility}** (${percent(comparison.scope.confidence)} confidence)

Shared: ${list(comparison.scope.shared)}${MARKDOWN_HARD_BREAK}Specific to A: ${list(comparison.scope.specificToA)}${MARKDOWN_HARD_BREAK}Specific to B: ${list(comparison.scope.specificToB)}

${comparison.scope.reasons.join(" ")}

## Verdict

Winner: **${comparison.verdict.winner}**${MARKDOWN_HARD_BREAK}Score A: ${percent(comparison.verdict.scoreA)}${MARKDOWN_HARD_BREAK}Score B: ${percent(comparison.verdict.scoreB)}${MARKDOWN_HARD_BREAK}Tie threshold: ${percent(comparison.verdict.tieThreshold)}

${comparison.verdict.statement}

## Scores

| Dimension | A | B | Winner | Effective weight |
|---|---:|---:|:---:|---:|
${dimensionRows}

## Capability matrix

| Eval capability | A | B | Winner |
|---|---:|---:|:---:|
${capabilityRows || "| No eval cases | — | — | — |"}

## Qualitative judgments

${judgment}

## Reproducibility

- Comparison run: ${comparison.runId}
- Evaluation A: ${comparison.evaluationA.runId}
- Evaluation B: ${comparison.evaluationB.runId}
- Suite: ${comparison.plan.suiteId}
- Partition: ${comparison.plan.partition}
- Runner: ${comparison.plan.runnerType}
- Runner version: ${comparison.plan.executionProfile.runnerVersion}
${renderExecutionProfileDetails(comparison.plan.executionProfile)}- Repetitions: ${comparison.plan.repeat}
- Timeout: ${comparison.plan.timeoutMs} ms
`;
}

function renderExecutionProfileDetails(
  profile: ComparisonReportPayloadV1["comparison"]["plan"]["executionProfile"],
): string {
  const model =
    "model" in profile && typeof profile.model === "string"
      ? `- Model: ${escapeText(profile.model)}\n`
      : "";
  const effort =
    "reasoningEffort" in profile && typeof profile.reasoningEffort === "string"
      ? `- Reasoning effort: ${escapeText(profile.reasoningEffort)}\n`
      : "";
  const variant =
    "variant" in profile && typeof profile.variant === "string"
      ? `- Variant: ${escapeText(profile.variant)}\n`
      : "";
  return `${model}${effort}${variant}`;
}

function sourceBlock(source: ComparisonReportPayloadV1["sourceA"]): string {
  return [
    `Origin: ${source.origin}`,
    `Input: ${escapeText(source.originalInput)}`,
    ...(source.repository === undefined
      ? []
      : [
          `Repository: ${source.repository.owner}/${source.repository.name}`,
          `Requested ref: ${source.repository.requestedRef}`,
          `Resolved commit: ${source.repository.resolvedCommit}`,
        ]),
    `Skill root: ${escapeText(source.rootPath)}`,
    `Fingerprint: ${source.fingerprint}`,
    `Snapshot ID: ${source.snapshotId}`,
  ].join("  \n");
}

function dimensionWinner(scoreA: number | null, scoreB: number | null): string {
  if (scoreA === null || scoreB === null) return "unavailable";
  return scoreA === scoreB ? "tie" : scoreA > scoreB ? "A" : "B";
}

function score(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.map(escapeText).join(", ");
}

function escapeCell(value: string): string {
  return escapeText(value).replaceAll("|", "\\|");
}

function escapeText(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim();
}
