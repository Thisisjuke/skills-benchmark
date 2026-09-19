// Registered by the SDK merge scenario suite.
import { describe, expect, it } from "vite-plus/test";

const MERGE_TEMPLATE = `{{frontmatter}}

# {{name}}

{{summary}}

## Capabilities

{{preserved}}

## Conflicts

{{conflicts}}

## Files

{{links}}
`;

import type { ComparisonSummary } from "@skillbench/sdk/comparator";
import {
  CapabilityExtractor,
  MergeGenerationService,
  MergePlanningService,
  StructuredCandidateGenerator,
  projectDevelopmentEvidence,
  rankTournamentEntries,
  type MergeComparisonResolver,
  type TournamentEntry,
} from "@skillbench/sdk/merger";
import { MOCK_EXECUTION_PROFILE } from "@skillbench/sdk/runners";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  hashBytes,
  parseSkill,
  type ResolvedSkill,
  type SkillFile,
} from "@skillbench/sdk/skills";

function file(relativePath: string, value: string): SkillFile {
  const content = new TextEncoder().encode(value);
  return { relativePath, content, contentHash: hashBytes(content), sizeBytes: content.byteLength };
}

function skill(
  id: string,
  capabilities: string[],
  instructions: Record<string, string>,
  extraFiles: SkillFile[] = [],
): ResolvedSkill {
  const skillFile = file("SKILL.md", `---\nname: ${id}\ndescription: ${id}\n---\n\n# ${id}\n`);
  const files = [skillFile, ...extraFiles];
  return {
    skill: {
      name: id,
      description: id,
      metadata: { capabilities, instructions },
      markdown: `# ${id}\n`,
      relativeReferences: [],
    },
    snapshot: {
      id,
      origin: { type: "local", originalInput: `./${id}` },
      rootPath: ".",
      files,
      fingerprint: fingerprintFiles(files),
      fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
      fetchedAt: "2026-09-03T00:00:00.000Z",
    },
  };
}

function comparison(
  skillA: ResolvedSkill,
  skillB: ResolvedSkill,
  compatibility: "HIGH" | "PARTIAL" | "LOW" = "PARTIAL",
): ComparisonSummary {
  return {
    comparisonId: "comparison-id",
    runId: "comparison-run",
    snapshotAId: skillA.snapshot.id,
    snapshotBId: skillB.snapshot.id,
    plan: {
      suiteId: "development-suite",
      partition: "development",
      repeat: 2,
      timeoutMs: 100,
      runnerType: "mock",
      executionProfile: MOCK_EXECUTION_PROFILE,
      permissions: { schemaVersion: 1 },
      effectiveConfig: { excludedRawCanary: "HOLDOUT_CANARY" },
    },
    scope: {
      compatibility,
      confidence: 0.8,
      shared: compatibility === "LOW" ? [] : ["shared"],
      specificToA: ["accessibility"],
      specificToB: ["performance"],
      evaluatedCapabilities: ["render"],
      reasons: [],
    },
    dimensions: [
      {
        name: "functionalCorrectness",
        label: "Functional correctness",
        configuredWeight: 1,
        effectiveWeight: 1,
        scoreA: 0.9,
        scoreB: 0.8,
        available: true,
        details: { excludedRawCanary: "HOLDOUT_CANARY" },
      },
    ],
    capabilityMatrix: {
      dimensions: [],
      evalCases: [
        { capability: "accessibility-case", scoreA: 1, scoreB: 0.5, winner: "A" },
        { capability: "performance-case", scoreA: 0.5, scoreB: 1, winner: "B" },
        { capability: "shared-case", scoreA: 1, scoreB: 1, winner: "tie" },
      ],
    },
    judgments: [],
    verdict: {
      winner: "A",
      scoreA: 0.9,
      scoreB: 0.8,
      difference: 0.1,
      tieThreshold: 0.01,
      statement: "development only",
    },
    evaluationA: { attempts: [{ runnerResult: { stdout: "HOLDOUT_CANARY" } }] },
    evaluationB: { attempts: [] },
    createdAt: "2026-09-03T00:00:00.000Z",
    finishedAt: "2026-09-03T00:00:01.000Z",
  } as unknown as ComparisonSummary;
}

