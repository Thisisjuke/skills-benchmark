import type { ExecutionProfile } from "@skillbench/sdk/runners";
import {
  formatExecutionSelection,
  runnerDefinition,
} from "../composition/runner-registry";

export function runnerLabel(runner: string): string {
  try {
    return runnerDefinition(runner).name;
  } catch {
    return runner;
  }
}

export function executionProfileLabel(profile: ExecutionProfile): string {
  return formatExecutionSelection(profile);
}
