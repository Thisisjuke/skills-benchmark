import {
  ClaudeRunner,
  claudeEffortSchema,
  createClaudeExecutionProfile,
  isClaudeExecutionProfile,
} from "@skillbench/runner-claude";
import {
  CodexRunner,
  createCodexExecutionProfile,
  isCodexExecutionProfile,
  reasoningEffortSchema as codexEffortSchema,
} from "@skillbench/runner-codex";
import {
  createOpenCodeExecutionProfile,
  isOpenCodeExecutionProfile,
  openCodeModelSchema,
  OpenCodeRunner,
} from "@skillbench/runner-opencode";
import { SkillbenchError } from "@skillbench/sdk/errors";
import { MOCK_EXECUTION_PROFILE, MockRunner } from "@skillbench/sdk/runners";

import {
  assertChoice,
  fallbackConfig,
  fallbackProfile,
  requiredEffort,
  requiredModel,
} from "./profile";
import type { RunnerDefinition } from "./types";

const mockDefinition: RunnerDefinition = {
  id: "mock",
  name: "Mock",
  label: "Tooling — Mock runner",
  hint: "Validate the toolchain without model costs",
  capabilities: {
    incursModelCalls: false,
    comparisonJudge: false,
  },
  defaultExecutable: "mock",
  supportsModel: false,
  requiresModel: false,
  efforts: [],
  acceptsEffort: () => false,
  acceptsVariant: false,
  createChoice(model, effort, variant) {
    if (model !== undefined || effort !== undefined || variant !== undefined) {
      throw new SkillbenchError(
        "--model, --reasoning-effort and --variant require a compatible model runner",
        { code: "CLI_PROFILE_CONFLICT" },
      );
    }
    return { runner: "mock" };
  },
  async create(options, choice) {
    assertChoice(choice, "mock");
    return {
      runner: new MockRunner(undefined, undefined, options.logger),
      executionProfile: MOCK_EXECUTION_PROFILE,
    };
  },
  matches: (profile) => profile.runner === "mock",
  formatProfile: (profile) => `mock (${profile.runnerVersion})`,
  profileConfig: () => ({ type: "mock" }),
};

const codexDefinition: RunnerDefinition = {
  id: "codex",
  name: "Codex",
  label: "Codex",
  hint: "Uses paid model calls",
  capabilities: {
    incursModelCalls: true,
    comparisonJudge: true,
  },
  defaultExecutable: "codex",
  supportsModel: true,
  requiresModel: true,
  modelPlaceholder: "gpt-5.6-luna",
  efforts: codexEffortSchema.options,
  acceptsEffort: (value) => codexEffortSchema.safeParse(value).success,
  acceptsVariant: false,
  createChoice(model, effort, variant) {
    rejectVariant("Codex", variant);
    return {
      runner: "codex",
      model: requiredModel("Codex", model, "CODEX_PROFILE_REQUIRED"),
      reasoningEffort: requiredEffort(
        "Codex",
        effort,
        codexEffortSchema,
        "CODEX_PROFILE_REQUIRED",
      ),
    };
  },
  async create(options, choice) {
    assertChoice(choice, "codex");
    const runner = new CodexRunner(options);
    return {
      runner,
      executionProfile: createCodexExecutionProfile({
        runnerVersion: await runner.version(),
        model: choice.model,
        reasoningEffort: choice.reasoningEffort,
      }),
    };
  },
  matches: isCodexExecutionProfile,
  formatProfile(profile) {
    if (!isCodexExecutionProfile(profile)) return fallbackProfile(profile);
    return `codex ${profile.runnerVersion}, ${profile.model}, effort ${profile.reasoningEffort}`;
  },
  profileConfig(profile) {
    if (!isCodexExecutionProfile(profile)) return fallbackConfig(profile);
    return {
      type: "codex",
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
    };
  },
};