describe("merge development evidence", () => {
  it("excludes raw runs, prompts, config and holdout-shaped canaries", () => {
    const a = skill("a", [], {});
    const b = skill("b", [], {});
    const evidence = projectDevelopmentEvidence(comparison(a, b));
    expect(JSON.stringify(evidence)).not.toContain("HOLDOUT_CANARY");
    expect(evidence.partition).toBe("development");
    expect(evidence).not.toHaveProperty("evaluationA");
    expect(evidence).not.toHaveProperty("effectiveConfig");
  });

  it("rejects any comparison whose declared partition is holdout", () => {
    const a = skill("a", [], {});
    const b = skill("b", [], {});
    const summary = comparison(a, b);
    summary.plan.partition = "holdout";
    expect(() => projectDevelopmentEvidence(summary)).toThrow(/development comparison/u);
  });
});

describe("CapabilityExtractor", () => {
  it("links complementary files/capabilities to evidence and identifies contradictions", () => {
    const common = file("references/common.md", "same");
    const a = skill("a", ["accessibility"], { format: "concise", language: "French" }, [
      common,
      file("scripts/a.ts", "A"),
      file("assets/data.bin", "\u0000A"),
    ]);
    const b = skill("b", ["performance"], { format: "detailed", language: "French" }, [
      common,
      file("references/b.md", "B"),
    ]);
    const plan = new CapabilityExtractor().extract(
      projectDevelopmentEvidence(comparison(a, b)),
      a,
      b,
    );

    expect(plan.status).toBe("RECOMMENDED");
    expect(plan.preserveFromA).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "script", value: "scripts/a.ts" }),
        expect.objectContaining({ category: "asset", value: "assets/data.bin" }),
        expect.objectContaining({
          value: "accessibility-case",
          evidence: {
            source: "development",
            reference: "eval:accessibility-case",
            scoreA: 1,
            scoreB: 0.5,
          },
        }),
      ]),
    );
    expect(plan.preserveFromB).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "reference", value: "references/b.md" }),
      ]),
    );
    expect(plan.resolveContradictions).toEqual([
      expect.objectContaining({ key: "format", valueA: "concise", valueB: "detailed" }),
    ]);
    expect(plan.discard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "duplicate", value: "references/common.md" }),
        expect.objectContaining({ category: "duplicate", value: "language: French" }),
        expect.objectContaining({ category: "duplicate", value: "shared-case" }),
      ]),
    );
    for (const item of [...plan.preserveFromA, ...plan.preserveFromB, ...plan.discard]) {
      expect(item.evidence.reference).not.toBe("");
    }
  });

  it("does not recommend merging disjoint scopes", () => {
    const a = skill("a", ["accessibility"], {});
    const b = skill("b", ["database"], {});
    const plan = new CapabilityExtractor().extract(
      projectDevelopmentEvidence(comparison(a, b, "LOW")),
      a,
      b,
    );
    expect(plan.status).toBe("MERGE_NOT_RECOMMENDED");
    expect(plan.reason).toContain("different task categories");
    expect(plan.reason).toContain("add development evals");
  });
});

describe("MergePlanningService", () => {
  it("reuses a compatible comparison and creates one when lookup is incompatible", async () => {
    const a = skill("a", [], {});
    const b = skill("b", [], {});
    const compatible = comparison(a, b);
    let creates = 0;
    const reusable: MergeComparisonResolver = {
      findCompatible: async () => compatible,
      createDevelopmentComparison: async () => {
        creates += 1;
        return compatible;
      },
    };
    expect(
      await new MergePlanningService(reusable).prepare({
        skillA: a,
        skillB: b,
        comparisonPlan: compatible.plan,
      }),
    ).toMatchObject({ comparisonReused: true });
    expect(creates).toBe(0);

    const incompatible = structuredClone(compatible);
    incompatible.plan.suiteId = "other-suite";
    const creating: MergeComparisonResolver = {
      findCompatible: async () => incompatible,
      createDevelopmentComparison: async () => {
        creates += 1;
        return compatible;
      },
    };
    expect(
      await new MergePlanningService(creating).prepare({
        skillA: a,
        skillB: b,
        comparisonPlan: compatible.plan,
      }),
    ).toMatchObject({ comparisonReused: false });
    expect(creates).toBe(1);
  });
});

