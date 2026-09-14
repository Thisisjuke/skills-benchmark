import type { EvalCaseSummary, EvaluationSummary } from "../evaluator";
import type { BlindPairwiseResult } from "../judge";
import type { ExecutionProfile, RunnerPermissions } from "../runners";

export type ComparisonDimensionName =
  | "functionalCorrectness"
  | "outputQuality"
  | "edgeCases"
  | "skillTriggering"
  | "instructionFollowing"
  | "tokenEfficiency"
  | "latency";

export type ComparisonWeights = Record<ComparisonDimensionName, number>;

export type ComparisonDimension = {
  name: ComparisonDimensionName;
  label: string;
  configuredWeight: number;
  effectiveWeight: number;
  scoreA: number | null;
  scoreB: number | null;
  available: boolean;
  details: Record<string, unknown>;
};

export type ScopeCompatibility = "HIGH" | "PARTIAL" | "LOW";

export type ScopeAnalysis = {
  compatibility: ScopeCompatibility;
  confidence: number;
  shared: string[];
  specificToA: string[];
  specificToB: string[];
  evaluatedCapabilities: string[];
  reasons: string[];
};

export type CapabilityMatrixRow = {
  capability: string;
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | "tie";
};

export type CapabilityMatrix = {
  dimensions: Array<{
    capability: string;
    scoreA: number | null;
    scoreB: number | null;
    winner: "A" | "B" | "tie" | "unavailable";
  }>;
  evalCases: CapabilityMatrixRow[];
};

export type ComparisonVerdict = {
  winner: "A" | "B" | "tie";
  scoreA: number;
  scoreB: number;
  difference: number;
  tieThreshold: number;
  statement: string;
};

export type ComparisonPlan = {
  suiteId: string;
  partition: "development" | "holdout";
  repeat: number;
  timeoutMs: number;
  runnerType: ExecutionProfile["runner"];
  executionProfile: ExecutionProfile;
  permissions: RunnerPermissions;
  effectiveConfig: Record<string, unknown>;
};

export type ComparisonSummary = {
  comparisonId: string;
  runId: string;
  snapshotAId: string;
  snapshotBId: string;
  evaluationA: EvaluationSummary;
  evaluationB: EvaluationSummary;
  plan: ComparisonPlan;
  scope: ScopeAnalysis;
  judgments: Array<{
    evalCaseId: string;
    rubric: string;
    result: BlindPairwiseResult;
  }>;
  dimensions: ComparisonDimension[];
  capabilityMatrix: CapabilityMatrix;
  verdict: ComparisonVerdict;
  createdAt: string;
  finishedAt: string;
};

export type ScoredComparison = Pick<
  ComparisonSummary,
  "dimensions" | "capabilityMatrix" | "verdict"
>;

export type CasePair = readonly [EvalCaseSummary, EvalCaseSummary];
