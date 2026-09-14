import type { ClaudeEffort } from "@skillbench/runner-claude";
import type { ReasoningEffort } from "@skillbench/runner-codex";
import type { Logger } from "@skillbench/sdk/logging";
import type {
  ExecutionProfile,
  Runner,
  RunnerSandbox,
} from "@skillbench/sdk/runners";
import type { RunnerEffort } from "@skillbench/invocation-contract";

export type RunnerChoice =
  | { runner: "mock"; model?: undefined; reasoningEffort?: undefined }
  | { runner: "codex"; model: string; reasoningEffort: ReasoningEffort }
  | { runner: "claude"; model: string; reasoningEffort: ClaudeEffort };

export type RegisteredRunnerOptions = {
  executable: string;
  sandbox: RunnerSandbox;
  maxOutputBytes: number;
  logger: Logger;
};

export type RegisteredRunner = {
  runner: Runner;
  executionProfile: ExecutionProfile;
};

export type RunnerDefinition = {
  id: string;
  name: string;
  label: string;
  hint: string;
  capabilities: {
    incursModelCalls: boolean;
    comparisonJudge: boolean;
  };
  defaultExecutable: string;
  modelPlaceholder?: string;
  efforts: readonly RunnerEffort[];
  acceptsEffort(value: string): boolean;
  createChoice(model: string | undefined, effort: RunnerEffort | undefined): RunnerChoice;
  create(options: RegisteredRunnerOptions, choice: RunnerChoice): Promise<RegisteredRunner>;
  matches(profile: ExecutionProfile): boolean;
  formatProfile(profile: ExecutionProfile): string;
  profileConfig(profile: ExecutionProfile): Readonly<Record<string, unknown>>;
};
