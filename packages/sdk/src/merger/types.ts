import type { CapabilityMatrix, ComparisonDimension, ScopeAnalysis } from "../comparator";
import type { SkillFile } from "../skills";

export type DevelopmentEvidence = {
  comparisonId: string;
  comparisonRunId: string;
  snapshotAId: string;
  snapshotBId: string;
  suiteId: string;
  partition: "development";
  scope: ScopeAnalysis;
  dimensions: Array<
    Pick<ComparisonDimension, "name" | "scoreA" | "scoreB" | "available">
  >;
  capabilityMatrix: CapabilityMatrix;
};

export type MergeEvidenceReference = {
  source: "development" | "static-analysis";
  reference: string;
  scoreA?: number;
  scoreB?: number;
};

export type MergeRecommendation = {
  category: "capability" | "instruction" | "reference" | "script" | "asset" | "duplicate";
  value: string;
  evidence: MergeEvidenceReference;
};

export type MergeContradiction = {
  key: string;
  valueA: string;
  valueB: string;
  evidence: MergeEvidenceReference;
};

export type MergePlan = {
  schemaVersion: 1;
  status: "RECOMMENDED" | "MERGE_NOT_RECOMMENDED";
  reason: string;
  comparisonId: string;
  comparisonRunId: string;
  parentAId: string;
  parentBId: string;
  preserveFromA: MergeRecommendation[];
  preserveFromB: MergeRecommendation[];
  resolveContradictions: MergeContradiction[];
  discard: MergeRecommendation[];
};

export type MergeStrategy = "a-preserving" | "balanced" | "b-preserving";

export type MergeCandidate = {
  id: string;
  strategy: MergeStrategy;
  name: string;
  description: string;
  files: SkillFile[];
  fingerprint: string;
  fingerprintAlgorithm: string;
  provenance: {
    schemaVersion: 1;
    comparisonId: string;
    parentAId: string;
    parentBId: string;
    strategy: MergeStrategy;
    selectedFiles: Array<{ path: string; source: "A" | "B" | "both" | "generated" }>;
    collisions: Array<{ originalPath: string; resolution: string }>;
    generatedAt: string;
  };
};

export type MergeGenerationSummary = {
  runId: string;
  comparisonId: string;
  plan: MergePlan;
  candidates: MergeCandidate[];
  createdAt: string;
  finishedAt: string;
};

export type TournamentEntry = {
  kind: "parent" | "candidate";
  id: string;
  snapshotId: string;
  evaluationRunId: string;
  score: number;
  passRate: number;
  status: "completed" | "failed";
};

export type DevelopmentTournament = {
  suiteId: string;
  entries: TournamentEntry[];
  bestParentId: string;
  bestParentScore: number;
  selectedCandidateIds: string[];
};
