import * as z from "zod";

import { sourceProviderIdSchema, type ResolvedSkill } from "./skills";
import type { ResolveOptions } from "./sources";

const inspectOriginSchema = z
  .object({
    type: sourceProviderIdSchema,
    originalInput: z.string(),
  })
  .strict();

const inspectRepositorySchema = z
  .object({
    owner: z.string(),
    name: z.string(),
    requestedRef: z.string(),
    resolvedCommit: z.string(),
  })
  .strict();

const inspectFileSchema = z
  .object({
    relativePath: z.string(),
    contentHash: z.string(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const inspectResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("inspect"),
    name: z.string(),
    description: z.string(),
    origin: inspectOriginSchema,
    repository: inspectRepositorySchema.optional(),
    rootPath: z.string(),
    files: z.array(inspectFileSchema),
    fingerprint: z.string(),
    fingerprintAlgorithm: z.string(),
    snapshotId: z.string(),
  })
  .strict();

export type InspectResult = z.infer<typeof inspectResultSchema>;

export interface InspectSource {
  resolve(input: string, options?: ResolveOptions): Promise<ResolvedSkill>;
}

export async function inspectSkill(
  source: InspectSource,
  input: string,
  options: ResolveOptions = {},
): Promise<InspectResult> {
  const resolved = await source.resolve(input, options);
  const result = {
    schemaVersion: 1,
    kind: "inspect",
    name: resolved.skill.name,
    description: resolved.skill.description,
    origin: resolved.snapshot.origin,
    ...(resolved.snapshot.repository === undefined
      ? {}
      : { repository: resolved.snapshot.repository }),
    rootPath: resolved.snapshot.rootPath,
    files: resolved.snapshot.files.map((file) => ({
      relativePath: file.relativePath,
      contentHash: file.contentHash,
      sizeBytes: file.sizeBytes,
    })),
    fingerprint: resolved.snapshot.fingerprint,
    fingerprintAlgorithm: resolved.snapshot.fingerprintAlgorithm,
    snapshotId: resolved.snapshot.id,
  } as const;

  return inspectResultSchema.parse(result);
}
