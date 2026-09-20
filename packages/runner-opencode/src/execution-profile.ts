import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ExecutionProfile } from "@skillbench/sdk/runners";
import * as z from "zod";

export const openCodeModelSchema = z
  .string()
  .trim()
  .regex(/^[^/\s]+\/.+$/u, "OpenCode model must use provider/model format");

export const openCodeExecutionProfileSchema = z
  .object({
    runner: z.literal("opencode"),
    runnerVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
    model: openCodeModelSchema.optional(),
    variant: z.string().trim().min(1).optional(),
  })
  .strict();

export type OpenCodeExecutionProfile = {
  runner: "opencode";
  runnerVersion: string;
  model?: string;
  variant?: string;
};

export function createOpenCodeExecutionProfile(input: {
  runnerVersion: string;
  model?: string;
  variant?: string;
}): OpenCodeExecutionProfile {
  const parsed = openCodeExecutionProfileSchema.safeParse({
    runner: "opencode",
    runnerVersion: input.runnerVersion,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.variant === undefined ? {} : { variant: input.variant }),
  });
  if (!parsed.success) {
    throw new SkillbenchError(
      `Invalid OpenCode execution profile: ${z.prettifyError(parsed.error)}`,
      { code: "OPENCODE_PROFILE_INVALID", cause: parsed.error },
    );
  }
  return parsed.data as OpenCodeExecutionProfile;
}

export function isOpenCodeExecutionProfile(
  profile: ExecutionProfile,
): profile is OpenCodeExecutionProfile {
  return openCodeExecutionProfileSchema.safeParse(profile).success;
}
