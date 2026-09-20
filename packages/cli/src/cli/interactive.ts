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
import {
  configuredRunnerForChoice,
  formatConfiguredRunner,
  selectionForChoice,
  selectionForConfiguredRunner,
  type ConfiguredRunner,
  type RunnerSelection,
  type SkillbenchConfig,
} from "../config";
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

export type { RunnerChoice, RunnerSelection };

export type InteractiveFlags = {
  runner?: RunnerType;
  model?: string;
  reasoningEffort?: RunnerEffort;
  variant?: string;
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
  progress<Value>(
    message: string,
    task: (update: (message: string) => void) => Promise<Value>,
  ): Promise<Value>;
}

export type PromptSessionOptions = {
  interactive: boolean;
  yes: boolean;
  prompts: PromptPort;
  onProgress?: (message: string) => void;
  onStatus?: (message: string, current?: number, total?: number) => void;
};

export type RunnerChoiceOptions = {
  onRunnerAdded?: (runner: ConfiguredRunner) => void | Promise<void>;
};

const ADD_RUNNER = "__skillbench_add_runner__";

export class PromptSession {
  private updateActiveProgress: ((message: string) => void) | undefined;

  constructor(private readonly options: PromptSessionOptions) {}

  get interactive(): boolean {
    return this.options.interactive;
  }

