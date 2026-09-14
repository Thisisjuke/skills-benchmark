import * as z from "zod";

import type { SkillSnapshot } from "../skills";
import type { ExecutionProfile } from "./execution-profile";
import type { RunnerPermissions } from "./permissions";
import type { RunnerTrace } from "./trace";
import { runnerTraceSchema } from "./trace";

export type RunFixture = {
  sourcePath: string;
  destinationPath: string;
};

export type RunInput = {
  runId: string;
  evalCaseId: string;
  repetition: number;
  snapshot: SkillSnapshot;
  prompt: string;
  fixtures: readonly RunFixture[];
  timeoutMs: number;
  workspacePath: string;
  permissions: RunnerPermissions;
  executionProfile: ExecutionProfile;
  signal?: AbortSignal;
};

export type RunArtifact = {
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
};

export type RunResult = {
  status: "completed" | "failed" | "timed-out";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  artifacts: readonly RunArtifact[];
  tokens?: {
    input: number;
    output: number;
  };
  skillActivated?: boolean;
  trace?: RunnerTrace;
};

export const runResultSchema = z.strictObject({
  status: z.enum(["completed", "failed", "timed-out"]),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
  artifacts: z.array(
    z.strictObject({
      relativePath: z.string().min(1),
      contentHash: z.string().min(1),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
  tokens: z
    .strictObject({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    })
    .optional(),
  skillActivated: z.boolean().optional(),
  trace: runnerTraceSchema.optional(),
});

export function parseRunResult(value: unknown): RunResult {
  return runResultSchema.parse(value) as RunResult;
}

export interface Runner {
  run(input: RunInput): Promise<RunResult>;
}
