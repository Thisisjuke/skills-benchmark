import * as z from "zod";

export const RUNNER_PERMISSIONS_VERSION = 1 as const;

export const runnerSandboxSchema = z.enum(["read-only", "workspace-write"]);
export type RunnerSandbox = z.infer<typeof runnerSandboxSchema>;

export const runnerPermissionsSchema = z
  .object({
    schemaVersion: z.literal(RUNNER_PERMISSIONS_VERSION),
    sandbox: runnerSandboxSchema.optional(),
  })
  .strict();

export type RunnerPermissions = z.infer<typeof runnerPermissionsSchema>;

export function createRunnerPermissions(sandbox: RunnerSandbox): RunnerPermissions {
  return Object.freeze({ schemaVersion: RUNNER_PERMISSIONS_VERSION, sandbox });
}
