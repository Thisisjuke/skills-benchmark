import { EvaluationService, type EvalSuite } from "@skillbench/sdk/evaluator";
import {
  DevelopmentTournamentService,
  MergeGenerationService,
  StructuredCandidateGenerator,
  type DevelopmentTournament,
  type MergeGenerationSummary,
  type PreparedMerge,
} from "@skillbench/sdk/merger";
import type { ResolvedSkill } from "@skillbench/sdk/skills";
import { resolve } from "node:path";

import type { ApplicationContext, OperationEvents } from "../context";
import type { ExecutionRuntime } from "../../composition/execution-runtime";

export function generateMergeCandidates(input: {
  context: ApplicationContext;
  runtime: ExecutionRuntime;
  planning: PreparedMerge;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  effectiveConfig: Record<string, unknown>;
}): MergeGenerationSummary {
  return new MergeGenerationService({
    generator: new StructuredCandidateGenerator({
      template: input.runtime.instructionAssets.mergeCandidateTemplate.text,
      id: input.context.createId,
      now: input.context.now,
    }),
    id: input.context.createId,
    now: input.context.now,
  }).generate({
    plan: input.planning.plan,
    skillA: input.skillA,
    skillB: input.skillB,
    config: {
      ...input.effectiveConfig,
      executionProfile: structuredClone(input.runtime.executionProfile),
    },
  });
}

export async function runDevelopmentTournament(input: {
  context: ApplicationContext;
  events: OperationEvents;
  projectRoot: string;
  runtime: ExecutionRuntime;
  generation: MergeGenerationSummary;
  planning: PreparedMerge;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  suite: EvalSuite;
}): Promise<{
  tournament: DevelopmentTournament;
  snapshots: Map<string, ResolvedSkill>;
}> {
  const snapshots = new Map<string, ResolvedSkill>([
    [input.skillA.snapshot.id, input.skillA],
    [input.skillB.snapshot.id, input.skillB],
  ]);
  const tournament = await input.events.progress("Running development tournament", () =>
    new DevelopmentTournamentService(
      new EvaluationService(input.runtime.runner, input.runtime.assertions, {
        logger: input.context.logger,
        id: input.context.createId,
        now: input.context.now,
        workspaceParent: resolve(input.projectRoot, ".skillbench", "tmp"),
      }),
      {
        snapshotStore: {
          save: (resolvedSkill) => {
            snapshots.set(resolvedSkill.snapshot.id, resolvedSkill);
            return resolvedSkill;
          },
        },
      },
    ).run({
      generation: input.generation,
      comparison: input.planning.comparison,
      skillA: input.skillA,
      skillB: input.skillB,
      suite: input.suite,
      selectionCount: 1,
      ...(input.context.signal === undefined ? {} : { signal: input.context.signal }),
    }),
  );
  return { tournament, snapshots };
}
