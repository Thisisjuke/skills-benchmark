export { scoreComparison, validateWeights } from "./scoring";
export {
  ComparisonService,
  type CompareInput,
  type ComparisonServiceOptions,
} from "./service";
export { ScopeAnalyzer } from "./scope";
export {
  transientComparisonStore,
  type ComparisonJudge,
  type ComparisonStore,
  type CreateComparisonRunInput,
} from "./store";
export type {
  CapabilityMatrix,
  CapabilityMatrixRow,
  CasePair,
  ComparisonDimension,
  ComparisonDimensionName,
  ComparisonPlan,
  ComparisonSummary,
  ComparisonVerdict,
  ComparisonWeights,
  ScopeAnalysis,
  ScopeCompatibility,
  ScoredComparison,
} from "./types";
