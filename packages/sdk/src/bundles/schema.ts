import { posix } from "node:path";

import * as z from "zod";

import {
  skillbenchOperationSchema,
  skillbenchResultEnvelopeSchema,
} from "@skillbench/invocation-contract";
import { sourceProviderIdSchema } from "../skills";

export const SKILLBENCH_BUNDLE_VERSION = 1 as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "Expected a lowercase SHA-256 digest");

export const bundleRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\\"), "Bundle paths must use forward slashes")
  .refine(
    (value) =>
      !value.startsWith("/") &&
      value !== "." &&
      value !== ".." &&
      posix.normalize(value) === value &&
      !value.split("/").includes(".."),
    "Bundle path must be a normalized relative path",
  );

export const bundleFileReferenceSchema = z.strictObject({
  path: bundleRelativePathSchema,
  contentHash: sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});

export const bundleSourceSnapshotSchema = z.strictObject({
  role: z.enum(["skill", "A", "B"]),
  snapshotId: z.string().min(1),
  origin: sourceProviderIdSchema,
  originalInput: z.string().min(1),
  rootPath: z.union([z.literal("."), bundleRelativePathSchema]),
  fingerprint: sha256Schema,
  fingerprintAlgorithm: z.literal("sha256-tree-v1"),
  files: z.array(bundleFileReferenceSchema),
});

export const bundleReportReferenceSchema = bundleFileReferenceSchema.extend({
  id: z.string().min(1),
  mediaType: z.literal("text/markdown"),
});

export const bundleArtifactReferenceSchema = bundleFileReferenceSchema.extend({
  kind: z.enum(["file", "skill"]),
});

export const bundleInstructionReferenceSchema = bundleFileReferenceSchema.extend({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
});

export const skillbenchBundleManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(SKILLBENCH_BUNDLE_VERSION),
    kind: z.literal("skillbench-bundle"),
    status: z.literal("complete"),
    command: skillbenchOperationSchema,
    jobId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    result: bundleFileReferenceSchema.extend({ path: z.literal("result.json") }),
    sources: z.array(bundleSourceSnapshotSchema),
    reports: z.array(bundleReportReferenceSchema),
    artifacts: z.array(bundleArtifactReferenceSchema),
    instructions: z.array(bundleInstructionReferenceSchema).default([]),
  })
  .superRefine((manifest, context) => {
    const roles = manifest.sources.map((source) => source.role);
    const expectedRoles =
      manifest.command === "inspect" || manifest.command === "eval" ? ["skill"] : ["A", "B"];
    if (
      roles.length !== expectedRoles.length ||
      expectedRoles.some((role) => !roles.includes(role as (typeof roles)[number]))
    ) {
      context.addIssue({
        code: "custom",
        message: `Bundle ${manifest.command} sources must have roles: ${expectedRoles.join(", ")}`,
        path: ["sources"],
      });
    }
    const paths = [
      manifest.result.path,
      ...manifest.sources.flatMap((source) => source.files.map((file) => file.path)),
      ...manifest.reports.map((report) => report.path),
      ...manifest.artifacts.map((artifact) => artifact.path),
      ...manifest.instructions.map((instruction) => instruction.path),
    ];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) {
        context.addIssue({
          code: "custom",
          message: `Bundle path is declared more than once: ${path}`,
          path: ["result"],
        });
      }
      seen.add(path);
    }
  });

export const skillbenchBundleDocumentSchema = z
  .strictObject({
    manifest: skillbenchBundleManifestSchema,
    result: skillbenchResultEnvelopeSchema,
  })
  .superRefine(({ manifest, result }, context) => {
    if (manifest.command !== result.command) {
      context.addIssue({
        code: "custom",
        message: `Bundle command ${manifest.command} does not match result command ${result.command}`,
        path: ["result", "command"],
      });
    }
  });

export type BundleFileReference = z.infer<typeof bundleFileReferenceSchema>;
export type BundleSourceSnapshot = z.infer<typeof bundleSourceSnapshotSchema>;
export type BundleReportReference = z.infer<typeof bundleReportReferenceSchema>;
export type BundleArtifactReference = z.infer<typeof bundleArtifactReferenceSchema>;
export type BundleInstructionReference = z.infer<typeof bundleInstructionReferenceSchema>;
export type SkillbenchBundleManifest = z.infer<typeof skillbenchBundleManifestSchema>;
export type SkillbenchBundleDocument = z.infer<typeof skillbenchBundleDocumentSchema>;
