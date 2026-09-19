import type { ResolvedSkill } from "../skills";
import type {
  DevelopmentEvidence,
  MergeContradiction,
  MergeEvidenceReference,
  MergePlan,
  MergeRecommendation,
} from "./types";

type Instruction = { key: string; value: string };

export class CapabilityExtractor {
  extract(
    evidence: DevelopmentEvidence,
    skillA: ResolvedSkill,
    skillB: ResolvedSkill,
  ): MergePlan {
    if (
      evidence.snapshotAId !== skillA.snapshot.id ||
      evidence.snapshotBId !== skillB.snapshot.id
    ) {
      throw new Error("Development comparison parents do not match merge parents");
    }
    const preserveFromA: MergeRecommendation[] = [];
    const preserveFromB: MergeRecommendation[] = [];
    const discard: MergeRecommendation[] = [];

    for (const capability of evidence.scope.specificToA) {
      preserveFromA.push(recommendation("capability", capability, "scope:specific-to-a"));
    }
    for (const capability of evidence.scope.specificToB) {
      preserveFromB.push(recommendation("capability", capability, "scope:specific-to-b"));
    }
    for (const row of evidence.capabilityMatrix.evalCases) {
      const proof: MergeEvidenceReference = {
        source: "development",
        reference: `eval:${row.capability}`,
        scoreA: row.scoreA,
        scoreB: row.scoreB,
      };
      if (row.winner === "A") preserveFromA.push({ category: "capability", value: row.capability, evidence: proof });
      else if (row.winner === "B") preserveFromB.push({ category: "capability", value: row.capability, evidence: proof });
      else discard.push({ category: "duplicate", value: row.capability, evidence: proof });
    }

    const fileA = new Map(skillA.snapshot.files.map((file) => [file.relativePath, file]));
    const fileB = new Map(skillB.snapshot.files.map((file) => [file.relativePath, file]));
    for (const path of [...new Set([...fileA.keys(), ...fileB.keys()])].sort()) {
      if (path === "SKILL.md") continue;
      const left = fileA.get(path);
      const right = fileB.get(path);
      const category = fileCategory(path);
      if (left !== undefined && right !== undefined && left.contentHash === right.contentHash) {
        discard.push(recommendation("duplicate", path, `file:${path}`));
      } else {
        if (left !== undefined) preserveFromA.push(recommendation(category, path, `file-a:${path}`));
        if (right !== undefined) preserveFromB.push(recommendation(category, path, `file-b:${path}`));
      }
    }

    const instructionsA = instructions(skillA);
    const instructionsB = instructions(skillB);
    const resolveContradictions: MergeContradiction[] = [];
    for (const key of [...new Set([...instructionsA.keys(), ...instructionsB.keys()])].sort()) {
      const left = instructionsA.get(key);
      const right = instructionsB.get(key);
      if (left !== undefined && right !== undefined) {
        if (left.value === right.value) {
          discard.push(recommendation("duplicate", `${key}: ${left.value}`, `instruction:${key}`));
        } else {
          resolveContradictions.push({
            key,
            valueA: left.value,
            valueB: right.value,
            evidence: { source: "static-analysis", reference: `instruction:${key}` },
          });
        }
      } else if (left !== undefined) {
        preserveFromA.push(recommendation("instruction", `${key}: ${left.value}`, `instruction-a:${key}`));
      } else if (right !== undefined) {
        preserveFromB.push(recommendation("instruction", `${key}: ${right.value}`, `instruction-b:${key}`));
      }
    }

    const recommended = evidence.scope.compatibility !== "LOW";
    return {
      schemaVersion: 1,
      status: recommended ? "RECOMMENDED" : "MERGE_NOT_RECOMMENDED",
      reason: recommended
        ? "The development comparison identifies compatible or complementary evidence."
        : "No merged skill was generated because the sources address different task categories. Keep them separate, narrow them to a shared responsibility, or add development evals for a genuinely shared task.",
      comparisonId: evidence.comparisonId,
      comparisonRunId: evidence.comparisonRunId,
      parentAId: evidence.snapshotAId,
      parentBId: evidence.snapshotBId,
      preserveFromA: uniqueRecommendations(preserveFromA),
      preserveFromB: uniqueRecommendations(preserveFromB),
      resolveContradictions,
      discard: uniqueRecommendations(discard),
    };
  }
}

function recommendation(
  category: MergeRecommendation["category"],
  value: string,
  reference: string,
): MergeRecommendation {
  return { category, value, evidence: { source: "static-analysis", reference } };
}

function fileCategory(path: string): MergeRecommendation["category"] {
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("references/")) return "reference";
  return "asset";
}

function instructions(skill: ResolvedSkill): Map<string, Instruction> {
  const result = new Map<string, Instruction>();
  const explicit = skill.skill.metadata.instructions;
  if (explicit !== null && typeof explicit === "object" && !Array.isArray(explicit)) {
    for (const [key, value] of Object.entries(explicit)) {
      if (typeof value === "string") result.set(normalize(key), { key: normalize(key), value: value.trim() });
    }
  }
  for (const line of skill.skill.markdown.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z0-9 _-]{1,40})\s*:\s*(.+)$/u);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const key = normalize(match[1]);
    if (!result.has(key)) result.set(key, { key, value: match[2].trim() });
  }
  return result;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

function uniqueRecommendations(values: MergeRecommendation[]): MergeRecommendation[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.category}\0${value.value}\0${value.evidence.reference}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
