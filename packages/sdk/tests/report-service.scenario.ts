// Registered by the SDK artifact scenario suite.
import { describe, expect, it } from "vite-plus/test";

import type { ComparisonSummary } from "@skillbench/sdk/comparator";
import { ComparisonReportService } from "@skillbench/sdk/reports";
import type { ResolvedSkill } from "@skillbench/sdk/skills";

describe("ComparisonReportService ports", () => {
  it("creates and regenerates reports with its transient store", () => {
    const comparison = { runId: "comparison-run" } as ComparisonSummary;
    const skill = (id: string) =>
      ({
        skill: { name: id },
        snapshot: {
          id: `snapshot-${id}`,
          origin: { type: "local", originalInput: `./${id}` },
          rootPath: ".",
          fingerprint: `fingerprint-${id}`,
        },
      }) as ResolvedSkill;
    let id = 0;
    const service = new ComparisonReportService({
      id: () => `report-${++id}`,
      now: () => new Date(0),
      renderer: {
        version: "test-renderer-v1",
        render: (payload) => `# ${payload.sourceA.name} vs ${payload.sourceB.name}\n`,
      },
    });

    const created = service.create(comparison, skill("A"), skill("B"));
    const regenerated = service.regenerate(created.id);

    expect(created).toMatchObject({
      id: "report-1",
      title: "A vs B",
      markdown: "# A vs B\n",
      rendererVersion: "test-renderer-v1",
    });
    expect(regenerated).toMatchObject({ id: "report-2", payload: created.payload });
  });
});
