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
  efforts: [],
  acceptsEffort: () => false,
  createChoice(model, effort) {
    if (model !== undefined || effort !== undefined) {
      throw new SkillbenchError(
        "--model and --reasoning-effort require --runner codex or --runner claude",
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
  modelPlaceholder: "gpt-5.6-luna",
  efforts: codexEffortSchema.options,
  acceptsEffort: (value) => codexEffortSchema.safeParse(value).success,
  createChoice(model, effort) {
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
  modelPlaceholder: "claude-sonnet-4-6",
  efforts: claudeEffortSchema.options,
  acceptsEffort: (value) => claudeEffortSchema.safeParse(value).success,
  createChoice(model, effort) {
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

export const runnerDefinitions: readonly RunnerDefinition[] = Object.freeze([
  mockDefinition,
  codexDefinition,
  claudeDefinition,
]);
