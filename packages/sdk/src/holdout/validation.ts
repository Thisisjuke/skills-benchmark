import { SkillbenchError } from "../errors";
import type { DevelopmentTournament } from "../merger";
import type {
  HoldoutAcceptancePolicy,
  HoldoutExecutionResult,
  HoldoutFinalistSelection,
  HoldoutResultEntry,
  HoldoutValidation,
  MergeAcceptanceVerdict,
} from "./types";

export type HoldoutValidationStore = {
  saveHoldoutValidation(runId: string, validation: HoldoutValidation): void;
};

export const transientHoldoutValidationStore: HoldoutValidationStore = Object.freeze({
  saveHoldoutValidation: () => undefined,
});

export type DecideHoldoutInput = {
  execution: HoldoutExecutionResult;
  selection: HoldoutFinalistSelection;
  tournament: DevelopmentTournament;
  policy: HoldoutAcceptancePolicy;
};

export type HoldoutValidationServiceOptions = {
  now?: () => Date;
  store?: HoldoutValidationStore;
};

export class HoldoutValidationService {
  private readonly now: () => Date;
  private readonly store: HoldoutValidationStore;

  constructor(options: HoldoutValidationServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? transientHoldoutValidationStore;
  }

  complete(input: DecideHoldoutInput): HoldoutValidation {
    const validation = {
      execution: input.execution,
      verdict: decideHoldoutVerdict(input),
      decidedAt: this.now().toISOString(),
    };
    this.store.saveHoldoutValidation(input.selection.mergeRunId, validation);
    return validation;
  }
}

export function decideHoldoutVerdict(input: DecideHoldoutInput): MergeAcceptanceVerdict {
  validatePolicy(input.policy);
  const parentTournamentEntry = input.tournament.entries.find(
    (entry) => entry.kind === "parent" && entry.id === input.selection.bestParentId,
  );
  if (
    input.execution.partition !== "holdout" ||
    input.execution.mergeRunId !== input.selection.mergeRunId ||
    input.tournament.bestParentId !== input.selection.bestParentId ||
    parentTournamentEntry === undefined
  ) {
    throw new SkillbenchError("Holdout result does not match the persisted finalist selection", {
      code: "HOLDOUT_RESULT_MISMATCH",
    });
  }

  const expectedIds = [input.selection.bestParentId, ...input.selection.candidateIds];
  const entryById = new Map(input.execution.entries.map((entry) => [entry.id, entry]));
  const missing = expectedIds.filter((id) => !entryById.has(id));
  const unexpected = input.execution.entries.filter((entry) => !expectedIds.includes(entry.id));
  const parent = entryById.get(input.selection.bestParentId);
  const fallback = {
    winnerKind: "parent" as const,
    winnerId: input.selection.bestParentId,
    winnerSnapshotId: parentTournamentEntry.snapshotId,
    bestParentId: input.selection.bestParentId,
    bestParentScore: parent?.score ?? null,
    bestCandidateId: null,
    bestCandidateScore: null,
    improvement: null,
    requireImprovement: input.policy.requireImprovement,
    minimumImprovement: input.policy.minimumImprovement,
    confidence: 0,
    confidenceBasis: "mean-pass-rate-not-statistical" as const,
  };
  if (missing.length > 0 || unexpected.length > 0 || input.execution.entries.length !== expectedIds.length) {
    return {
      status: "REJECTED",
      ...fallback,
      reason: `Holdout incomplete: missing [${missing.join(", ") || "none"}], unexpected [${unexpected.map((entry) => entry.id).join(", ") || "none"}]`,
    };
  }
  if (parent === undefined || parent.kind !== "parent" || parent.status !== "completed") {
    return { status: "REJECTED", ...fallback, reason: "Best parent holdout evaluation did not complete" };
  }

  const candidates = input.selection.candidateIds
    .map((id) => entryById.get(id))
    .filter((entry): entry is HoldoutResultEntry => entry?.kind === "candidate" && entry.status === "completed")
    .sort(rankResults);
  const bestCandidate = candidates[0];
  if (bestCandidate === undefined) {
    return { status: "REJECTED", ...fallback, bestParentScore: parent.score, reason: "No candidate completed the holdout evaluation" };
  }
  const improvement = bestCandidate.score - parent.score;
  const reachesMinimum = improvement + Number.EPSILON >= input.policy.minimumImprovement;
  const improvesWhenRequired = !input.policy.requireImprovement || improvement > Number.EPSILON;
  const accepted = reachesMinimum && improvesWhenRequired;
  const confidence = clamp01((parent.passRate + bestCandidate.passRate) / 2);
  return {
    status: accepted ? "ACCEPTED" : "REJECTED",
    winnerKind: accepted ? "candidate" : "parent",
    winnerId: accepted ? bestCandidate.id : parent.id,
    winnerSnapshotId: accepted ? bestCandidate.snapshotId : parent.snapshotId,
    bestParentId: parent.id,
    bestParentScore: parent.score,
    bestCandidateId: bestCandidate.id,
    bestCandidateScore: bestCandidate.score,
    improvement,
    requireImprovement: input.policy.requireImprovement,
    minimumImprovement: input.policy.minimumImprovement,
    confidence,
    confidenceBasis: "mean-pass-rate-not-statistical",
    reason: accepted
      ? `Candidate ${bestCandidate.id} improved the holdout score by ${formatScore(improvement)}`
      : `Best candidate ${bestCandidate.id} improved the holdout score by ${formatScore(improvement)}, below the required policy`,
  };
}

function validatePolicy(policy: HoldoutAcceptancePolicy): void {
  if (!Number.isFinite(policy.minimumImprovement) || policy.minimumImprovement < 0 || policy.minimumImprovement > 1) {
    throw new SkillbenchError("minimumImprovement must be between 0 and 1", {
      code: "HOLDOUT_POLICY_INVALID",
    });
  }
}

function rankResults(left: HoldoutResultEntry, right: HoldoutResultEntry): number {
  return right.score - left.score || right.passRate - left.passRate || left.id.localeCompare(right.id, "en");
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatScore(value: number): string {
  return value.toFixed(4);
}
