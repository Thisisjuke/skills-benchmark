import type { Readable, Writable } from "node:stream";

import {
  cancel as clackCancel,
  confirm as clackConfirm,
  isCancel,
  note as clackNote,
  select as clackSelect,
  spinner as clackSpinner,
  text as clackText,
  type Option as ClackOption,
} from "@clack/prompts";

import { SkillbenchError } from "@skillbench/sdk/errors";
import type { SkillbenchConfig } from "../config";
import {
  runnerDefinition,
  runnerDefinitions,
  runnerTypeSchema,
  type RunnerChoice,
  type RunnerEffort,
  type RunnerType,
} from "../composition/runner-registry";
import type { PreflightInput } from "../application";
import { renderPreflight } from "./renderers";

export type { RunnerChoice };

export type InteractiveFlags = {
  runner?: RunnerType;
  model?: string;
  reasoningEffort?: RunnerEffort;
  input?: boolean;
  yes?: boolean;
};

export type PromptOption<Value extends string> = {
  value: Value;
  label: string;
  hint?: string;
};

export interface PromptPort {
  select<Value extends string>(input: {
    message: string;
    options: PromptOption<Value>[];
    initialValue?: Value;
  }): Promise<Value>;
  text(input: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    defaultValue?: string;
  }): Promise<string>;
  confirm(input: { message: string; initialValue?: boolean }): Promise<boolean>;
  cancel(message: string): void;
  note(message: string, title?: string): void;
  progress<Value>(message: string, task: () => Promise<Value>): Promise<Value>;
}

export type PromptSessionOptions = {
  interactive: boolean;
  yes: boolean;
  prompts: PromptPort;
  onProgress?: (message: string) => void;
};

export class PromptSession {
  constructor(private readonly options: PromptSessionOptions) {}

  get interactive(): boolean {
    return this.options.interactive;
  }

  async requiredText(value: string | undefined, label: string, message: string): Promise<string> {
    if (value !== undefined && value.trim() !== "") return value;
    if (!this.options.interactive) {
      throw new SkillbenchError(`${label} is required in non-interactive mode`, {
        code: "CLI_INPUT_REQUIRED",
      });
    }
    const answer = (await this.options.prompts.text({ message })).trim();
    if (answer === "") {
      throw new SkillbenchError(`${label} cannot be empty`, { code: "CLI_INPUT_REQUIRED" });
    }
    return answer;
  }

  async runnerChoice(config: SkillbenchConfig, flags: InteractiveFlags): Promise<RunnerChoice> {
    const hasProfileFlag = flags.model !== undefined || flags.reasoningEffort !== undefined;
    const hasOverride = flags.runner !== undefined || hasProfileFlag;
    const configuredChoice = configuredRunnerChoice(config);
    if (!hasOverride && configuredChoice !== undefined) {
      if (!this.options.interactive || this.options.yes) return configuredChoice;
      const accepted = await this.options.prompts.confirm({
        message: `Use configured runner?\n${configuredRunnerLabel(config, configuredChoice)}`,
        initialValue: true,
      });
      if (accepted) return configuredChoice;
    }
    const runner: RunnerType =
      flags.runner ??
      (hasProfileFlag
        ? config.runner.type === "mock"
          ? "codex"
          : config.runner.type
        : this.options.interactive
          ? await this.options.prompts.select<RunnerType>({
              message: "Which runner should be used?",
              options: runnerDefinitions.map((definition) => ({
                value: runnerTypeSchema.parse(definition.id),
                label: definition.label,
                hint: definition.hint,
              })),
              initialValue: config.runner.type,
            })
          : config.runner.type);
    const definition = runnerDefinition(runner);
    const configuredProfileApplies = runner === config.runner.type;

    if (definition.efforts.length === 0) {
      return definition.createChoice(flags.model, flags.reasoningEffort);
    }

    const model =
      flags.model ??
      (this.options.interactive
        ? await this.options.prompts.text({
            message: `Which ${definition.name} model should be used?`,
            ...(!configuredProfileApplies || config.runner.model === undefined
              ? {}
              : { initialValue: config.runner.model }),
            ...(definition.modelPlaceholder === undefined
              ? {}
              : {
                  placeholder: definition.modelPlaceholder,
                  defaultValue: definition.modelPlaceholder,
                }),
          })
        : configuredProfileApplies
          ? config.runner.model
          : undefined);

    const reasoningEffort =
      flags.reasoningEffort ??
      (this.options.interactive
        ? await this.options.prompts.select<RunnerEffort>({
            message: "Which reasoning effort should be used?",
            options: definition.efforts.map((value) => ({ value, label: value })),
            initialValue:
              configuredProfileApplies &&
              config.runner.reasoningEffort !== undefined &&
              definition.acceptsEffort(config.runner.reasoningEffort)
                ? config.runner.reasoningEffort
                : definition.efforts.includes("low")
                  ? "low"
                  : definition.efforts[0]!,
          })
        : configuredProfileApplies
          ? config.runner.reasoningEffort
          : undefined);
    return definition.createChoice(model, reasoningEffort);
  }

