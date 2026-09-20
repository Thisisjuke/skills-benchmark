import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import type { InstructionAssetReference } from "@skillbench/sdk/results";
import { hashBytes, type SkillFile } from "@skillbench/sdk/skills";
import { parse as parseYaml } from "yaml";
import * as z from "zod";

const MAX_ASSET_BYTES = 1024 * 1024;
const assetPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !isAbsolute(value), "must be relative")
  .refine((value) => !value.includes("\\"), "must use forward slashes")
  .refine(
    (value) => !value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    "must be a normalized path without traversal",
  );

export const projectAssetManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assets: z.strictObject({
    judgeSkill: assetPathSchema,
    mergeCandidateTemplate: assetPathSchema,
  }),
});

export type ProjectAsset = InstructionAssetReference & {
  absolutePath: string;
  content: Uint8Array;
  text: string;
};

export type ProjectRuntimeAssets = {
  manifestPath: string;
  judgeSkill: ProjectAsset;
  mergeCandidateTemplate: ProjectAsset;
  references: InstructionAssetReference[];
};

export function loadProjectRuntimeAssets(projectRoot: string): ProjectRuntimeAssets {
  const root = resolve(projectRoot);
  const assetsRoot = resolve(root, ".skillbench");
  const manifestPath = resolve(assetsRoot, "assets.yaml");
  let document: unknown;
  try {
    document = parseYaml(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw assetError(
      `Cannot read ${projectPath(root, manifestPath)}. Run "skillbench init --force" to restore project assets.`,
      error,
    );
  }
  const parsed = projectAssetManifestSchema.safeParse(document);
  if (!parsed.success) {
    throw assetError(
      `Invalid ${projectPath(root, manifestPath)}: ${z.prettifyError(parsed.error)}. Run "skillbench init --force" to restore it.`,
      parsed.error,
    );
  }
  const judgeSkill = loadAsset(root, assetsRoot, "judge-skill", parsed.data.assets.judgeSkill);
  const mergeCandidateTemplate = loadAsset(
    root,
    assetsRoot,
    "merge-candidate-template",
    parsed.data.assets.mergeCandidateTemplate,
  );
  return {
    manifestPath,
    judgeSkill,
    mergeCandidateTemplate,
    references: [judgeSkill, mergeCandidateTemplate].map(reference),
  };
}

export function loadProjectFileAsset(
  projectRoot: string,
  id: string,
  configuredPath: string,
): ProjectAsset {
  const root = resolve(projectRoot);
  return loadAsset(root, root, id, configuredPath);
}

export function assetSkillFile(asset: ProjectAsset): SkillFile {
  return {
    relativePath: "SKILL.md",
    content: asset.content.slice(),
    contentHash: asset.contentHash,
    sizeBytes: asset.sizeBytes,
  };
}

function loadAsset(
  projectRoot: string,
  assetsRoot: string,
  id: string,
  configuredPath: string,
): ProjectAsset {
  const absolutePath = resolve(assetsRoot, ...configuredPath.split("/"));
  if (!inside(assetsRoot, absolutePath)) {
    throw assetError(`Project asset escapes its allowed root: ${configuredPath}`);
  }
  let content: Uint8Array;
  try {
    const realAssetsRoot = realpathSync(assetsRoot);
    const realAssetPath = realpathSync(absolutePath);
    if (!inside(realAssetsRoot, realAssetPath)) {
      throw new Error("resolves outside the project skillbench directory");
    }
    const stats = statSync(realAssetPath);
    if (!stats.isFile()) throw new Error("not a regular file");
    if (stats.size > MAX_ASSET_BYTES) throw new Error(`larger than ${MAX_ASSET_BYTES} bytes`);
    content = readFileSync(realAssetPath);
  } catch (error) {
    throw assetError(
      `Cannot read required project asset ${projectPath(projectRoot, absolutePath)}. Run "skillbench init --force" to restore project assets.`,
      error,
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (error) {
    throw assetError(`Project asset must be valid UTF-8: ${configuredPath}`, error);
  }
  if (text.trim() === "") throw assetError(`Project asset cannot be empty: ${configuredPath}`);
  return {
    id,
    path: projectPath(projectRoot, absolutePath),
    absolutePath,
    content,
    text,
    contentHash: hashBytes(content),
    sizeBytes: content.byteLength,
  };
}

function reference(asset: ProjectAsset): InstructionAssetReference {
  return {
    id: asset.id,
    path: asset.path,
    contentHash: asset.contentHash,
    sizeBytes: asset.sizeBytes,
  };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function projectPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function assetError(message: string, cause?: unknown): SkillbenchError {
  return new SkillbenchError(message, {
    code: "CLI_PROJECT_ASSETS_INVALID",
    ...(cause === undefined ? {} : { cause }),
  });
}
