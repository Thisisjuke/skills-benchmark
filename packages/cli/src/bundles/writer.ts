import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  skillbenchBundleManifestSchema,
  type BundleArtifactReference,
  type BundleReportReference,
  type BundleInstructionReference,
  type BundleSourceSnapshot,
} from "@skillbench/sdk/bundles";
import { SkillbenchError } from "@skillbench/sdk/errors";
import type { MergeCandidate } from "@skillbench/sdk/merger";
import {
  createSkillbenchResultEnvelope,
  type SkillbenchOperation,
} from "@skillbench/invocation-contract";
import { parseSkillbenchOperationResult } from "@skillbench/sdk/results";
import type { StoredReport } from "@skillbench/sdk/reports";
import { hashBytes, type ResolvedSkill } from "@skillbench/sdk/skills";
import type { ProjectAsset } from "../assets";

export type BundleSource = {
  role: "skill" | "A" | "B";
  skill: ResolvedSkill;
};

export type WriteBundleInput = {
  command: SkillbenchOperation;
  jobId: string;
  output: string;
  cwd: string;
  result: unknown;
  sources: readonly BundleSource[];
  reports?: readonly StoredReport[];
  acceptedSkill?: MergeCandidate;
  instructionAssets?: readonly ProjectAsset[];
  force?: boolean;
};

export type WrittenBundle = {
  path: string;
  manifestPath: string;
};

export function writeBundle(input: WriteBundleInput): WrittenBundle {
  const destination = resolve(input.cwd, input.output);
  validateDestination(destination, input.force === true);
  mkdirSync(dirname(destination), { recursive: true });
  const staging = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  mkdirSync(staging);
  try {
    const result = parseSkillbenchOperationResult(input.command, input.result);
    const envelope = createSkillbenchResultEnvelope(input.command, result);
    const resultBytes = new TextEncoder().encode(`${JSON.stringify(envelope, null, 2)}\n`);
    writeFile(staging, "result.json", resultBytes);

    const sources = input.sources.map((source) => writeSource(staging, source));
    const reports = (input.reports ?? []).map((report) => writeReport(staging, report));
    const artifacts =
      input.acceptedSkill === undefined ? [] : writeAcceptedSkill(staging, input.acceptedSkill);
    const instructions = (input.instructionAssets ?? []).map((asset) =>
      writeInstruction(staging, asset),
    );
    const manifest = skillbenchBundleManifestSchema.parse({
      schemaVersion: 1,
      kind: "skillbench-bundle",
      status: "complete",
      command: input.command,
      jobId: input.jobId,
      createdAt: new Date().toISOString(),
      result: fileReference("result.json", resultBytes),
      sources,
      reports,
      artifacts,
      instructions,
    });
    writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (existsSync(destination)) rmSync(destination, { recursive: true });
    renameSync(staging, destination);
    return { path: destination, manifestPath: join(destination, "manifest.json") };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function writeInstruction(staging: string, asset: ProjectAsset): BundleInstructionReference {
  const path = `instructions/${safeSegment(asset.id)}/${basename(asset.path)}`;
  writeFile(staging, path, asset.content);
  return { ...fileReference(path, asset.content), id: asset.id, sourcePath: asset.path };
}

function writeSource(staging: string, source: BundleSource): BundleSourceSnapshot {
  const prefix = `sources/${source.role}`;
  const files = source.skill.snapshot.files.map((file) => {
    const path = `${prefix}/${file.relativePath}`;
    writeFile(staging, path, file.content);
    return fileReference(path, file.content);
  });
  return {
    role: source.role,
    snapshotId: source.skill.snapshot.id,
    origin: source.skill.snapshot.origin.type,
    originalInput: source.skill.snapshot.origin.originalInput,
    rootPath: source.skill.snapshot.origin.type === "local" ? "." : source.skill.snapshot.rootPath,
    fingerprint: source.skill.snapshot.fingerprint,
    fingerprintAlgorithm: "sha256-tree-v1",
    files,
  };
}

function writeReport(staging: string, report: StoredReport): BundleReportReference {
  const path = `reports/${safeSegment(report.id)}.md`;
  const bytes = new TextEncoder().encode(report.markdown);
  writeFile(staging, path, bytes);
  return { ...fileReference(path, bytes), id: report.id, mediaType: "text/markdown" };
}

function writeAcceptedSkill(staging: string, candidate: MergeCandidate): BundleArtifactReference[] {
  return candidate.files.map((file) => {
    const path = `artifacts/final/${file.relativePath}`;
    writeFile(staging, path, file.content);
    return { ...fileReference(path, file.content), kind: "skill" };
  });
}

function writeFile(root: string, relativePath: string, content: Uint8Array): void {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fileReference(path: string, bytes: Uint8Array) {
  return { path, contentHash: hashBytes(bytes), sizeBytes: bytes.byteLength };
}

function validateDestination(destination: string, force: boolean): void {
  if (!existsSync(destination)) return;
  const entries = readdirSync(destination);
  if (entries.length === 0) return;
  if (!force) {
    throw new SkillbenchError(`Bundle destination is not empty: ${destination}`, {
      code: "CLI_OUTPUT_NOT_EMPTY",
    });
  }
  try {
    const manifest = JSON.parse(readFileSync(join(destination, "manifest.json"), "utf8"));
    if (manifest?.kind !== "skillbench-bundle") throw new Error("not a bundle");
  } catch (error) {
    throw new SkillbenchError(
      `--force can only replace an existing Skillbench bundle: ${destination}`,
      { code: "CLI_OUTPUT_FORCE_UNSAFE", cause: error },
    );
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}