  async initializationRunnerChoice(flags: InteractiveFlags): Promise<RunnerChoice> {
    const runner: RunnerType =
      flags.runner ??
      (this.options.interactive
        ? await this.options.prompts.select<RunnerType>({
            message: "Which runner should this project use by default?",
            options: runnerDefinitions.map((definition) => ({
              value: runnerTypeSchema.parse(definition.id),
              label: definition.label,
              hint: definition.hint,
            })),
            initialValue: "mock",
          })
        : "mock");
    const definition = runnerDefinition(runner);

    if (definition.efforts.length === 0) {
      return definition.createChoice(flags.model, flags.reasoningEffort);
    }

    const model =
      flags.model ??
      (this.options.interactive
        ? await this.options.prompts.text({
            message: `Which ${definition.name} model should be the project default?`,
            ...(definition.modelPlaceholder === undefined
              ? {}
              : {
                  placeholder: definition.modelPlaceholder,
                  defaultValue: definition.modelPlaceholder,
                }),
          })
        : undefined);
    const reasoningEffort =
      flags.reasoningEffort ??
      (this.options.interactive
        ? await this.options.prompts.select<RunnerEffort>({
            message: "Which reasoning effort should be the project default?",
            options: definition.efforts.map((value) => ({ value, label: value })),
            initialValue: definition.efforts.includes("low") ? "low" : definition.efforts[0]!,
          })
        : undefined);
    return definition.createChoice(model, reasoningEffort);
  }

  async value(
    supplied: string | undefined,
    message: string,
    defaultValue: string,
  ): Promise<string> {
    if (supplied !== undefined && supplied.trim() !== "") return supplied;
    if (!this.options.interactive) return defaultValue;
    const answer = (await this.options.prompts.text({ message, initialValue: defaultValue })).trim();
    return answer === "" ? defaultValue : answer;
  }

  async count(supplied: number | undefined, message: string, defaultValue: number): Promise<number> {
    const raw =
      supplied ??
      (this.options.interactive
        ? Number(
            await this.options.prompts.text({
              message,
              initialValue: String(defaultValue),
            }),
          )
        : defaultValue);
    if (!Number.isInteger(raw) || raw < 1 || raw > 100) {
      throw new SkillbenchError("Repeat count must be an integer between 1 and 100", {
        code: "CLI_INPUT_INVALID",
      });
    }
    return raw;
  }

  async confirmInitialization(projectRoot: string, files: readonly string[]): Promise<void> {
    if (!this.options.interactive) return;
    this.options.prompts.note(
      [`Project: ${projectRoot}`, ...files.map((file) => `- ${file}`)].join("\n"),
      "Project initialization",
    );
    if (this.options.yes) return;
    const confirmed = await this.options.prompts.confirm({
      message: "Create these project files?",
      initialValue: true,
    });
    if (!confirmed) {
      this.options.prompts.cancel("Initialization cancelled.");
      throw cancelled();
    }
  }

