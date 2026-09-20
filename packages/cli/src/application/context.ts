import type { Logger } from "@skillbench/sdk/logging";
import type { SkillSourceService } from "@skillbench/sdk/sources";

import type { WriteBundleInput, WrittenBundle } from "../bundles";
import type { ExecutionRuntime } from "../composition/execution-runtime";
import type { RunnerChoice } from "../composition/runner-registry";
import type { SkillbenchConfig } from "../config";
import type { NewCliHistoryEntry } from "../history";
import type { PreflightInput } from "./preflight";

export interface OperationEvents {
  progress<Value>(message: string, task: () => Promise<Value>): Promise<Value>;
  status(message: string, current?: number, total?: number): void;
  confirmPreflight(input: PreflightInput): Promise<void>;
}

export type ApplicationContext = {
  signal?: AbortSignal;
  logger: Logger;
  now: () => Date;
  createId: () => string;
  sourceService: (config: SkillbenchConfig, projectRoot: string) => SkillSourceService;
  executionRuntime: (
    config: SkillbenchConfig,
    choice: RunnerChoice,
    projectRoot: string,
  ) => Promise<ExecutionRuntime>;
  writeBundle: (input: Omit<WriteBundleInput, "jobId">) => WrittenBundle;
  recordComparison: (entry: NewCliHistoryEntry) => void;
};

export type OutputRequest = {
  output?: string;
  force?: boolean;
};
