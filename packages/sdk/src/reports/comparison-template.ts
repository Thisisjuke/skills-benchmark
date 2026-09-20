import { SkillbenchError } from "../errors";
import type { ComparisonReportPayloadV1 } from "./types";
import type { ReportRenderer } from "./service";

type TemplateValue = string | TemplateView | readonly TemplateView[];
type TemplateView = { [key: string]: TemplateValue };

export function createComparisonTemplateRenderer(
  template: string,
  contentHash: string,
): ReportRenderer {
  if (template.trim() === "") throw templateError("Comparison report template cannot be empty");
  validateTemplate(template);
  return {
    version: `comparison-template-v1:${contentHash.slice(0, 12)}`,
    render: (payload) => `${renderBlock(template, reportView(payload), [])}`,
  };
}

function reportView(payload: ComparisonReportPayloadV1): TemplateView {
  const { comparison, sourceA, sourceB } = payload;
  return {
    schemaVersion: String(payload.schemaVersion),
    sourceA: sourceView(sourceA),
    sourceB: sourceView(sourceB),
    scope: {
      compatibility: comparison.scope.compatibility,
      confidence: percent(comparison.scope.confidence),
      shared: list(comparison.scope.shared),
      specificToA: list(comparison.scope.specificToA),
      specificToB: list(comparison.scope.specificToB),
      reasons: comparison.scope.reasons.map((reason) => ({ value: reason })),
    },
    verdict: {
      winner: comparison.verdict.winner,
      scoreA: percent(comparison.verdict.scoreA),
      scoreB: percent(comparison.verdict.scoreB),
      tieThreshold: percent(comparison.verdict.tieThreshold),
      statement: comparison.verdict.statement,
    },
    dimensions: comparison.dimensions.map((dimension) => ({
      label: dimension.label,
      scoreA: score(dimension.scoreA),
      scoreB: score(dimension.scoreB),
      winner: dimensionWinner(dimension.scoreA, dimension.scoreB),
      effectiveWeight: percent(dimension.effectiveWeight),
    })),
    capabilities: comparison.capabilityMatrix.evalCases.map((capability) => ({
      capability: capability.capability,
      scoreA: score(capability.scoreA),
      scoreB: score(capability.scoreB),
      winner: capability.winner,
    })),
    judgments: comparison.judgments.map((judgment) => ({
      evalCaseId: judgment.evalCaseId,
      winner: judgment.result.winner,
      confidence: percent(judgment.result.confidence),
      reasons: judgment.result.reasons.join(" "),
    })),
    run: {
      comparisonId: comparison.runId,
      evaluationAId: comparison.evaluationA.runId,
      evaluationBId: comparison.evaluationB.runId,
      suiteId: comparison.plan.suiteId,
      partition: comparison.plan.partition,
      runnerType: comparison.plan.runnerType,
      runnerVersion: comparison.plan.executionProfile.runnerVersion,
      repeat: String(comparison.plan.repeat),
      timeoutMs: String(comparison.plan.timeoutMs),
    },
  };
}

function sourceView(source: ComparisonReportPayloadV1["sourceA"]): TemplateView {
  return {
    name: source.name,
    origin: source.origin,
    originalInput: source.originalInput,
    rootPath: source.rootPath,
    fingerprint: source.fingerprint,
    snapshotId: source.snapshotId,
    repository:
      source.repository === undefined
        ? []
        : [{
            owner: source.repository.owner,
            name: source.repository.name,
            requestedRef: source.repository.requestedRef,
            resolvedCommit: source.repository.resolvedCommit,
          }],
  };
}

function validateTemplate(template: string): void {
  const tags = [...template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)].map((match) => match[1]!.trim());
  const stack: string[] = [];
  for (const tag of tags) {
    if (tag.startsWith("#") || tag.startsWith("^")) stack.push(tag.slice(1).trim());
    if (!tag.startsWith("/")) continue;
    const expected = stack.pop();
    if (expected !== tag.slice(1).trim()) throw templateError(`Unbalanced template section: ${tag}`);
  }
  if (stack.length > 0) throw templateError(`Unclosed template section: ${stack.at(-1)}`);
  if (/\{\{\{|\}\}\}/u.test(template)) throw templateError("Triple-brace variables are not supported");
}

function renderBlock(template: string, view: TemplateView, parents: readonly TemplateView[]): string {
  const section = /\{\{\s*([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/gu;
  let rendered = template.replace(section, (_match, mode: string, name: string, body: string) => {
    const value = lookup(name, view, parents);
    if (value === undefined) throw templateError(`Unknown template section: ${name}`);
    const values = Array.isArray(value) ? value : [];
    if (mode === "^") return values.length === 0 ? renderBlock(body, view, parents) : "";
    return values.map((child) => renderBlock(body, child, [view, ...parents])).join("");
  });
  rendered = rendered.replace(/\{\{\s*([\w.]+)\s*\}\}/gu, (_match, name: string) => {
    const value = lookup(name, view, parents);
    if (value === undefined) throw templateError(`Unknown template variable: ${name}`);
    if (typeof value !== "string") throw templateError(`Template variable is not scalar: ${name}`);
    return escapeMarkdown(value);
  });
  if (/\{\{\s*[#^/]?/u.test(rendered)) throw templateError("Invalid or nested template section");
  return rendered;
}

function lookup(name: string, view: TemplateView, parents: readonly TemplateView[]): TemplateValue | undefined {
  for (const candidate of [view, ...parents]) {
    let current: TemplateValue | TemplateView | undefined = candidate;
    for (const segment of name.split(".")) {
      if (Array.isArray(current) || typeof current === "string" || current === undefined) {
        current = undefined;
        break;
      }
      current = (current as TemplateView)[segment];
    }
    if (current !== undefined) return current as TemplateValue;
  }
  return undefined;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_[\]<>|]/gu, "\\$&").replace(/[\r\n]+/gu, " ").trim();
}

function dimensionWinner(left: number | null, right: number | null): string {
  if (left === null || right === null) return "unavailable";
  return left === right ? "tie" : left > right ? "A" : "B";
}

function score(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function list(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function templateError(message: string): SkillbenchError {
  return new SkillbenchError(message, { code: "REPORT_TEMPLATE_INVALID" });
}
