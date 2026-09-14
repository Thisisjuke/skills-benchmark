import type { HoldoutValidation } from "@skillbench/sdk/holdout";
import type {
  DevelopmentTournament,
  MergeGenerationSummary,
  PreparedMerge,
} from "@skillbench/sdk/merger";
import { mergeResultSchema, type MergeResult } from "@skillbench/sdk/results";
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
  const acceptedSkill =
    input.holdoutValidation?.verdict.winnerKind === "candidate"
      ? input.generation.candidates.find(
          (candidate) => candidate.id === input.holdoutValidation?.verdict.winnerId,
        )
      : undefined;
  const bundle = writeMergeBundle({ ...input, result, acceptedSkill });
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
  acceptedSkill?: Parameters<ApplicationContext["writeBundle"]>[0]["acceptedSkill"];
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
    ...(input.acceptedSkill === undefined ? {} : { acceptedSkill: input.acceptedSkill }),
    instructionAssets: input.instructionAssets,
    force: input.force,
  });
}
