import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ExecutionProfile } from "@skillbench/sdk/runners";
import type { RunnerEffort, RunnerType } from "@skillbench/invocation-contract";
import type * as z from "zod";

import type { RunnerChoice } from "./types";

export function requiredModel(
  provider: string,
  model: string | undefined,
  code: string,
): string {
  if (model === undefined || model.trim() === "") {
    throw new SkillbenchError(
      `${provider} requires --model (or a model in the selected runners entry in .skillbench/config.yaml) in non-interactive mode`,
      { code },
    );
  }
  return model.trim();
}

export function requiredEffort<Schema extends z.ZodType<RunnerEffort>>(
  provider: string,
  effort: RunnerEffort | undefined,
  schema: Schema,
  code: string,
): z.output<Schema> {
  if (effort === undefined) {
    throw new SkillbenchError(
      `${provider} requires --reasoning-effort (or reasoningEffort in the selected runners entry in .skillbench/config.yaml) in non-interactive mode`,
      { code },
    );
  }
  const parsed = schema.safeParse(effort);
  if (!parsed.success) {
    throw new SkillbenchError(`Unsupported ${provider} reasoning effort: ${effort}`, {
      code: "CLI_PROFILE_CONFLICT",
    });
  }
  return parsed.data;
}

export function assertChoice<Id extends RunnerType>(
  choice: RunnerChoice,
  id: Id,
): asserts choice is Extract<RunnerChoice, { runner: Id }> {
  if (choice.runner !== id) {
    throw new SkillbenchError(`Runner choice ${choice.runner} does not match ${id}`, {
      code: "CLI_PROFILE_CONFLICT",
    });
  }
}

export function fallbackProfile(profile: ExecutionProfile): string {
  const model = "model" in profile ? profile.model : undefined;
  return `${profile.runner} ${profile.runnerVersion}${model === undefined ? "" : `, ${model}`}`;
}

export function fallbackConfig(
  profile: ExecutionProfile,
): Readonly<Record<string, unknown>> {
  const { runner, ...settings } = profile;
  return { type: runner, settings };
}
