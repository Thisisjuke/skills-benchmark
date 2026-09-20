import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

import { parseDocument } from "yaml";

import { SkillbenchError } from "@skillbench/sdk/errors";
import { runnerDefinition, type RunnerChoice } from "../composition/runner-registry";
import {
  configuredRunnerSchema,
  type ConfiguredRunner,
  type SkillbenchConfig,
} from "./schema";

export type RunnerSelection = {
  choice: RunnerChoice;
  configuration: ConfiguredRunner;
};

export function selectionForConfiguredRunner(configuration: ConfiguredRunner): RunnerSelection {
  return {
    choice: runnerDefinition(configuration.type).createChoice(
      configuration.model,
      configuration.reasoningEffort,
      configuration.variant,
    ),
    configuration,
  };
}

export function configuredRunnerForChoice(choice: RunnerChoice): ConfiguredRunner {
  return configuredRunnerSchema.parse({
    type: choice.runner,
    executable: runnerDefinition(choice.runner).defaultExecutable,
    ...(choice.model === undefined ? {} : { model: choice.model }),
    ...(choice.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: choice.reasoningEffort }),
    ...("variant" in choice && choice.variant !== undefined
      ? { variant: choice.variant }
      : {}),
    sandbox: "workspace-write",
    maxOutputBytes: 1024 * 1024,
  });
}

export function selectionForChoice(
  config: SkillbenchConfig,
  choice: RunnerChoice,
): RunnerSelection {
  const matching = config.runners.find((configuration) =>
    choicesEqual(selectionForConfiguredRunner(configuration).choice, choice),
  );
  return {
    choice,
    configuration:
      matching ??
      config.runners.find((configuration) => configuration.type === choice.runner) ??
      configuredRunnerForChoice(choice),
  };
}

export function formatConfiguredRunner(configuration: ConfiguredRunner): string {
  const choice = selectionForConfiguredRunner(configuration).choice;
  return [
    runnerDefinition(choice.runner).name,
    choice.model ?? (choice.runner === "opencode" ? "OpenCode default" : undefined),
    choice.reasoningEffort,
    "variant" in choice && choice.variant !== undefined ? `variant ${choice.variant}` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
}

export function addConfiguredRunner(
  configFile: string,
  configuration: ConfiguredRunner,
): void {
  const normalized = configuredRunnerSchema.parse(configuration);
  const source = readFileSync(configFile, "utf8");
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new SkillbenchError(
      `Cannot update runners in ${configFile}: ${document.errors.map((error) => error.message).join("; ")}`,
      { code: "CONFIG_PARSE_ERROR" },
    );
  }
  const value = document.toJS() as { runners?: unknown } | null;
  if (!Array.isArray(value?.runners)) {
    throw new SkillbenchError(
      `Cannot add a runner to ${configFile}: migrate the configuration to the runners list first`,
      { code: "CONFIG_MIGRATION_REQUIRED" },
    );
  }
  const runners = value.runners.map((runner) => configuredRunnerSchema.parse(runner));
  if (runners.some((runner) => JSON.stringify(runner) === JSON.stringify(normalized))) return;

  document.addIn(["runners"], normalized);
  const temporary = `${configFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, document.toString(), {
    encoding: "utf8",
    mode: statSync(configFile).mode,
  });
  renameSync(temporary, configFile);
}

function choicesEqual(left: RunnerChoice, right: RunnerChoice): boolean {
  return (
    left.runner === right.runner &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort &&
    ("variant" in left ? left.variant : undefined) ===
      ("variant" in right ? right.variant : undefined)
  );
}
