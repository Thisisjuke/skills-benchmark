import * as z from "zod";

import { executionProfileSchema, runnerPermissionsSchema } from "../runners";
import { evaluationResultSchema } from "./evaluation";
import {
  identifierSchema,
  instructionAssetReferenceSchema,
  jsonRecordSchema,
  scoreSchema,
  timestampSchema,
} from "./shared";

const judgeResultSchema = z.strictObject({
  winner: z.enum(["X", "Y", "tie"]),
  confidence: scoreSchema,
  reasons: z.array(z.string()),
  raw: z.json().optional(),
});

const judgePassSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("completed"),
    mappedWinner: z.enum(["A", "B", "tie"]),
    result: judgeResultSchema,
  }),
  z.strictObject({
    status: z.enum(["failed", "timed-out"]),
    error: z.string(),
  }),
]);

const blindPairwiseResultSchema = z.strictObject({
  winner: z.enum(["A", "B", "tie"]),
  confidence: scoreSchema,
  reasons: z.array(z.string()),
  forward: judgePassSchema,
  reverse: judgePassSchema,
});

export const scopeSchema = z.strictObject({
  compatibility: z.enum(["HIGH", "PARTIAL", "LOW"]),
  confidence: scoreSchema,
  shared: z.array(z.string()),
  specificToA: z.array(z.string()),
  specificToB: z.array(z.string()),
  evaluatedCapabilities: z.array(z.string()),
  reasons: z.array(z.string()),
});

const capabilityMatrixSchema = z.strictObject({
  dimensions: z.array(
    z.strictObject({
      capability: z.string(),
      scoreA: scoreSchema.nullable(),
      scoreB: scoreSchema.nullable(),
      winner: z.enum(["A", "B", "tie", "unavailable"]),
    }),
  ),
  evalCases: z.array(
    z.strictObject({
      capability: z.string(),
      scoreA: scoreSchema,
      scoreB: scoreSchema,
      winner: z.enum(["A", "B", "tie"]),
    }),
  ),
});

const comparisonDimensionSchema = z.strictObject({
  name: z.enum([
    "functionalCorrectness",
    "outputQuality",
    "edgeCases",
    "skillTriggering",
    "instructionFollowing",
    "tokenEfficiency",
    "latency",
  ]),
  label: z.string(),
  configuredWeight: z.number().nonnegative(),
  effectiveWeight: z.number().nonnegative(),
  scoreA: scoreSchema.nullable(),
  scoreB: scoreSchema.nullable(),
  available: z.boolean(),
  details: jsonRecordSchema,
});

const comparisonPlanSchema = z.strictObject({
  suiteId: identifierSchema,
  partition: z.enum(["development", "holdout"]),
  repeat: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  runnerType: identifierSchema,
  executionProfile: executionProfileSchema,
  permissions: runnerPermissionsSchema,
  effectiveConfig: jsonRecordSchema,
});

const comparisonVerdictSchema = z.strictObject({
  winner: z.enum(["A", "B", "tie"]),
  scoreA: scoreSchema,
  scoreB: scoreSchema,
  difference: z.number().nonnegative(),
  tieThreshold: z.number().nonnegative(),
  statement: z.string(),
});

export const comparisonSummarySchema = z.strictObject({
  comparisonId: identifierSchema,
  runId: identifierSchema,
  snapshotAId: identifierSchema,
  snapshotBId: identifierSchema,
  evaluationA: evaluationResultSchema,
  evaluationB: evaluationResultSchema,
  plan: comparisonPlanSchema,
  scope: scopeSchema,
  judgments: z.array(
    z.strictObject({
      evalCaseId: identifierSchema,
      rubric: z.string(),
      result: blindPairwiseResultSchema,
    }),
  ),
  dimensions: z.array(comparisonDimensionSchema),
  capabilityMatrix: capabilityMatrixSchema,
  verdict: comparisonVerdictSchema,
  createdAt: timestampSchema,
  finishedAt: timestampSchema,
  instructionAssets: z.array(instructionAssetReferenceSchema).optional(),
});

const reportSchema = z.strictObject({
  id: identifierSchema,
  runId: identifierSchema,
  type: z.literal("comparison"),
  title: z.string(),
  markdown: z.string(),
  payload: z.json(),
  rendererVersion: identifierSchema,
  createdAt: timestampSchema,
});

export const comparisonResultSchema = comparisonSummarySchema.extend({
  sources: z.strictObject({
    A: z.strictObject({ fingerprint: identifierSchema }),
    B: z.strictObject({ fingerprint: identifierSchema }),
  }),
  report: reportSchema.optional(),
});

export type ComparisonResult = z.infer<typeof comparisonResultSchema>;
