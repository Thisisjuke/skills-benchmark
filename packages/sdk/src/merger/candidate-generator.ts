import { posix } from "node:path";

import { SkillbenchError } from "../errors";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  hashBytes,
  parseSkill,
  type ResolvedSkill,
  type SkillFile,
} from "../skills";
import type { MergeCandidate, MergePlan, MergeStrategy } from "./types";

export type CandidateGeneratorOptions = {
  template: string;
  id?: () => string;
  now?: () => Date;
};

export class StructuredCandidateGenerator {
  private readonly id: () => string;
  private readonly now: () => Date;
  private readonly template: string;

  constructor(options: CandidateGeneratorOptions) {
    this.template = validateTemplate(options.template);
    this.id = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  generate(plan: MergePlan, skillA: ResolvedSkill, skillB: ResolvedSkill): MergeCandidate[] {
    if (plan.status !== "RECOMMENDED") {
      throw new SkillbenchError(plan.reason, { code: "MERGE_NOT_RECOMMENDED" });
    }
    if (plan.parentAId !== skillA.snapshot.id || plan.parentBId !== skillB.snapshot.id) {
      throw new SkillbenchError("Merge plan parents do not match candidate parents", {
        code: "MERGE_PARENTS_MISMATCH",
      });
    }
    return (["a-preserving", "balanced", "b-preserving"] as const).map((strategy) =>
      this.generateOne(strategy, plan, skillA, skillB),
    );
  }

  private generateOne(
    strategy: MergeStrategy,
    plan: MergePlan,
    skillA: ResolvedSkill,
    skillB: ResolvedSkill,
  ): MergeCandidate {
    const selected = selectFiles(strategy, skillA.snapshot.files, skillB.snapshot.files);
    const name = safeName(`${skillA.skill.name}-${skillB.skill.name}-${strategy}`);
    const description = `Structured ${strategy} merge of ${skillA.skill.name} and ${skillB.skill.name}.`;
    const skillContent = new TextEncoder().encode(
      renderSkill(this.template, name, description, strategy, plan, selected.files),
    );
    const skillFile: SkillFile = {
      relativePath: "SKILL.md",
      content: skillContent,
      contentHash: hashBytes(skillContent),
      sizeBytes: skillContent.byteLength,
    };
    const files = [skillFile, ...selected.files].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath, "en"),
    );
    validateCandidateFiles(files);
    const parsed = parseSkill(files);
    for (const reference of parsed.relativeReferences) {
      if (!files.some((file) => file.relativePath === reference)) {
        throw new SkillbenchError(`Generated candidate has a missing reference: ${reference}`, {
          code: "MERGE_CANDIDATE_INVALID",
        });
      }
    }
    return {
      id: this.id(),
      strategy,
      name: parsed.name,
      description: parsed.description,
      files,
      fingerprint: fingerprintFiles(files),
      fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
      provenance: {
        schemaVersion: 1,
        comparisonId: plan.comparisonId,
        parentAId: plan.parentAId,
        parentBId: plan.parentBId,
        strategy,
        selectedFiles: [
          { path: "SKILL.md", source: "generated" },
          ...selected.provenance,
        ],
        collisions: selected.collisions,
        generatedAt: this.now().toISOString(),
      },
    };
  }
}

function selectFiles(
  strategy: MergeStrategy,
  filesA: readonly SkillFile[],
  filesB: readonly SkillFile[],
): {
  files: SkillFile[];
  provenance: Array<{ path: string; source: "A" | "B" | "both" }>;
  collisions: Array<{ originalPath: string; resolution: string }>;
} {
  const a = new Map(filesA.filter((file) => file.relativePath !== "SKILL.md").map((file) => [file.relativePath, file]));
  const b = new Map(filesB.filter((file) => file.relativePath !== "SKILL.md").map((file) => [file.relativePath, file]));
  const output: SkillFile[] = [];
  const provenance: Array<{ path: string; source: "A" | "B" | "both" }> = [];
  const collisions: Array<{ originalPath: string; resolution: string }> = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const left = a.get(path);
    const right = b.get(path);
    if (left !== undefined && right !== undefined && left.contentHash === right.contentHash) {
      output.push(cloneFile(left, path));
      provenance.push({ path, source: "both" });
      continue;
    }
    if (left === undefined && right !== undefined) {
      output.push(cloneFile(right, path));
      provenance.push({ path, source: "B" });
      continue;
    }
    if (right === undefined && left !== undefined) {
      output.push(cloneFile(left, path));
      provenance.push({ path, source: "A" });
      continue;
    }
    if (left === undefined || right === undefined) continue;
    if (strategy === "a-preserving") {
      output.push(cloneFile(left, path));
      provenance.push({ path, source: "A" });
      collisions.push({ originalPath: path, resolution: "selected A" });
    } else if (strategy === "b-preserving") {
      output.push(cloneFile(right, path));
      provenance.push({ path, source: "B" });
      collisions.push({ originalPath: path, resolution: "selected B" });
    } else {
      const pathA = posix.join("parents", "a", path);
      const pathB = posix.join("parents", "b", path);
      output.push(cloneFile(left, pathA), cloneFile(right, pathB));
      provenance.push({ path: pathA, source: "A" }, { path: pathB, source: "B" });
      collisions.push({ originalPath: path, resolution: `preserved as ${pathA} and ${pathB}` });
    }
  }
  return { files: output, provenance, collisions };
}

