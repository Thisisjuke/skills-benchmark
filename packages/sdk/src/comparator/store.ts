import type { BlindPairwiseInput, BlindPairwiseResult } from "../judge";
import type { ComparisonSummary } from "./types";

export type CreateComparisonRunInput = {
  id: string;
  config: Record<string, unknown>;
  createdAt: string;
};

export interface ComparisonJudge {
  compare(input: BlindPairwiseInput): Promise<BlindPairwiseResult>;
}

export interface ComparisonStore {
  createRun(input: CreateComparisonRunInput): void;
  complete(summary: ComparisonSummary): void;
  failRun(runId: string, error: unknown, finishedAt: string): void;
}

export const transientComparisonStore: ComparisonStore = Object.freeze({
  createRun: () => undefined,
  complete: () => undefined,
  failRun: () => undefined,
});
