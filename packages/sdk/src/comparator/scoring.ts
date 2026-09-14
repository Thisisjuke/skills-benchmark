import type { EvaluationSummary } from "../evaluator";
import type {
  CapabilityMatrix,
  ComparisonDimension,
  ComparisonDimensionName,
  ComparisonVerdict,
  ComparisonWeights,
  ScoredComparison,
} from "./types";

const LABELS: Record<ComparisonDimensionName, string> = {
  functionalCorrectness: "Functional correctness",
  outputQuality: "Output quality",
  edgeCases: "Edge cases",
  skillTriggering: "Skill triggering",
  instructionFollowing: "Instruction following",
  tokenEfficiency: "Token efficiency",
  latency: "Latency",
};

const DIMENSION_ORDER = Object.keys(LABELS) as ComparisonDimensionName[];

export function scoreComparison(
  evaluationA: EvaluationSummary,
  evaluationB: EvaluationSummary,
  weights: ComparisonWeights,
  tieThreshold: number,
  observed: Partial<
    Record<ComparisonDimensionName, readonly [number | null, number | null]>
  > = {},
): ScoredComparison {
  validateWeights(weights);
  if (!Number.isFinite(tieThreshold) || tieThreshold < 0 || tieThreshold > 1) {
    throw new Error(`tieThreshold must be between 0 and 1 (received ${tieThreshold})`);
  }

  const latency = relativeEfficiency(meanAttemptDuration(evaluationA), meanAttemptDuration(evaluationB));
  const tokens = relativeEfficiency(meanAttemptTokens(evaluationA), meanAttemptTokens(evaluationB));
  const raw: Record<ComparisonDimensionName, readonly [number | null, number | null]> = {
    functionalCorrectness: [evaluationA.meanScore, evaluationB.meanScore],
    outputQuality: [null, null],
    edgeCases: [null, null],
    skillTriggering: [null, null],
    instructionFollowing: [null, null],
    tokenEfficiency: tokens,
    latency,
    ...observed,
  };
  const availableWeight = DIMENSION_ORDER.reduce(
    (sum, name) => sum + (raw[name][0] === null || raw[name][1] === null ? 0 : weights[name]),
    0,
  );
  if (availableWeight <= 0) throw new Error("At least one weighted comparison dimension must be available");

  const dimensions: ComparisonDimension[] = DIMENSION_ORDER.map((name) => {
    const [scoreA, scoreB] = raw[name];
    const available = scoreA !== null && scoreB !== null;
    return {
      name,
      label: LABELS[name],
      configuredWeight: weights[name],
      effectiveWeight: available ? weights[name] / availableWeight : 0,
      scoreA,
      scoreB,
      available,
      details: dimensionDetails(name, evaluationA, evaluationB),
    };
  });
  const scoreA = weightedScore(dimensions, "scoreA");
  const scoreB = weightedScore(dimensions, "scoreB");
  const difference = Math.abs(scoreA - scoreB);
  const winner = difference <= tieThreshold ? "tie" : scoreA > scoreB ? "A" : "B";
  const verdict: ComparisonVerdict = {
    winner,
    scoreA,
    scoreB,
    difference,
    tieThreshold,
    statement:
      winner === "tie"
        ? `A and B are tied on suite ${evaluationA.suiteId} within threshold ${tieThreshold}.`
        : `${winner} scores higher on suite ${evaluationA.suiteId}; this is not a universal ranking.`,
  };
  return { dimensions, capabilityMatrix: buildCapabilityMatrix(dimensions, evaluationA, evaluationB), verdict };
}

export function validateWeights(weights: ComparisonWeights): void {
  const entries = Object.entries(weights) as Array<[ComparisonDimensionName, number]>;
  for (const [name, weight] of entries) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(`${name} weight must be between 0 and 1`);
    }
  }
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error(`Comparison weights must sum to 1 (received ${total})`);
  const alternatives = entries.filter(([name]) => name !== "functionalCorrectness");
  if (alternatives.some(([, weight]) => weight >= weights.functionalCorrectness)) {
    throw new Error("Functional correctness must have the strictly dominant weight");
  }
}

function meanAttemptDuration(summary: EvaluationSummary): number | null {
  if (summary.attempts.length === 0) return null;
  return summary.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0) / summary.attempts.length;
}

function meanAttemptTokens(summary: EvaluationSummary): number | null {
  const values = summary.attempts.flatMap((attempt) => {
    const tokens = attempt.runnerResult.tokens;
    return tokens === undefined ? [] : [tokens.input + tokens.output];
  });
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function relativeEfficiency(
  valueA: number | null,
  valueB: number | null,
): readonly [number | null, number | null] {
  if (valueA === null || valueB === null) return [null, null];
  if (valueA === 0 && valueB === 0) return [1, 1];
  if (valueA === 0) return [1, 0];
  if (valueB === 0) return [0, 1];
  const best = Math.min(valueA, valueB);
  return [best / valueA, best / valueB];
}

function weightedScore(
  dimensions: readonly ComparisonDimension[],
  side: "scoreA" | "scoreB",
): number {
  return dimensions.reduce((sum, dimension) => {
    const score = dimension[side];
    return sum + (score === null ? 0 : score * dimension.effectiveWeight);
  }, 0);
}

function dimensionDetails(
  name: ComparisonDimensionName,
  evaluationA: EvaluationSummary,
  evaluationB: EvaluationSummary,
): Record<string, unknown> {
  if (name === "functionalCorrectness") {
    return {
      source: "deterministic assertion scores",
      passRateA: evaluationA.passRate,
      passRateB: evaluationB.passRate,
    };
  }
  if (name === "latency") {
    return {
      source: "mean attempt duration",
      meanMsA: meanAttemptDuration(evaluationA),
      meanMsB: meanAttemptDuration(evaluationB),
    };
  }
  if (name === "tokenEfficiency") {
    return {
      source: "mean input plus output tokens when reported",
      meanTokensA: meanAttemptTokens(evaluationA),
      meanTokensB: meanAttemptTokens(evaluationB),
    };
  }
  return { source: "unavailable in deterministic V1 scoring stage" };
}

function buildCapabilityMatrix(
  dimensions: readonly ComparisonDimension[],
  evaluationA: EvaluationSummary,
  evaluationB: EvaluationSummary,
): CapabilityMatrix {
  const casesB = new Map(evaluationB.cases.map((item) => [item.evalCaseId, item]));
  return {
    dimensions: dimensions.map((dimension) => ({
      capability: dimension.label,
      scoreA: dimension.scoreA,
      scoreB: dimension.scoreB,
      winner:
        dimension.scoreA === null || dimension.scoreB === null
          ? "unavailable"
          : dimension.scoreA === dimension.scoreB
            ? "tie"
            : dimension.scoreA > dimension.scoreB
              ? "A"
              : "B",
    })),
    evalCases: evaluationA.cases.map((caseA) => {
      const caseB = casesB.get(caseA.evalCaseId);
      if (caseB === undefined) throw new Error(`Evaluation B is missing case ${caseA.evalCaseId}`);
      return {
        capability: caseA.evalCaseId,
        scoreA: caseA.meanScore,
        scoreB: caseB.meanScore,
        winner:
          caseA.meanScore === caseB.meanScore ? "tie" : caseA.meanScore > caseB.meanScore ? "A" : "B",
      };
    }),
  };
}
