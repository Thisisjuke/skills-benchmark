import type { InspectResult } from "../inspect";
import type { EvaluationSummary } from "../evaluator";
import type { MergeResult } from "../results";

export type InspectBundleReportInput = {
  result: InspectResult;
  metadata: Readonly<Record<string, unknown>>;
  warnings?: readonly string[];
};

export function renderInspectBundleReport(input: InspectBundleReportInput): string {
  const { result } = input;
  const repository =
    result.repository === undefined
      ? "Not applicable (local source)"
      : `${result.repository.owner}/${result.repository.name} at ${result.repository.resolvedCommit}`;
  const metadata = Object.keys(input.metadata).length === 0
    ? "No custom metadata."
    : `\`\`\`json\n${JSON.stringify(input.metadata, null, 2)}\n\`\`\``;
  const warnings = input.warnings ?? [];

  return `# Skill inspection

## Summary

- Name: ${inline(result.name)}
- Description: ${inline(result.description)}
- Origin: ${result.origin.type} (${inline(result.origin.originalInput)})
- Resolved repository: ${inline(repository)}
- Skill root: ${inline(result.rootPath)}
- Snapshot: ${inline(result.snapshotId)}
- Fingerprint: ${result.fingerprint} (${result.fingerprintAlgorithm})
- Files: ${result.files.length}

## Metadata

${metadata}

## Files

${result.files.map((file) => `- \`${inline(file.relativePath)}\` — ${file.sizeBytes} bytes — \`${file.contentHash}\``).join("\n") || "No files."}

## Warnings

${warnings.map((warning) => `- ${inline(warning)}`).join("\n") || "No warnings."}

## Next action

Review the files under \`sources/skill/\`, then run an evaluation or comparison with an eval suite that represents the tasks this skill should solve.
`;
}

export function renderEvaluationBundleReport(result: EvaluationSummary): string {
  const failed = result.cases.filter((item) => item.passRate < 1);
  return `# Skill evaluation

## Summary

- Status: ${result.status}
- Partition: ${result.partition}
- Pass rate: ${percent(result.passRate)}
- Mean score: ${percent(result.meanScore)}
- Cases: ${result.cases.length}
- Attempts: ${result.attempts.length}
- Runner: ${result.runnerType}
- Repetitions: ${result.repeat}

## Cases

| Case | Pass rate | Mean score | Attempts |
|---|---:|---:|---:|
${result.cases.map((item) => `| ${cell(item.evalCaseId)} | ${percent(item.passRate)} | ${percent(item.meanScore)} | ${item.completedAttempts}/${item.attempts} |`).join("\n") || "| No cases | — | — | — |"}

## Next action

${failed.length === 0 ? "All cases passed. Compare this skill with an alternative, or validate it against a holdout suite." : `Review the failed or inconsistent cases (${failed.map((item) => `\`${inline(item.evalCaseId)}\``).join(", ")}) and inspect their assertion evidence in \`result.json\`.`}
`;
}

export function renderMergeBundleReport(result: MergeResult): string {
  const comparison = result.comparisonReused ? "Reused an existing compatible comparison." : "Created a new development comparison.";
  const scope = `Compatibility: **${result.scope.compatibility}** (${percent(result.scope.confidence)} confidence)\n\nShared task categories: ${list(result.scope.shared)}  \nSpecific to A: ${list(result.scope.specificToA)}  \nSpecific to B: ${list(result.scope.specificToB)}`;

  if (!("runId" in result)) {
    return `# Merge result

## Outcome

No merged skill was generated because the two sources address different task categories, so a single universal skill would not have reliable shared evidence.

${comparison}

## Scope compatibility

${scope}

## Next actions

- Keep and evaluate the skills separately when their responsibilities are intentionally different.
- Narrow both skills to a shared responsibility, or add development eval cases that exercise a genuinely shared task, then rerun \`skillbench merge\`.
- Use \`skillbench compare\` when the goal is only to understand their relative strengths.
`;
  }

  const entries = new Map(result.tournament.entries.map((entry) => [entry.id, entry]));
  const recommended = result.tournament.selectedCandidateIds[0];
  const finalCandidate =
    result.holdoutValidation?.verdict.status === "ACCEPTED" &&
    result.holdoutValidation.verdict.winnerKind === "candidate"
      ? result.holdoutValidation.verdict.winnerId
      : undefined;
  const holdout = result.holdoutValidation === undefined
    ? "Not run. `artifacts/final/` was not created."
    : `${result.holdoutValidation.verdict.status}: ${inline(result.holdoutValidation.verdict.reason)}`;

  return `# Merge result

## Outcome

${comparison}

${recommended === undefined ? "No development candidate was selected." : `Development recommendation: \`${inline(recommended)}\`, available in \`artifacts/recommended/\`.`}

${finalCandidate === undefined ? "No final merged skill was produced." : `Holdout-approved final skill: \`${inline(finalCandidate)}\`, available in \`artifacts/final/\`.`}

## Scope compatibility

${scope}

## Candidates

| Candidate | Strategy | Development score | Files | Location |
|---|---|---:|---:|---|
${result.candidates.map((candidate) => {
    const entry = entries.get(candidate.id);
    return `| ${cell(candidate.name)} (\`${inline(candidate.id)}\`) | ${candidate.strategy} | ${entry === undefined ? "—" : percent(entry.score)} | ${candidate.files.length} | \`artifacts/candidates/${artifactSegment(candidate.id)}/\` |`;
  }).join("\n")}

## Holdout validation

${holdout}

## Next action

${result.holdoutValidation === undefined ? "Review `artifacts/recommended/`, then rerun the merge with `--holdout <path>` before treating it as final." : finalCandidate === undefined ? "Keep the best parent and review the holdout evidence in `result.json`; the candidate was not promoted to final." : "Review and use `artifacts/final/`; it is the candidate that passed the holdout gate."}
`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.map((value) => `\`${inline(value)}\``).join(", ");
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").replaceAll("`", "\\`").trim();
}

function cell(value: string): string {
  return inline(value).replaceAll("|", "\\|");
}

function artifactSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}
