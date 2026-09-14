import {
  createSkillbenchResultEnvelope,
  skillbenchOperationSchema,
  type SkillbenchCommand,
} from "@skillbench/invocation-contract";
import {
  parseSkillbenchOperationResult,
  type SkillbenchOperationResultCommand,
} from "@skillbench/sdk/results";

export type CliJsonCommand = Exclude<SkillbenchCommand, "cli">;

export function renderCliJsonResult(command: CliJsonCommand, data: unknown): string {
  return `${JSON.stringify(createSkillbenchResultEnvelope(command, validatedResult(command, data)), null, 2)}\n`;
}

export function validatedResult(command: CliJsonCommand, data: unknown): unknown {
  return isOperationResultCommand(command) ? parseSkillbenchOperationResult(command, data) : data;
}

function isOperationResultCommand(
  command: CliJsonCommand,
): command is SkillbenchOperationResultCommand {
  return skillbenchOperationSchema.safeParse(command).success;
}
