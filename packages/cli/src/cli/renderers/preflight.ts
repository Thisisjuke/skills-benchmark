import { estimateModelCalls, type PreflightInput } from "../../application/preflight";
import { formatExecutionSelection } from "../../composition/runner-registry";

export function renderPreflight(input: PreflightInput): string[] {
  return [
    `Command: ${input.operation}`,
    ...input.skills.flatMap((skill, index) => [
      `Source ${String.fromCharCode(65 + index)}: ${skill.skill.name} (${skill.snapshot.origin.type})`,
      `  Input: ${skill.snapshot.origin.originalInput}`,
      `  Fingerprint: ${shortIdentifier(skill.snapshot.fingerprint)}`,
      ...(skill.snapshot.repository === undefined
        ? []
        : [`  Commit: ${shortIdentifier(skill.snapshot.repository.resolvedCommit)}`]),
    ]),
    `Eval suite: ${input.suiteInput}`,
    `  Partition: ${input.suite.partition}`,
    `  Cases: ${input.suite.cases.length}`,
    `  ID: ${shortIdentifier(input.suite.id)}`,
    `Repeats: ${input.repeat}`,
    `Runner: ${formatExecutionSelection(input.executionProfile)}`,
    ...(input.instructionAssets ?? []).map(
      (asset) => `Instruction: ${asset.path} (${shortIdentifier(asset.contentHash)})`,
    ),
    `Estimated model calls: ${estimateModelCalls(input)}`,
    `Result bundle: ${input.output ?? "not saved"}`,
    ...(input.holdoutRequested === true && input.holdoutSuite === undefined
      ? ["Holdout: additional finalist calls are not included in this estimate"]
      : []),
  ];
}

function shortIdentifier(value: string): string {
  return value.slice(0, 12);
}
