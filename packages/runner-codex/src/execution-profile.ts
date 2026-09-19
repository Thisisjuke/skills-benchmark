import { SkillbenchError } from "@skillbench/sdk/errors";
import type { ExecutionProfile } from "@skillbench/sdk/runners";
import { codexEffortSchema } from "@skillbench/invocation-contract";
import * as z from "zod";

export const reasoningEffortSchema = codexEffortSchema;
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const codexExecutionProfileSchema = z
  .object({
    runner: z.literal("codex"),
    runnerVersion: z.string().regex(/^codex-cli\s+\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
    model: z.string().trim().min(1),
    reasoningEffort: reasoningEffortSchema,
  })
  .strict();

export type CodexExecutionProfile = z.infer<typeof codexExecutionProfileSchema>;

export function createCodexExecutionProfile(input: {
  runnerVersion: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}): CodexExecutionProfile {
  const missing = [
    ...(input.model === undefined ? ["runner.model"] : []),
    ...(input.reasoningEffort === undefined ? ["runner.reasoningEffort"] : []),
  ];
  if (missing.length > 0) {
    throw new SkillbenchError(
      `Codex execution requires an explicit ${missing.join(" and ")} in .skillbench/config.yaml`,
      { code: "CODEX_PROFILE_REQUIRED" },
    );
  }
  const parsed = codexExecutionProfileSchema.safeParse({
    runner: "codex",
    runnerVersion: input.runnerVersion,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  if (!parsed.success) {
    throw new SkillbenchError(`Invalid Codex execution profile: ${z.prettifyError(parsed.error)}`, {
      code: "CODEX_PROFILE_INVALID",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function isCodexExecutionProfile(
  profile: ExecutionProfile,
): profile is CodexExecutionProfile {
  return codexExecutionProfileSchema.safeParse(profile).success;
}