  async confirmPreflight(input: PreflightInput): Promise<void> {
    if (!this.options.interactive) return;
    this.options.prompts.note(renderPreflight(input).join("\n"), "Preflight");
    if (this.options.yes) return;
    const confirmed = await this.options.prompts.confirm({
      message: "Start this run?",
      initialValue: true,
    });
    if (!confirmed) {
      this.options.prompts.cancel("Operation cancelled.");
      throw cancelled();
    }
  }

  async chooseSkill(paths: readonly string[]): Promise<string> {
    if (!this.options.interactive) {
      throw new SkillbenchError(
        `Multiple SKILL.md files were found (${paths.join(", ")}); pass --skill-path <path>`,
        { code: "GITHUB_SKILL_SELECTION_REQUIRED" },
      );
    }
    return this.options.prompts.select({
      message: "Which SKILL.md should be used?",
      options: paths.map((path) => ({ value: path, label: path })),
      initialValue: paths[0]!,
    });
  }

  async progress<Value>(message: string, task: () => Promise<Value>): Promise<Value> {
    this.options.onProgress?.(message);
    return this.options.interactive ? this.options.prompts.progress(message, task) : task();
  }
}

function configuredRunnerChoice(config: SkillbenchConfig): RunnerChoice | undefined {
  const definition = runnerDefinition(config.runner.type);
  if (
    definition.efforts.length > 0 &&
    (config.runner.model === undefined || config.runner.reasoningEffort === undefined)
  ) {
    return undefined;
  }
  return definition.createChoice(config.runner.model, config.runner.reasoningEffort);
}

function configuredRunnerLabel(config: SkillbenchConfig, choice: RunnerChoice): string {
  return [
    runnerDefinition(choice.runner).name,
    choice.model,
    choice.reasoningEffort,
    config.runner.sandbox,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
}

export function createClackPromptPort(input: Readable, output: Writable): PromptPort {
  const common = { input, output };
  return {
    async select<Value extends string>(options: {
      message: string;
      options: PromptOption<Value>[];
      initialValue?: Value;
    }): Promise<Value> {
      const clackOptions = {
        message: options.message,
        options: options.options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.hint === undefined ? {} : { hint: option.hint }),
        })) as ClackOption<Value>[],
        ...(options.initialValue === undefined ? {} : { initialValue: options.initialValue }),
        ...common,
      };
      return unwrap(await clackSelect(clackOptions), output);
    },
    async text(options): Promise<string> {
      return unwrap(await clackText({ ...options, ...common }), output);
    },
    async confirm(options): Promise<boolean> {
      return unwrap(await clackConfirm({ ...options, ...common }), output);
    },
    cancel(message): void {
      clackCancel(message, common);
    },
    note(message, title): void {
      clackNote(message, title, common);
    },
    async progress<Value>(message: string, task: () => Promise<Value>): Promise<Value> {
      const indicator = clackSpinner(common);
      indicator.start(message);
      try {
        const result = await task();
        indicator.stop(message);
        return result;
      } catch (error) {
        indicator.error(`${message} — failed`);
        throw error;
      }
    },
  };
}

export function interactiveEnabled(input: {
  stdinIsTTY: boolean;
  stderrIsTTY: boolean;
  json: boolean;
  inputEnabled: boolean;
}): boolean {
  return input.stdinIsTTY && input.stderrIsTTY && !input.json && input.inputEnabled;
}

export function cancelled(): SkillbenchError {
  return new SkillbenchError("Operation cancelled", { code: "CLI_CANCELLED", exitCode: 130 });
}

function unwrap<Value>(value: Value | symbol, output: Writable): Value {
  if (!isCancel(value)) return value;
  clackCancel("Operation cancelled.", { output });
  throw cancelled();
}
