import type { HoldoutValidation } from "@skillbench/sdk/holdout";
import type {
  DevelopmentTournament,
  MergeGenerationSummary,
  PreparedMerge,
} from "@skillbench/sdk/merger";
import { mergeResultSchema, type MergeResult } from "@skillbench/sdk/results";
import { renderMergeBundleReport } from "@skillbench/sdk/reports";
import type { ResolvedSkill } from "@skillbench/sdk/skills";

import type { ApplicationContext } from "../context";
import type { ProjectAsset } from "../../assets";
import type { WrittenBundle } from "../../bundles";

export function materializeMergeNotRecommended(input: {
  context: ApplicationContext;
  projectRoot: string;
  output?: string;
  force: boolean;
  planning: PreparedMerge;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  instructionAssets: readonly ProjectAsset[];
}): { result: MergeResult; bundle?: WrittenBundle } {
  const result = mergeResultSchema.parse({
    comparisonReused: input.planning.comparisonReused,
    scope: input.planning.comparison.scope,
    plan: input.planning.plan,
    instructionAssets: input.instructionAssets.map(assetReference),
  });
  const bundle = writeMergeBundle({ ...input, result });
  return { result, ...(bundle === undefined ? {} : { bundle }) };
}

export function materializeCompletedMerge(input: {
  context: ApplicationContext;
  projectRoot: string;
  output?: string;
  force: boolean;
  planning: PreparedMerge;
  generation: MergeGenerationSummary;
  tournament: DevelopmentTournament;
  holdoutValidation?: HoldoutValidation;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  instructionAssets: readonly ProjectAsset[];
}): { result: MergeResult; bundle?: WrittenBundle } {
  const result = mergeResultSchema.parse({
    comparisonReused: input.planning.comparisonReused,
    scope: input.planning.comparison.scope,
    runId: input.generation.runId,
    comparisonId: input.generation.comparisonId,
    plan: input.generation.plan,
    instructionAssets: input.instructionAssets.map(assetReference),
    tournament: input.tournament,
    ...(input.holdoutValidation === undefined
      ? {}
      : { holdoutValidation: input.holdoutValidation }),
    candidates: input.generation.candidates.map((candidate) => ({
      id: candidate.id,
      strategy: candidate.strategy,
      name: candidate.name,
      fingerprint: candidate.fingerprint,
      files: candidate.files.map((file) => ({
        relativePath: file.relativePath,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
      })),
      provenance: candidate.provenance,
    })),
  });
  const finalSkill =
    input.holdoutValidation?.verdict.status === "ACCEPTED" &&
    input.holdoutValidation.verdict.winnerKind === "candidate"
      ? input.generation.candidates.find(
          (candidate) => candidate.id === input.holdoutValidation?.verdict.winnerId,
        )
      : undefined;
  const recommendedSkill = input.generation.candidates.find(
    (candidate) => candidate.id === input.tournament.selectedCandidateIds[0],
  );
  if (recommendedSkill === undefined) {
    throw new Error("Development tournament selected an unknown merge candidate");
  }
  const bundle = writeMergeBundle({
    ...input,
    result,
    recommendedSkill,
    finalSkill,
  });
  return { result, ...(bundle === undefined ? {} : { bundle }) };
}

export function assetReference({
  id,
  path,
  contentHash,
  sizeBytes,
}: ProjectAsset) {
  return { id, path, contentHash, sizeBytes };
}

function writeMergeBundle(input: {
  context: ApplicationContext;
  projectRoot: string;
  output?: string;
  force: boolean;
  result: MergeResult;
  skillA: ResolvedSkill;
  skillB: ResolvedSkill;
  instructionAssets: readonly ProjectAsset[];
  generation?: MergeGenerationSummary;
  recommendedSkill?: Parameters<ApplicationContext["writeBundle"]>[0]["recommendedSkill"];
  finalSkill?: Parameters<ApplicationContext["writeBundle"]>[0]["finalSkill"];
}): WrittenBundle | undefined {
  if (input.output === undefined) return undefined;
  return input.context.writeBundle({
    cwd: input.projectRoot,
    command: "merge",
    output: input.output,
    result: input.result,
    sources: [
      { role: "A", skill: input.skillA },
      { role: "B", skill: input.skillB },
    ],
    reportMarkdown: renderMergeBundleReport(input.result),
    ...(input.generation === undefined ? {} : { candidates: input.generation.candidates }),
    ...(input.recommendedSkill === undefined
      ? {}
      : { recommendedSkill: input.recommendedSkill }),
    ...(input.finalSkill === undefined ? {} : { finalSkill: input.finalSkill }),
    instructionAssets: input.instructionAssets,
    force: input.force,
  });
}
