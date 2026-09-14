import * as z from "zod";

import { executionProfileSchema, runResultSchema } from "../runners";
import {
  identifierSchema,
  instructionAssetReferenceSchema,
  jsonRecordSchema,
  scoreSchema,
  timestampSchema,
} from "./shared";

const assertionResultSchema = z.strictObject({
  type: z.enum([
    "file-exists",
    "contains",
    "regex",
    "command",
    "exit-code",
    "llm-rubric",
    "promptfoo",
  ]),
  status: z.enum(["passed", "failed", "not-evaluated", "error"]),
  passed: z.boolean().nullable(),
  score: scoreSchema.nullable(),
  message: z.string(),
  evidence: jsonRecordSchema,
  durationMs: z.number().nonnegative(),
});

const evalAttemptSchema = z.strictObject({
  id: identifierSchema,
  evalCaseId: identifierSchema,
  repetition: z.number().int().positive(),
  status: z.enum(["completed", "failed", "timed-out"]),
  passed: z.boolean(),
  score: scoreSchema,
  durationMs: z.number().nonnegative(),
  runnerResult: runResultSchema,
  assertions: z.array(assertionResultSchema),
});

const evalCaseSummarySchema = z.strictObject({
  evalCaseId: identifierSchema,
  attempts: z.number().int().nonnegative(),
  completedAttempts: z.number().int().nonnegative(),
  passRate: scoreSchema,
  meanScore: scoreSchema,
  medianScore: scoreSchema,
  scoreVariance: z.number().nonnegative(),
  meanDurationMs: z.number().nonnegative(),
  tokens: z
    .strictObject({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    })
    .optional(),
});

export const evaluationResultSchema = z.strictObject({
  runId: identifierSchema,
  snapshotId: identifierSchema,
  suiteId: identifierSchema,
  partition: z.enum(["development", "holdout"]),
  runnerType: identifierSchema,
  executionProfile: executionProfileSchema,
  repeat: z.number().int().positive(),
  status: z.enum(["completed", "failed"]),
  passRate: scoreSchema,
  meanScore: scoreSchema,
  cases: z.array(evalCaseSummarySchema),
  attempts: z.array(evalAttemptSchema),
  workspaceRoot: z.string().min(1).optional(),
  createdAt: timestampSchema,
  finishedAt: timestampSchema,
  instructionAssets: z.array(instructionAssetReferenceSchema).optional(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;
