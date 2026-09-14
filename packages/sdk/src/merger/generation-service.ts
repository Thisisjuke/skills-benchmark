import type { ResolvedSkill } from "../skills";
import { StructuredCandidateGenerator } from "./candidate-generator";
import { transientMergeGenerationStore, type MergeGenerationStore } from "./store";
import type { MergeGenerationSummary, MergePlan } from "./types";

export type GenerateMergeInput = {
  plan: MergePlan;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  config: Record<string, unknown>;
};

export type MergeGenerationServiceOptions = {
  generator: StructuredCandidateGenerator;
  id?: () => string;
  now?: () => Date;
  store?: MergeGenerationStore;
};

export class MergeGenerationService {
  private readonly id: () => string;
  private readonly now: () => Date;

  private readonly generator: StructuredCandidateGenerator;
  private readonly store: MergeGenerationStore;

  constructor(options: MergeGenerationServiceOptions) {
    this.id = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.generator = options.generator;
    this.store = options.store ?? transientMergeGenerationStore;
  }

  generate(input: GenerateMergeInput): MergeGenerationSummary {
    const runId = this.id();
    const createdAt = this.now().toISOString();
    this.store.createRun({ id: runId, comparisonId: input.plan.comparisonId, config: input.config, createdAt });
    try {
      const summary: MergeGenerationSummary = {
        runId,
        comparisonId: input.plan.comparisonId,
        plan: input.plan,
        candidates: this.generator.generate(input.plan, input.skillA, input.skillB),
        createdAt,
        finishedAt: this.now().toISOString(),
      };
      this.store.completeGeneration(summary);
      return summary;
    } catch (error) {
      this.store.failRun(runId, error, this.now().toISOString());
      throw error;
    }
  }
}