describe("StructuredCandidateGenerator", () => {
  it("creates three valid, distinct and reconstructible candidates without concatenating parents", () => {
    const script = file("scripts/danger.ts", "throw new Error('MUST_NOT_EXECUTE')");
    const binaryA = file("assets/data.bin", "\u0000A");
    const binaryB = file("assets/data.bin", "\u0000B");
    const a = skill("alpha", ["accessibility"], { format: "concise" }, [script, binaryA]);
    const b = skill("beta", ["performance"], { format: "detailed" }, [binaryB]);
    a.snapshot.files[0] = file(
      "SKILL.md",
      "---\nname: alpha\ndescription: alpha\n---\n\nPARENT_A_RAW_MARKER\n",
    );
    b.snapshot.files[0] = file(
      "SKILL.md",
      "---\nname: beta\ndescription: beta\n---\n\nPARENT_B_RAW_MARKER\n",
    );
    const plan = new CapabilityExtractor().extract(
      projectDevelopmentEvidence(comparison(a, b)),
      a,
      b,
    );
    let id = 0;
    const candidates = new StructuredCandidateGenerator({
      template: MERGE_TEMPLATE,
      id: () => `candidate-${++id}`,
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    }).generate(plan, a, b);

    expect(candidates.map((candidate) => candidate.strategy)).toEqual([
      "a-preserving",
      "balanced",
      "b-preserving",
    ]);
    expect(new Set(candidates.map((candidate) => candidate.fingerprint)).size).toBe(3);
    for (const candidate of candidates) {
      const parsed = parseSkill(candidate.files);
      expect(parsed.name).toBe(candidate.name);
      expect(
        candidate.files.find((item) => item.relativePath === "scripts/danger.ts")?.contentHash,
      ).toBe(script.contentHash);
      const markdown = new TextDecoder().decode(
        candidate.files.find((item) => item.relativePath === "SKILL.md")?.content,
      );
      expect(markdown).not.toContain("PARENT_A_RAW_MARKER");
      expect(markdown).not.toContain("PARENT_B_RAW_MARKER");
      for (const reference of parsed.relativeReferences) {
        expect(candidate.files.some((item) => item.relativePath === reference)).toBe(true);
      }
    }
    const balanced = candidates[1];
    expect(balanced?.files.map((item) => item.relativePath)).toEqual(
      expect.arrayContaining(["parents/a/assets/data.bin", "parents/b/assets/data.bin"]),
    );
    expect(balanced?.provenance.collisions).toEqual([
      expect.objectContaining({ originalPath: "assets/data.bin" }),
    ]);
  });

  it("refuses candidates when the merge plan is not recommended", () => {
    const a = skill("a", [], {});
    const b = skill("b", [], {});
    const plan = new CapabilityExtractor().extract(
      projectDevelopmentEvidence(comparison(a, b, "LOW")),
      a,
      b,
    );
    expect(() =>
      new StructuredCandidateGenerator({ template: MERGE_TEMPLATE }).generate(plan, a, b),
    ).toThrow(/different task categories/u);
  });

  it("generates a merge summary without a persistence adapter", () => {
    const a = skill("a", [], {});
    const b = skill("b", [], {});
    const plan = new CapabilityExtractor().extract(
      projectDevelopmentEvidence(comparison(a, b)),
      a,
      b,
    );
    let candidateId = 0;
    const generation = new MergeGenerationService({
      generator: new StructuredCandidateGenerator({
        template: MERGE_TEMPLATE,
        id: () => `candidate-${++candidateId}`,
        now: () => new Date(0),
      }),
      id: () => "merge-run",
      now: () => new Date(0),
    }).generate({ plan, skillA: a, skillB: b, config: {} });

    expect(generation).toMatchObject({
      runId: "merge-run",
      comparisonId: "comparison-id",
      candidates: [{ id: "candidate-1" }, { id: "candidate-2" }, { id: "candidate-3" }],
    });
  });
});

describe("development tournament ranking", () => {
  it("ranks completed entries by score, pass rate and stable identifier", () => {
    const entries: TournamentEntry[] = [
      {
        kind: "candidate",
        id: "c-failed",
        snapshotId: "s4",
        evaluationRunId: "e4",
        score: 1,
        passRate: 1,
        status: "failed",
      },
      {
        kind: "candidate",
        id: "c-z",
        snapshotId: "s3",
        evaluationRunId: "e3",
        score: 0.8,
        passRate: 0.9,
        status: "completed",
      },
      {
        kind: "parent",
        id: "A",
        snapshotId: "s1",
        evaluationRunId: "e1",
        score: 0.8,
        passRate: 1,
        status: "completed",
      },
      {
        kind: "candidate",
        id: "c-a",
        snapshotId: "s2",
        evaluationRunId: "e2",
        score: 0.8,
        passRate: 0.9,
        status: "completed",
      },
    ];

    expect(rankTournamentEntries(entries).map((entry) => entry.id)).toEqual([
      "A",
      "c-a",
      "c-z",
      "c-failed",
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(["c-failed", "c-z", "A", "c-a"]);
  });
});