  async requiredText(value: string | undefined, label: string, message: string): Promise<string> {
    if (value !== undefined && value.trim() !== "") return value.trim();
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

  async runnerChoice(
    config: SkillbenchConfig,
    flags: InteractiveFlags,
    options: RunnerChoiceOptions = {},
  ): Promise<RunnerSelection> {
    const hasProfileFlag =
      flags.model !== undefined ||
      flags.reasoningEffort !== undefined ||
      flags.variant !== undefined;
    const hasOverride = flags.runner !== undefined || hasProfileFlag;
    if (!hasOverride) {
      const defaultRunner = config.runners[0]!;
      if (!this.options.interactive) return selectionForConfiguredRunner(defaultRunner);

      const useDefault = await this.options.prompts.confirm({
        message: `Use the default runner?\n${formatConfiguredRunner(defaultRunner)}`,
        initialValue: true,
      });
      if (useDefault) return selectionForConfiguredRunner(defaultRunner);

      const selected = await this.options.prompts.select<string>({
        message: "Which configured runner should be used?",
        options: [
          ...config.runners.map((runner, index) => ({
            value: String(index),
            label: formatConfiguredRunner(runner),
          })),
          { value: ADD_RUNNER, label: "Add a runner" },
        ],
        initialValue: "0",
      });
      if (selected !== ADD_RUNNER) {
        return selectionForConfiguredRunner(config.runners[Number(selected)]!);
      }

      const choice = await this.configureRunner(
        await this.chooseRunner("Which runner should be added?", defaultRunner.type),
        {},
        false,
      );
      const configuration = configuredRunnerForChoice(choice);
      await options.onRunnerAdded?.(configuration);
      return { choice, configuration };
    }

    const defaultRunner = config.runners[0]!;
    const runner: RunnerType =
      flags.runner ??
      (hasProfileFlag
        ? defaultRunner.type === "mock"
          ? "codex"
          : defaultRunner.type
        : defaultRunner.type);
    return selectionForChoice(config, await this.configureRunner(runner, flags, false));
  }

  async initializationRunnerChoice(flags: InteractiveFlags): Promise<RunnerChoice> {
    const runner =
      flags.runner ??
      (this.options.interactive
        ? await this.chooseRunner("Which runner should this project use by default?", "mock")
        : "mock");
    return this.configureRunner(runner, flags, true);
  }

  private async chooseRunner(message: string, initialValue: RunnerType): Promise<RunnerType> {
    return this.options.prompts.select<RunnerType>({
      message,
      options: runnerDefinitions.map((definition) => ({
        value: runnerTypeSchema.parse(definition.id),
        label: definition.label,
        hint: definition.hint,
      })),
      initialValue,
    });
  }

  private async configureRunner(
    runner: RunnerType,
    flags: InteractiveFlags,
    projectDefault: boolean,
  ): Promise<RunnerChoice> {
    const definition = runnerDefinition(runner);

    const model =
      flags.model ??
      (definition.supportsModel && this.options.interactive
        ? await this.enterModel(runner)
        : undefined);
    const reasoningEffort =
      flags.reasoningEffort ??
      (definition.efforts.length > 0 && this.options.interactive
        ? await this.options.prompts.select<RunnerEffort>({
            message: projectDefault
              ? "Which reasoning effort should be the project default?"
              : "Which reasoning effort should be used?",
            options: definition.efforts.map((value) => ({ value, label: value })),
            initialValue: definition.efforts.includes("low") ? "low" : definition.efforts[0]!,
          })
        : undefined);
    const variant =
      flags.variant ??
      (definition.acceptsVariant && this.options.interactive
        ? (await this.options.prompts.text({
            message: projectDefault
              ? "Which OpenCode variant should be the project default? (optional)"
              : "Which OpenCode variant should be used? (optional)",
          })).trim() || undefined
        : undefined);
    return definition.createChoice(model, reasoningEffort, variant);
  }

  private async enterModel(runner: RunnerType): Promise<string | undefined> {
    const definition = runnerDefinition(runner);
    if (!definition.supportsModel || runner === "mock") return undefined;

    if (runner === "opencode") {
      const chooseModel = await this.options.prompts.confirm({
        message: "Choose an OpenCode model explicitly?",
        initialValue: false,
      });
      if (!chooseModel) return undefined;
    }

    const model = (
      await this.options.prompts.text({
        message: `Enter a model identifier for ${definition.name}`,
        ...(definition.modelPlaceholder === undefined
          ? {}
          : {
              placeholder: definition.modelPlaceholder,
              defaultValue: definition.modelPlaceholder,
            }),
      })
    ).trim();
    if (model === "") {
      throw new SkillbenchError(`${definition.name} model cannot be empty`, {
        code: "CLI_INPUT_REQUIRED",
      });
    }
    return model;
  }

  async value(
    supplied: string | undefined,
    message: string,
    defaultValue: string,
  ): Promise<string> {
    if (supplied !== undefined && supplied.trim() !== "") return supplied.trim();
    if (!this.options.interactive) return defaultValue;
    const answer = (await this.options.prompts.text({ message, initialValue: defaultValue })).trim();
    return answer === "" ? defaultValue : answer;
  }

  async choose<Value extends string>(
    message: string,
    options: PromptOption<Value>[],
    initialValue?: Value,
  ): Promise<Value> {
    if (!this.options.interactive) {
      throw new SkillbenchError("A choice was requested in non-interactive mode", {
        code: "CLI_INPUT_REQUIRED",
      });
    }
    return this.options.prompts.select({
      message,
      options,
      ...(initialValue === undefined ? {} : { initialValue }),
    });
  }

  notice(message: string, title?: string): void {
    if (this.options.interactive) this.options.prompts.note(message, title);
  }

  status(message: string, current?: number, total?: number): void {
    this.options.onStatus?.(message, current, total);
    this.updateActiveProgress?.(progressStatus(message, current, total));
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
    if (!this.options.interactive) return task();
    return this.options.prompts.progress(message, async (update) => {
      this.updateActiveProgress = update;
      try {
        return await task();
      } finally {
        this.updateActiveProgress = undefined;
      }
    });
  }
}

function progressStatus(message: string, current?: number, total?: number): string {
  return current === undefined || total === undefined ? message : `[${current}/${total}] ${message}`;
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
    async progress<Value>(
      message: string,
      task: (update: (message: string) => void) => Promise<Value>,
    ): Promise<Value> {
      const indicator = clackSpinner(common);
      indicator.start(message);
      try {
        const result = await task((nextMessage) => indicator.message(nextMessage));
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
