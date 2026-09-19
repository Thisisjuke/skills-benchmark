import * as z from "zod";

import {
  identifierSchema,
  instructionAssetReferenceSchema,
  scoreSchema,
  timestampSchema,
} from "./shared";
import { scopeSchema } from "./comparison";

const mergeEvidenceSchema = z.strictObject({
  source: z.enum(["development", "static-analysis"]),
  reference: z.string(),
  scoreA: z.number().optional(),
  scoreB: z.number().optional(),
});

const mergeRecommendationSchema = z.strictObject({
  category: z.enum(["capability", "instruction", "reference", "script", "asset", "duplicate"]),
  value: z.string(),
  evidence: mergeEvidenceSchema,
});

const mergeContradictionSchema = z.strictObject({
  key: z.string(),
  valueA: z.string(),
  valueB: z.string(),
  evidence: mergeEvidenceSchema,
});

export const mergePlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  status: z.enum(["RECOMMENDED", "MERGE_NOT_RECOMMENDED"]),
  reason: z.string(),
  comparisonId: identifierSchema,
  comparisonRunId: identifierSchema,
  parentAId: identifierSchema,
  parentBId: identifierSchema,
  preserveFromA: z.array(mergeRecommendationSchema),
  preserveFromB: z.array(mergeRecommendationSchema),
  resolveContradictions: z.array(mergeContradictionSchema),
  discard: z.array(mergeRecommendationSchema),
});

const tournamentSchema = z.strictObject({
  suiteId: identifierSchema,
  entries: z.array(
    z.strictObject({
      kind: z.enum(["parent", "candidate"]),
      id: identifierSchema,
      snapshotId: identifierSchema,
      evaluationRunId: identifierSchema,
      score: scoreSchema,
      passRate: scoreSchema,
      status: z.enum(["completed", "failed"]),
    }),
  ),
  bestParentId: identifierSchema,
  bestParentScore: scoreSchema,
  selectedCandidateIds: z.array(identifierSchema),
});

const holdoutValidationSchema = z.strictObject({
  execution: z.strictObject({
    mergeRunId: identifierSchema,
    suiteId: identifierSchema,
    partition: z.literal("holdout"),
    entries: z.array(
      z.strictObject({
        kind: z.enum(["parent", "candidate"]),
        id: identifierSchema,
        snapshotId: identifierSchema,
        evaluationRunId: identifierSchema,
        score: scoreSchema,
        passRate: scoreSchema,
        status: z.enum(["completed", "failed"]),
      }),
    ),
  }),
  verdict: z.strictObject({
    status: z.enum(["ACCEPTED", "REJECTED"]),
    winnerKind: z.enum(["parent", "candidate"]),
    winnerId: identifierSchema,
    winnerSnapshotId: identifierSchema,
    bestParentId: identifierSchema,
    bestParentScore: scoreSchema.nullable(),
    bestCandidateId: identifierSchema.nullable(),
    bestCandidateScore: scoreSchema.nullable(),
    improvement: z.number().nullable(),
    requireImprovement: z.boolean(),
    minimumImprovement: z.number().nonnegative(),
    confidence: scoreSchema,
    confidenceBasis: z.literal("mean-pass-rate-not-statistical"),
    reason: z.string(),
  }),
  decidedAt: timestampSchema,
});

const mergeCandidateResultSchema = z.strictObject({
  id: identifierSchema,
  strategy: z.enum(["a-preserving", "balanced", "b-preserving"]),
  name: z.string(),
  fingerprint: identifierSchema,
  files: z.array(
    z.strictObject({
      relativePath: z.string().min(1),
      contentHash: identifierSchema,
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
  provenance: z.json(),
});

const mergeNotRecommendedResultSchema = z.strictObject({
  comparisonReused: z.boolean(),
  scope: scopeSchema,
  plan: mergePlanSchema.refine((plan) => plan.status === "MERGE_NOT_RECOMMENDED"),
  instructionAssets: z.array(instructionAssetReferenceSchema).optional(),
});

const mergeCompletedResultSchema = z.strictObject({
  comparisonReused: z.boolean(),
  scope: scopeSchema,
  runId: identifierSchema,
  comparisonId: identifierSchema,
  plan: mergePlanSchema.refine((plan) => plan.status === "RECOMMENDED"),
  tournament: tournamentSchema,
  holdoutValidation: holdoutValidationSchema.optional(),
  candidates: z.array(mergeCandidateResultSchema),
  instructionAssets: z.array(instructionAssetReferenceSchema).optional(),
});

export const mergeResultSchema = z.union([
  mergeNotRecommendedResultSchema,
  mergeCompletedResultSchema,
]);

export type MergeResult = z.infer<typeof mergeResultSchema>;
