import type { ExecutionProfile } from "@skillbench/sdk/runners";

import { profileConfiguration } from "../composition/runner-registry";
import type { SkillbenchConfig } from "../config";

export function effectiveRunConfig(
  config: SkillbenchConfig,
  repeat: number,
  executionProfile: ExecutionProfile,
): Record<string, unknown> {
  const {
    model: _configuredModel,
    reasoningEffort: _configuredEffort,
    ...runnerBase
  } = config.runner;
  return JSON.parse(
    JSON.stringify({
      ...config,
      runner: { ...runnerBase, ...profileConfiguration(executionProfile) },
      eval: { ...config.eval, repeat },
    }),
  ) as Record<string, unknown>;
}
