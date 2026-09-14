import { runnerTraceSchema, RUNNER_TRACE_VERSION, type RunnerTrace } from "@skillbench/sdk/runners";
import type { SourceProviderId } from "@skillbench/sdk/skills";

export function createRunnerTrace(
  provider: SourceProviderId,
  protocol: string,
  details: Readonly<Record<string, unknown>> = {},
): RunnerTrace {
  return runnerTraceSchema.parse({
    schemaVersion: RUNNER_TRACE_VERSION,
    provider,
    protocol,
    ...details,
  });
}
