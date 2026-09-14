export type HoldoutSubject = {
  kind: "parent" | "candidate";
  id: string;
  snapshotId: string;
};

export type HoldoutExecutionRequest = {
  mergeRunId: string;
  subjects: readonly HoldoutSubject[];
};

export type HoldoutResultEntry = HoldoutSubject & {
  evaluationRunId: string;
  score: number;
  passRate: number;
  status: "completed" | "failed";
};

export type HoldoutExecutionResult = {
  mergeRunId: string;
  suiteId: string;
  partition: "holdout";
  entries: HoldoutResultEntry[];
};

export type HoldoutExecutionHandle = Readonly<{
  execute(request: HoldoutExecutionRequest): Promise<HoldoutExecutionResult>;
}>;

export type HoldoutFinalistSelection = {
  mergeRunId: string;
  bestParentId: string;
  candidateIds: readonly string[];
};

export type HoldoutAcceptancePolicy = {
  requireImprovement: boolean;
  minimumImprovement: number;
};

export type MergeAcceptanceVerdict = {
  status: "ACCEPTED" | "REJECTED";
  winnerKind: "parent" | "candidate";
  winnerId: string;
  winnerSnapshotId: string;
  bestParentId: string;
  bestParentScore: number | null;
  bestCandidateId: string | null;
  bestCandidateScore: number | null;
  improvement: number | null;
  requireImprovement: boolean;
  minimumImprovement: number;
  confidence: number;
  confidenceBasis: "mean-pass-rate-not-statistical";
  reason: string;
};

export type HoldoutValidation = {
  execution: HoldoutExecutionResult;
  verdict: MergeAcceptanceVerdict;
  decidedAt: string;
};
