import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ExecutionProfile } from "@skillbench/sdk/runners";
import { claudeEffortSchema as sharedClaudeEffortSchema } from "@skillbench/invocation-contract";
import * as z from "zod";

export const claudeEffortSchema = sharedClaudeEffortSchema;
export type ClaudeEffort = z.infer<typeof claudeEffortSchema>;

export const claudeExecutionProfileSchema = z
  .object({
    runner: z.literal("claude"),
    runnerVersion: z
      .string()
      .regex(/^(?:claude-code\s+)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\s+\(Claude Code\))?$/u),
    model: z.string().trim().min(1),
    effort: claudeEffortSchema,
  })
  .strict();

export type ClaudeExecutionProfile = z.infer<typeof claudeExecutionProfileSchema>;

export function createClaudeExecutionProfile(input: {
  runnerVersion: string;
  model?: string;
  effort?: ClaudeEffort;
}): ClaudeExecutionProfile {
  const missing = [
    ...(input.model === undefined ? ["runner.model"] : []),
    ...(input.effort === undefined ? ["runner.reasoningEffort"] : []),
  ];
  if (missing.length > 0) {
    throw new SkillbenchError(
      `Claude execution requires an explicit ${missing.join(" and ")} in skillbench.yaml`,
      { code: "CLAUDE_PROFILE_REQUIRED" },
    );
  }
  const parsed = claudeExecutionProfileSchema.safeParse({
    runner: "claude",
    runnerVersion: input.runnerVersion,
    model: input.model,
    effort: input.effort,
  });
  if (!parsed.success) {
    throw new SkillbenchError(
      `Invalid Claude execution profile: ${z.prettifyError(parsed.error)}`,
      {
        code: "CLAUDE_PROFILE_INVALID",
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

export function isClaudeExecutionProfile(
  profile: ExecutionProfile,
): profile is ClaudeExecutionProfile {
  return claudeExecutionProfileSchema.safeParse(profile).success;
}
