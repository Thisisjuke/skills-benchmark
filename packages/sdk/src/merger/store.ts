import type { EvaluationSummary } from "../evaluator";
import type { ResolvedSkill } from "../skills";
import type { DevelopmentTournament, MergeGenerationSummary } from "./types";

export type CreateMergeRunInput = {
  id: string;
  comparisonId: string;
  config: Record<string, unknown>;
  createdAt: string;
};

export interface MergeGenerationStore {
  createRun(input: CreateMergeRunInput): void;
  completeGeneration(summary: MergeGenerationSummary): void;
  failRun(runId: string, error: unknown, finishedAt: string): void;
}

export interface MergeSnapshotStore {
  save(resolvedSkill: ResolvedSkill): ResolvedSkill;
}

export interface MergeTournamentStore {
  attachSnapshot(candidateId: string, snapshotId: string): void;
  saveDevelopmentResult(candidateId: string, result: EvaluationSummary): void;
  completeTournament(
    generation: MergeGenerationSummary,
    tournament: DevelopmentTournament,
  ): void;
}

export const transientMergeGenerationStore: MergeGenerationStore = Object.freeze({
  createRun: () => undefined,
  completeGeneration: () => undefined,
  failRun: () => undefined,
});

export const transientMergeSnapshotStore: MergeSnapshotStore = Object.freeze({
  save: (resolvedSkill: ResolvedSkill) => resolvedSkill,
});

export const transientMergeTournamentStore: MergeTournamentStore = Object.freeze({
  attachSnapshot: () => undefined,
  saveDevelopmentResult: () => undefined,
  completeTournament: () => undefined,
});
