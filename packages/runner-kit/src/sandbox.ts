import type { RunnerPermissions, RunnerSandbox } from "@skillbench/sdk/runners";

export function sandboxFromPermissions(
  permissions: RunnerPermissions,
  fallback: RunnerSandbox,
): RunnerSandbox {
  return permissions.sandbox ?? fallback;
}
