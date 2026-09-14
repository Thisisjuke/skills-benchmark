export { StructuredCandidateGenerator, type CandidateGeneratorOptions } from "./candidate-generator";
export { projectDevelopmentEvidence } from "./evidence";
export { CapabilityExtractor } from "./extractor";
export {
  MergeGenerationService,
  type GenerateMergeInput,
  type MergeGenerationServiceOptions,
} from "./generation-service";
export {
  MergePlanningService,
  type ComparisonRequest,
  type MergeComparisonResolver,
  type PreparedMerge,
  type PrepareMergeInput,
} from "./planning-service";
export {
  DevelopmentTournamentService,
  rankTournamentEntries,
  type DevelopmentTournamentServiceOptions,
  type TournamentInput,
} from "./tournament";
export {
  transientMergeGenerationStore,
  transientMergeSnapshotStore,
  transientMergeTournamentStore,
  type CreateMergeRunInput,
  type MergeGenerationStore,
  type MergeSnapshotStore,
  type MergeTournamentStore,
} from "./store";
export type {
  DevelopmentEvidence,
  MergeContradiction,
  MergeEvidenceReference,
  MergePlan,
  MergeCandidate,
  MergeGenerationSummary,
  MergeStrategy,
  MergeRecommendation,
  DevelopmentTournament,
  TournamentEntry,
} from "./types";
