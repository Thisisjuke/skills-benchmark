import { SkillbenchError } from "../errors";
import type { DevelopmentTournament } from "../merger";
import type {
  HoldoutExecutionHandle,
  HoldoutExecutionResult,
  HoldoutFinalistSelection,
  HoldoutSubject,
} from "./types";

export type HoldoutSelectionStore = {
  getTournament(runId: string): DevelopmentTournament;
};

export class HoldoutGate {
  constructor(private readonly selections: HoldoutSelectionStore) {}

  async execute(
    selection: HoldoutFinalistSelection,
    handle: HoldoutExecutionHandle,
  ): Promise<HoldoutExecutionResult> {
    const tournament = this.selections.getTournament(selection.mergeRunId);
    const subjects = validateSelection(selection, tournament);
    return handle.execute(Object.freeze({
      mergeRunId: selection.mergeRunId,
      subjects: Object.freeze(subjects),
    }));
  }
}

function validateSelection(
  selection: HoldoutFinalistSelection,
  tournament: DevelopmentTournament,
): HoldoutSubject[] {
  if (selection.bestParentId !== tournament.bestParentId) {
    throw new SkillbenchError("Holdout selection must contain the tournament's best parent", {
      code: "HOLDOUT_PARENT_MISMATCH",
    });
  }
  if (selection.candidateIds.length === 0) {
    throw new SkillbenchError("Holdout selection requires at least one candidate", {
      code: "HOLDOUT_CANDIDATES_EMPTY",
    });
  }
  if (new Set(selection.candidateIds).size !== selection.candidateIds.length) {
    throw new SkillbenchError("Holdout selection contains duplicate candidate IDs", {
      code: "HOLDOUT_CANDIDATE_DUPLICATE",
    });
  }
  const allowed = new Set(tournament.selectedCandidateIds);
  const unselected = selection.candidateIds.find((id) => !allowed.has(id));
  if (unselected !== undefined) {
    throw new SkillbenchError(`Candidate was not selected by the development tournament: ${unselected}`, {
      code: "HOLDOUT_CANDIDATE_NOT_SELECTED",
    });
  }
  const entryById = new Map(tournament.entries.map((entry) => [entry.id, entry]));
  const ids = [selection.bestParentId, ...selection.candidateIds];
  return ids.map((id, index) => {
    const entry = entryById.get(id);
    if (entry === undefined) {
      throw new SkillbenchError(`Tournament finalist is missing: ${id}`, {
        code: "HOLDOUT_FINALIST_MISSING",
      });
    }
    const expectedKind = index === 0 ? "parent" : "candidate";
    if (entry.kind !== expectedKind) {
      throw new SkillbenchError(`Tournament finalist has an invalid kind: ${id}`, {
        code: "HOLDOUT_FINALIST_INVALID",
      });
    }
    return { kind: entry.kind, id: entry.id, snapshotId: entry.snapshotId };
  });
}
