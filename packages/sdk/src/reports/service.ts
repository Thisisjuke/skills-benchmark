import type { ComparisonSummary } from "../comparator";
import { SkillbenchError } from "../errors";
import type { ResolvedSkill } from "../skills";
import { COMPARISON_RENDERER_VERSION, renderComparisonReport } from "./comparison-renderer";
import { createTransientReportStore, type ReportStore } from "./store";
import type { ComparisonReportPayloadV1, ReportSource, StoredReport } from "./types";

export type ReportServiceOptions = {
  id?: () => string;
  now?: () => Date;
  renderer?: ReportRenderer;
  store?: ReportStore;
};

export type ReportRenderer = {
  version: string;
  render(payload: ComparisonReportPayloadV1): string;
};

export class ComparisonReportService {
  private readonly id: () => string;
  private readonly now: () => Date;
  private readonly renderer: ReportRenderer;
  private readonly store: ReportStore;

  constructor(options: ReportServiceOptions = {}) {
    this.id = options.id ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.store = options.store ?? createTransientReportStore();
    this.renderer = options.renderer ?? {
      version: COMPARISON_RENDERER_VERSION,
      render: renderComparisonReport,
    };
  }

  create(
    comparison: ComparisonSummary,
    skillA: ResolvedSkill,
    skillB: ResolvedSkill,
  ): StoredReport {
    const payload: ComparisonReportPayloadV1 = {
      schemaVersion: 1,
      comparison,
      sourceA: reportSource(skillA),
      sourceB: reportSource(skillB),
    };
    const report: StoredReport = {
      id: this.id(),
      runId: comparison.runId,
      type: "comparison",
      title: `${skillA.skill.name} vs ${skillB.skill.name}`,
      markdown: this.renderer.render(payload),
      payload,
      rendererVersion: this.renderer.version,
      createdAt: this.now().toISOString(),
    };
    this.store.save(report);
    return report;
  }

  regenerate(reportId: string): StoredReport {
    const original = this.store.get(reportId);
    assertSupportedPayload(original.payload);
    const regenerated: StoredReport = {
      id: this.id(),
      runId: original.runId,
      type: original.type,
      title: original.title,
      markdown: this.renderer.render(original.payload),
      payload: structuredClone(original.payload),
      rendererVersion: this.renderer.version,
      createdAt: this.now().toISOString(),
    };
    this.store.save(regenerated);
    return regenerated;
  }
}

function assertSupportedPayload(payload: ComparisonReportPayloadV1): void {
  if ((payload as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new SkillbenchError(
      `Unsupported comparison report schema: ${String((payload as { schemaVersion?: unknown }).schemaVersion)}`,
      { code: "REPORT_SCHEMA_UNSUPPORTED" },
    );
  }
}

function reportSource(skill: ResolvedSkill): ReportSource {
  return {
    name: skill.skill.name,
    origin: skill.snapshot.origin.type,
    originalInput: skill.snapshot.origin.originalInput,
    rootPath: skill.snapshot.rootPath,
    fingerprint: skill.snapshot.fingerprint,
    snapshotId: skill.snapshot.id,
    ...(skill.snapshot.repository === undefined ? {} : { repository: skill.snapshot.repository }),
  };
}