const claudeDefinition: RunnerDefinition = {
  id: "claude",
  name: "Claude",
  label: "Claude",
  hint: "Uses paid model calls",
  capabilities: {
    incursModelCalls: true,
    comparisonJudge: true,
  },
  defaultExecutable: "claude",
  supportsModel: true,
  requiresModel: true,
  modelPlaceholder: "claude-sonnet-4-6",
  efforts: claudeEffortSchema.options,
  acceptsEffort: (value) => claudeEffortSchema.safeParse(value).success,
  acceptsVariant: false,
  createChoice(model, effort, variant) {
    rejectVariant("Claude", variant);
    return {
      runner: "claude",
      model: requiredModel("Claude", model, "CLAUDE_PROFILE_REQUIRED"),
      reasoningEffort: requiredEffort(
        "Claude",
        effort,
        claudeEffortSchema,
        "CLAUDE_PROFILE_REQUIRED",
      ),
    };
  },
  async create(options, choice) {
    assertChoice(choice, "claude");
    const runner = new ClaudeRunner(options);
    return {
      runner,
      executionProfile: createClaudeExecutionProfile({
        runnerVersion: await runner.version(),
        model: choice.model,
        effort: choice.reasoningEffort,
      }),
    };
  },
  matches: isClaudeExecutionProfile,
  formatProfile(profile) {
    if (!isClaudeExecutionProfile(profile)) return fallbackProfile(profile);
    return `claude ${profile.runnerVersion}, ${profile.model}, effort ${profile.effort}`;
  },
  profileConfig(profile) {
    if (!isClaudeExecutionProfile(profile)) return fallbackConfig(profile);
    return {
      type: "claude",
      model: profile.model,
      reasoningEffort: profile.effort,
    };
  },
};

const openCodeDefinition: RunnerDefinition = {
  id: "opencode",
  name: "OpenCode",
  label: "OpenCode",
  hint: "Uses the trusted local OpenCode configuration",
  capabilities: { incursModelCalls: true, comparisonJudge: true },
  defaultExecutable: "opencode",
  supportsModel: true,
  requiresModel: false,
  efforts: [],
  acceptsEffort: () => false,
  acceptsVariant: true,
  createChoice(model, effort, variant) {
    if (effort !== undefined) {
      throw new SkillbenchError("OpenCode does not accept --reasoning-effort; use --variant", {
        code: "CLI_PROFILE_CONFLICT",
      });
    }
    const parsedModel = model === undefined ? undefined : openCodeModelSchema.safeParse(model);
    if (parsedModel !== undefined && !parsedModel.success) {
      throw new SkillbenchError("OpenCode --model must use provider/model format", {
        code: "OPENCODE_PROFILE_REQUIRED",
        cause: parsedModel.error,
      });
    }
    const trimmedVariant = variant?.trim();
    return {
      runner: "opencode",
      ...(parsedModel === undefined ? {} : { model: parsedModel.data }),
      ...(trimmedVariant === undefined || trimmedVariant === "" ? {} : { variant: trimmedVariant }),
    };
  },
  async create(options, choice) {
    assertChoice(choice, "opencode");
    const runner = new OpenCodeRunner(options);
    return {
      runner,
      executionProfile: createOpenCodeExecutionProfile({
        runnerVersion: await runner.version(),
        ...(choice.model === undefined ? {} : { model: choice.model }),
        ...(choice.variant === undefined ? {} : { variant: choice.variant }),
      }),
    };
  },
  matches: isOpenCodeExecutionProfile,
  formatProfile(profile) {
    if (!isOpenCodeExecutionProfile(profile)) return fallbackProfile(profile);
    return `opencode ${profile.runnerVersion}, ${profile.model ?? "OpenCode default"}${profile.variant === undefined ? "" : `, variant ${profile.variant}`}`;
  },
  profileConfig(profile) {
    if (!isOpenCodeExecutionProfile(profile)) return fallbackConfig(profile);
    return {
      type: "opencode",
      ...(profile.model === undefined ? {} : { model: profile.model }),
      ...(profile.variant === undefined ? {} : { variant: profile.variant }),
    };
  },
};

export const runnerDefinitions: readonly RunnerDefinition[] = Object.freeze([
  mockDefinition,
  codexDefinition,
  claudeDefinition,
  openCodeDefinition,
]);

function rejectVariant(provider: string, variant: string | undefined): void {
  if (variant !== undefined) {
    throw new SkillbenchError(`${provider} does not accept --variant`, {
      code: "CLI_PROFILE_CONFLICT",
    });
  }
}
