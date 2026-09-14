import type { EvalSuite } from "../evaluator";
import type { ParsedSkill } from "../skills";
import type { ScopeAnalysis, ScopeCompatibility } from "./types";

const STOP_WORDS = new Set([
  "and",
  "avec",
  "dans",
  "des",
  "for",
  "from",
  "les",
  "pour",
  "skill",
  "the",
  "this",
  "une",
  "with",
]);

export class ScopeAnalyzer {
  analyze(skillA: ParsedSkill, skillB: ParsedSkill, suite: EvalSuite): ScopeAnalysis {
    const capabilitiesA = profile(skillA);
    const capabilitiesB = profile(skillB);
    const shared = intersection(capabilitiesA, capabilitiesB);
    const specificToA = difference(capabilitiesA, capabilitiesB);
    const specificToB = difference(capabilitiesB, capabilitiesA);
    const unionSize = new Set([...capabilitiesA, ...capabilitiesB]).size;
    const similarity = unionSize === 0 ? 0 : shared.length / unionSize;
    const compatibility: ScopeCompatibility =
      similarity >= 0.6 ? "HIGH" : similarity >= 0.2 ? "PARTIAL" : "LOW";
    const distanceToBoundary = Math.min(Math.abs(similarity - 0.2), Math.abs(similarity - 0.6));
    const evidence = Math.min(1, unionSize / 8);
    const confidence = clamp(0.5 + evidence * 0.3 + Math.min(0.2, distanceToBoundary), 0, 1);
    const evaluatedCapabilities = sorted(
      new Set(suite.cases.flatMap((evalCase) => tokenize(`${evalCase.id} ${evalCase.name}`))),
    );

    return {
      compatibility,
      confidence,
      shared,
      specificToA,
      specificToB,
      evaluatedCapabilities,
      reasons: [
        `${shared.length} shared scope term(s) across ${unionSize} distinct term(s).`,
        `The selected suite covers ${evaluatedCapabilities.length} named capability term(s).`,
        ...(compatibility === "LOW"
          ? ["Comparison remains possible, but a universal winner must not be inferred."]
          : []),
      ],
    };
  }
}

function profile(skill: ParsedSkill): string[] {
  const explicit = [
    ...metadataStrings(skill.metadata.capabilities),
    ...metadataStrings(skill.metadata.tags),
    ...metadataStrings(skill.metadata.category),
  ];
  const values = explicit.length > 0 ? explicit : tokenize(`${skill.name} ${skill.description}`);
  return sorted(new Set(values.flatMap((value) => tokenize(value))));
}

function metadataStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function tokenize(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function intersection(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function sorted(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
