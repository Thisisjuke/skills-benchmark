import * as z from "zod";

import { automationRunnerProfileSchema } from "./runners";

const shared = {
  config: z.string().trim().min(1).optional(),
  debug: z.boolean().optional(),
  offline: z.boolean().optional(),
} as const;

const source = {
  source: z.string().trim().min(1),
  skillPath: z.string().trim().min(1).optional(),
} as const;

const pair = {
  sourceA: z.string().trim().min(1),
  sourceB: z.string().trim().min(1),
  skillPathA: z.string().trim().min(1).optional(),
  skillPathB: z.string().trim().min(1).optional(),
} as const;

const execution = {
  profile: automationRunnerProfileSchema,
  evals: z.string().trim().min(1),
  repeat: z.number().int().min(1).max(100).optional(),
} as const;

export const skillbenchAutomationRequestSchema = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("inspect"), ...shared, ...source }),
  z.strictObject({
    command: z.literal("eval"),
    ...shared,
    ...source,
    ...execution,
    partition: z.enum(["development", "holdout"]).optional(),
  }),
  z.strictObject({
    command: z.literal("compare"),
    ...shared,
    ...pair,
    ...execution,
    partition: z.enum(["development", "holdout"]).optional(),
  }),
  z.strictObject({
    command: z.literal("merge"),
    ...shared,
    ...pair,
    ...execution,
    holdout: z.string().trim().min(1).optional(),
    comparison: z.string().trim().min(1).optional(),
  }),
]);

export type SkillbenchAutomationRequest = z.infer<typeof skillbenchAutomationRequestSchema>;
