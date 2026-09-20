import { Command, InvalidArgumentError, Option } from "commander";

import type { EvalPartition } from "@skillbench/sdk/evaluator";
import { SkillbenchError } from "@skillbench/sdk/errors";
import {
  RUNNER_EFFORTS,
  RUNNER_IDS,
  runnerEffortSchema,
  runnerTypeSchema,
  type RunnerEffort,
  type RunnerType,
} from "../composition/runner-registry";
import type { ResolveOptions } from "@skillbench/sdk/sources";
import type { PromptSession } from "./interactive";
import type { RunOutputOptions } from "./run-output";

export type GlobalOptions = {
  config?: string;
  debug?: boolean;
  input?: boolean;
  history?: boolean;
  jsonl?: boolean;
  model?: string;
  offline?: boolean;
  reasoningEffort?: RunnerEffort;
  runner?: RunnerType;
  yes?: boolean;
};

export function getGlobalOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

export function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError("must be an integer between 1 and 100");
  }
  return parsed;
}

export function nonEmptyString(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new InvalidArgumentError("must not be empty");
  return trimmed;
}

export function partition(value: string): EvalPartition {
  if (value !== "development" && value !== "holdout") {
    throw new InvalidArgumentError("must be development or holdout");
  }
  return value;
}

export function runnerType(value: string): RunnerType {
  const parsed = runnerTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(`must be ${RUNNER_IDS.join(", ")}`);
  }
  return parsed.data;
}

export function reasoningEffort(value: string): RunnerEffort {
  const parsed = runnerEffortSchema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidArgumentError(`must be ${RUNNER_EFFORTS.join(", ")}`);
  }
  return parsed.data;
}

export function globalArguments(
  options: GlobalOptions,
  settings: { includeProfile?: boolean } = {},
): string[] {
  const includeProfile = settings.includeProfile !== false;
  return [
    ...(options.config === undefined ? [] : ["--config", options.config]),
    ...(options.debug === true ? ["--debug"] : []),
    ...(options.offline === true ? ["--offline"] : []),
    ...(!includeProfile || options.runner === undefined ? [] : ["--runner", options.runner]),
    ...(!includeProfile || options.model === undefined ? [] : ["--model", options.model]),
    ...(!includeProfile || options.reasoningEffort === undefined
      ? []
      : ["--reasoning-effort", options.reasoningEffort]),
    ...(options.input === false ? ["--no-input"] : []),
    ...(options.history === false ? ["--no-history"] : []),
    ...(options.jsonl === true ? ["--jsonl"] : []),
    ...(options.yes === true ? ["--yes"] : []),
  ];
}

export function sourceResolveOptions(
  command: Command,
  session: PromptSession,
  skillPath?: string,
): ResolveOptions {
  const options = getGlobalOptions(command);
  return {
    offline: options.offline === true,
    ...(skillPath === undefined ? {} : { skillPath: skillPath.trim() }),
    selectSkill: (paths) => session.chooseSkill(paths),
  };
}

class NoOutputOption extends Option {
  override attributeName(): string {
    return "outputEnabled";
  }
}

export function noOutputOption(): Option {
  return new NoOutputOption("--no-output", "do not save an automatic result bundle");
}

export function validateOutputOptions(options: RunOutputOptions): void {
  if (options.outputEnabled === false && options.output !== undefined) {
    throw new SkillbenchError("--no-output cannot be used with --output <directory>", {
      code: "CLI_OUTPUT_CONFLICT",
    });
  }
  if (options.outputEnabled === false && options.force === true) {
    throw new SkillbenchError("--no-output cannot be used with --force", {
      code: "CLI_OUTPUT_CONFLICT",
    });
  }
  if (options.force === true && options.output === undefined) {
    throw new SkillbenchError("--force requires --output <directory>", {
      code: "CLI_OUTPUT_REQUIRED",
    });
  }
}

export function validateOutputMode(json: boolean, jsonl: boolean): void {
  if (json && jsonl) {
    throw new SkillbenchError("--json and --jsonl cannot be used together", {
      code: "CLI_OUTPUT_CONFLICT",
    });
  }
}
