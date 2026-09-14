import * as z from "zod";

export const RUNNER_IDS = ["mock", "codex", "claude"] as const;
export const CODEX_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const RUNNER_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const runnerTypeSchema = z.enum(RUNNER_IDS);
export const codexEffortSchema = z.enum(CODEX_EFFORTS);
export const claudeEffortSchema = z.enum(CLAUDE_EFFORTS);
export const runnerEffortSchema = z.enum(RUNNER_EFFORTS);

export const automationRunnerProfileSchema = z.discriminatedUnion("runner", [
  z.strictObject({ runner: z.literal("mock") }),
  z.strictObject({
    runner: z.literal("codex"),
    model: z.string().trim().min(1),
    reasoningEffort: codexEffortSchema,
  }),
  z.strictObject({
    runner: z.literal("claude"),
    model: z.string().trim().min(1),
    reasoningEffort: claudeEffortSchema,
  }),
]);

export type RunnerType = z.infer<typeof runnerTypeSchema>;
export type RunnerEffort = z.infer<typeof runnerEffortSchema>;
export type AutomationRunnerProfile = z.infer<typeof automationRunnerProfileSchema>;
