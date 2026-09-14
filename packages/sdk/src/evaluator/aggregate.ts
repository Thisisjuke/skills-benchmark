import type { EvalAttempt, EvalCaseSummary } from "./types";

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

export function aggregateCase(
  evalCaseId: string,
  attempts: readonly EvalAttempt[],
): EvalCaseSummary {
  const scores = attempts.map((attempt) => attempt.score);
  const durations = attempts.map((attempt) => attempt.durationMs);
  const tokenValues = attempts.flatMap((attempt) =>
    attempt.runnerResult.tokens === undefined ? [] : [attempt.runnerResult.tokens],
  );
  return {
    evalCaseId,
    attempts: attempts.length,
    completedAttempts: attempts.filter((attempt) => attempt.status === "completed").length,
    passRate:
      attempts.length === 0
        ? 0
        : attempts.filter((attempt) => attempt.passed).length / attempts.length,
    meanScore: mean(scores),
    medianScore: median(scores),
    scoreVariance: variance(scores),
    meanDurationMs: mean(durations),
    ...(tokenValues.length === 0
      ? {}
      : {
          tokens: {
            input: tokenValues.reduce((sum, value) => sum + value.input, 0),
            output: tokenValues.reduce((sum, value) => sum + value.output, 0),
          },
        }),
  };
}

export function meanScore(attempts: readonly EvalAttempt[]): number {
  return mean(attempts.map((attempt) => attempt.score));
}
