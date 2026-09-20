import type { ExecutionProfile } from "@skillbench/sdk/runners";

import { profileConfiguration } from "../composition/runner-registry";
import type { ConfiguredRunner, SkillbenchConfig } from "../config";

export function effectiveRunConfig(
  config: SkillbenchConfig,
  repeat: number,
  executionProfile: ExecutionProfile,
  configuredRunner: ConfiguredRunner,
): Record<string, unknown> {
  const {
    model: _configuredModel,
    reasoningEffort: _configuredEffort,
    variant: _configuredVariant,
    ...runnerBase
  } = configuredRunner;
  const { runners: _configuredRunners, ...configBase } = config;
  return JSON.parse(
    JSON.stringify({
      ...configBase,
      runner: { ...runnerBase, ...profileConfiguration(executionProfile) },
      eval: { ...config.eval, repeat },
    }),
  ) as Record<string, unknown>;
}
