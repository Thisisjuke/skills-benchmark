import type { ComparisonSummary } from "../comparator";
import type { EvalSuite, EvaluationService, EvaluationSummary } from "../evaluator";
import { parseSkill, type ResolvedSkill } from "../skills";
import {
  transientMergeSnapshotStore,
  transientMergeTournamentStore,
  type MergeSnapshotStore,
  type MergeTournamentStore,
} from "./store";
import type {
  DevelopmentTournament,
  MergeCandidate,
  MergeGenerationSummary,
  TournamentEntry,
} from "./types";

export type TournamentInput = {
  generation: MergeGenerationSummary;
  comparison: ComparisonSummary;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  suite: EvalSuite;
  selectionCount?: number;
  signal?: AbortSignal;
};

export type DevelopmentTournamentServiceOptions = {
  snapshotStore?: MergeSnapshotStore;
  store?: MergeTournamentStore;
};

export class DevelopmentTournamentService {
  private readonly snapshotStore: MergeSnapshotStore;
  private readonly store: MergeTournamentStore;

  constructor(
    private readonly evaluator: EvaluationService,
    options: DevelopmentTournamentServiceOptions = {},
  ) {
    this.snapshotStore = options.snapshotStore ?? transientMergeSnapshotStore;
    this.store = options.store ?? transientMergeTournamentStore;
  }

  async run(input: TournamentInput): Promise<DevelopmentTournament> {
    validateTournamentInput(input);
    const entries: TournamentEntry[] = [
      parentEntry("A", input.comparison.evaluationA),
      parentEntry("B", input.comparison.evaluationB),
    ];
    for (const candidate of input.generation.candidates) {
      input.signal?.throwIfAborted();
      const resolved = this.snapshotStore.save(candidateSkill(input.generation.runId, candidate));
      this.store.attachSnapshot(candidate.id, resolved.snapshot.id);
      const evaluation = await this.evaluator.evaluate({
        resolvedSkill: resolved,
        suite: input.suite,
        repeat: input.comparison.plan.repeat,
        timeoutMs: input.comparison.plan.timeoutMs,
        executionProfile: input.comparison.plan.executionProfile,
        permissions: input.comparison.plan.permissions,
        config: structuredClone(input.comparison.plan.effectiveConfig),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      this.store.saveDevelopmentResult(candidate.id, evaluation);
      entries.push({
        kind: "candidate",
        id: candidate.id,
        snapshotId: resolved.snapshot.id,
        evaluationRunId: evaluation.runId,
        score: evaluation.meanScore,
        passRate: evaluation.passRate,
        status: evaluation.status,
      });
    }
    const parents = entries.filter((entry) => entry.kind === "parent").sort(rank);
    const candidates = entries.filter((entry) => entry.kind === "candidate").sort(rank);
    const bestParent = parents[0];
    if (bestParent === undefined) throw new Error("Development tournament has no parent");
    const selectionCount = input.selectionCount ?? 1;
    const tournament: DevelopmentTournament = {
      suiteId: input.suite.id,
      entries,
      bestParentId: bestParent.id,
      bestParentScore: bestParent.score,
      selectedCandidateIds: candidates.slice(0, selectionCount).map((entry) => entry.id),
    };
    this.store.completeTournament(input.generation, tournament);
    return tournament;
  }
}

export function rankTournamentEntries(entries: readonly TournamentEntry[]): TournamentEntry[] {
  return [...entries].sort(rank);
}

function rank(left: TournamentEntry, right: TournamentEntry): number {
  if (left.status !== right.status) return left.status === "completed" ? -1 : 1;
  return right.score - left.score || right.passRate - left.passRate || left.id.localeCompare(right.id, "en");
}

function parentEntry(id: "A" | "B", evaluation: EvaluationSummary): TournamentEntry {
  return {
    kind: "parent",
    id,
    snapshotId: evaluation.snapshotId,
    evaluationRunId: evaluation.runId,
    score: evaluation.meanScore,
    passRate: evaluation.passRate,
    status: evaluation.status,
  };
}

function candidateSkill(runId: string, candidate: MergeCandidate): ResolvedSkill {
  return {
    snapshot: {
      id: candidate.id,
      origin: { type: "local", originalInput: `skillbench:merge/${runId}/${candidate.id}` },
      rootPath: ".",
      files: candidate.files.map((file) => ({ ...file, content: file.content.slice() })),
      fingerprint: candidate.fingerprint,
      fingerprintAlgorithm: candidate.fingerprintAlgorithm,
      fetchedAt: candidate.provenance.generatedAt,
    },
    skill: parseSkill(candidate.files),
  };
}

function validateTournamentInput(input: TournamentInput): void {
  if (input.suite.partition !== "development" || input.comparison.plan.partition !== "development") {
    throw new Error("Development tournament cannot consume holdout evals");
  }
  if (input.suite.id !== input.comparison.plan.suiteId) throw new Error("Tournament suite differs from comparison suite");
  if (
    input.skillA.snapshot.id !== input.comparison.snapshotAId ||
    input.skillB.snapshot.id !== input.comparison.snapshotBId
  ) {
    throw new Error("Tournament parents differ from comparison parents");
  }
  const count = input.selectionCount ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > input.generation.candidates.length) {
    throw new Error("selectionCount must select at least one generated candidate");
  }
}
