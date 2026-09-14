import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ExecutionProfile } from "@skillbench/sdk/runners";

import { runnerDefinitions } from "./definitions";
import { fallbackConfig, fallbackProfile } from "./profile";
import type { RunnerDefinition } from "./types";

export type RunnerRegistry = ReturnType<typeof createRunnerRegistry>;

export function createRunnerRegistry(definitions: readonly RunnerDefinition[]) {
  const registered = Object.freeze([...definitions]);
  const ids = registered.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) {
    throw new SkillbenchError("Runner registry identifiers must be unique", {
      code: "CLI_RUNNER_REGISTRY_INVALID",
    });
  }
  return Object.freeze({
    definitions: registered,
    definition(id: string): RunnerDefinition {
      const definition = registered.find((candidate) => candidate.id === id);
      if (definition === undefined) {
        throw new SkillbenchError(`Unsupported runner: ${id}`, {
          code: "CLI_RUNNER_UNSUPPORTED",
        });
      }
      return definition;
    },
    definitionForProfile(profile: ExecutionProfile): RunnerDefinition | undefined {
      return registered.find((definition) => definition.matches(profile));
    },
  });
}

export const defaultRunnerRegistry = createRunnerRegistry(runnerDefinitions);

export function runnerDefinition(id: string): RunnerDefinition {
  return defaultRunnerRegistry.definition(id);
}

export function definitionForProfile(
  profile: ExecutionProfile,
): RunnerDefinition | undefined {
  return defaultRunnerRegistry.definitionForProfile(profile);
}

export function formatExecutionProfile(profile: ExecutionProfile): string {
  return definitionForProfile(profile)?.formatProfile(profile) ?? fallbackProfile(profile);
}

export function formatExecutionSelection(profile: ExecutionProfile): string {
  const definition = definitionForProfile(profile);
  const configuration = definition?.profileConfig(profile) ?? fallbackConfig(profile);
  const model = typeof configuration.model === "string" ? configuration.model : undefined;
  const effort =
    typeof configuration.reasoningEffort === "string"
      ? configuration.reasoningEffort
      : typeof configuration.effort === "string"
        ? configuration.effort
        : undefined;
  return [
    definition?.name ?? profile.runner,
    model,
    effort === undefined ? undefined : `${effort} effort`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
}

export function profileConfiguration(
  profile: ExecutionProfile,
): Readonly<Record<string, unknown>> {
  return definitionForProfile(profile)?.profileConfig(profile) ?? fallbackConfig(profile);
}

export function profileIncursModelCalls(profile: ExecutionProfile): boolean {
  return definitionForProfile(profile)?.capabilities.incursModelCalls ?? true;
}