function renderSkill(
  template: string,
  name: string,
  description: string,
  strategy: MergeStrategy,
  plan: MergePlan,
  files: readonly SkillFile[],
): string {
  const preferred = strategy === "a-preserving" ? plan.preserveFromA : strategy === "b-preserving" ? plan.preserveFromB : [...plan.preserveFromA, ...plan.preserveFromB];
  const conflicts = plan.resolveContradictions.map((item) => {
    const resolution = strategy === "a-preserving" ? item.valueA : strategy === "b-preserving" ? item.valueB : `reconcile A (${item.valueA}) with B (${item.valueB})`;
    return `- ${item.key}: ${resolution} [${item.evidence.reference}]`;
  });
  const links = files.map((file) => `- [${file.relativePath}](<${file.relativePath}>)`);
  const frontmatter = `---
name: ${JSON.stringify(name)}
description: ${JSON.stringify(description)}
metadata:
  mergeStrategy: ${JSON.stringify(strategy)}
  comparisonId: ${JSON.stringify(plan.comparisonId)}
---`;
  return template
    .replaceAll("{{frontmatter}}", frontmatter)
    .replaceAll("{{name}}", name)
    .replaceAll("{{summary}}", "This candidate is reconstructed from a structured development-only merge plan.")
    .replaceAll(
      "{{preserved}}",
      preferred.length === 0
        ? "- No unique recommendation."
        : preferred
            .map((item) => `- ${item.category}: ${item.value} [${item.evidence.reference}]`)
            .join("\n"),
    )
    .replaceAll(
      "{{conflicts}}",
      conflicts.length === 0 ? "- No contradiction detected." : conflicts.join("\n"),
    )
    .replaceAll("{{links}}", links.length === 0 ? "- No supporting file." : links.join("\n"));
}

const TEMPLATE_FIELDS = [
  "{{frontmatter}}",
  "{{name}}",
  "{{summary}}",
  "{{preserved}}",
  "{{conflicts}}",
  "{{links}}",
] as const;

function validateTemplate(template: string): string {
  if (template.trim() === "") throw new Error("Merge candidate template cannot be empty");
  const missing = TEMPLATE_FIELDS.filter((field) => !template.includes(field));
  if (missing.length > 0) {
    throw new Error(`Merge candidate template is missing placeholders: ${missing.join(", ")}`);
  }
  return template;
}

function validateCandidateFiles(files: readonly SkillFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    const normalized = posix.normalize(file.relativePath);
    if (
      normalized !== file.relativePath ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.startsWith("/") ||
      normalized.includes("\\") ||
      seen.has(normalized)
    ) {
      throw new SkillbenchError(`Unsafe or duplicate generated path: ${file.relativePath}`, {
        code: "MERGE_CANDIDATE_INVALID",
      });
    }
    seen.add(normalized);
    if (hashBytes(file.content) !== file.contentHash || file.content.byteLength !== file.sizeBytes) {
      throw new SkillbenchError(`Generated file metadata mismatch: ${file.relativePath}`, {
        code: "MERGE_CANDIDATE_INVALID",
      });
    }
  }
}

function cloneFile(file: SkillFile, relativePath: string): SkillFile {
  const content = file.content.slice();
  return { relativePath, content, contentHash: hashBytes(content), sizeBytes: content.byteLength };
}

function safeName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.slice(0, 100) || "skillbench-merged-skill";
}
