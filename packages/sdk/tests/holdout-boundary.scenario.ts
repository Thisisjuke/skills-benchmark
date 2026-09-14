// Registered by the SDK merge scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  createLocalHoldoutExecutionHandle,
  HoldoutGate,
  type HoldoutEvaluator,
} from "@skillbench/sdk/holdout";
import type { EvalSuite, EvaluationSummary } from "@skillbench/sdk/evaluator";
import type { DevelopmentTournament } from "@skillbench/sdk/merger";
import { MOCK_EXECUTION_PROFILE } from "@skillbench/sdk/runners";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  hashBytes,
  parseSkill,
  type ResolvedSkill,
} from "@skillbench/sdk/skills";

const CANARY = "HOLDOUT_PROMPT_ASSERTION_FIXTURE_RESULT_CANARY";

function resolvedSkill(id: string): ResolvedSkill {
  const content = new TextEncoder().encode(
    `---\nname: ${id}\ndescription: ${id}\n---\n\n# ${id}\n`,
  );
  const files = [
    {
      relativePath: "SKILL.md",
      content,
      contentHash: hashBytes(content),
      sizeBytes: content.byteLength,
    },
  ];
  return {
    snapshot: {
      id,
      origin: { type: "local", originalInput: `./${id}` },
      rootPath: ".",
      files,
      fingerprint: fingerprintFiles(files),
      fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
      fetchedAt: "2026-09-03T00:00:00.000Z",
    },
    skill: parseSkill(files),
  };
}

function summary(snapshotId: string, score: number): EvaluationSummary {
  return {
    runId: `holdout-eval-${snapshotId}`,
    snapshotId,
    suiteId: "secret-suite-id",
    partition: "holdout",
    runnerType: "mock",
    executionProfile: MOCK_EXECUTION_PROFILE,
    repeat: 1,
    status: "completed",
    passRate: score,
    meanScore: score,
    cases: [],
    attempts: [
      {
        id: `attempt-${snapshotId}`,
        evalCaseId: "hidden-case",
        repetition: 1,
        status: "completed",
        passed: true,
        score,
        durationMs: 1,
        runnerResult: {
          status: "completed",
          exitCode: 0,
          stdout: CANARY,
          stderr: "",
          durationMs: 1,
          artifacts: [],
        },
        assertions: [],
      },
    ],
    createdAt: "2026-09-03T00:00:00.000Z",
    finishedAt: "2026-09-03T00:00:01.000Z",
  };
}

function tournament(): DevelopmentTournament {
  return {
    suiteId: "development-suite",
    entries: [
      {
        kind: "parent",
        id: "A",
        snapshotId: "parent-a",
        evaluationRunId: "dev-a",
        score: 0.9,
        passRate: 1,
        status: "completed",
      },
      {
        kind: "parent",
        id: "B",
        snapshotId: "parent-b",
        evaluationRunId: "dev-b",
        score: 0.8,
        passRate: 1,
        status: "completed",
      },
      {
        kind: "candidate",
        id: "candidate-1",
        snapshotId: "candidate-snapshot-1",
        evaluationRunId: "dev-c1",
        score: 1,
        passRate: 1,
        status: "completed",
      },
      {
        kind: "candidate",
        id: "candidate-2",
        snapshotId: "candidate-snapshot-2",
        evaluationRunId: "dev-c2",
        score: 0.7,
        passRate: 0.5,
        status: "completed",
      },
    ],
    bestParentId: "A",
    bestParentScore: 0.9,
    selectedCandidateIds: ["candidate-1"],
  };
}

describe("holdout boundary", () => {
  it("loads hidden data only after finalist validation and returns aggregates without the canary", async () => {
    let loads = 0;
    const observedSuites: EvalSuite[] = [];
    const suite: EvalSuite = {
      id: "secret-suite-id",
      partition: "holdout",
      rootPath: `/secret/${CANARY}`,
      cases: [
        {
          id: "hidden-case",
          name: "hidden",
          prompt: CANARY,
          partition: "holdout",
          fixtures: [{ sourcePath: `/secret/${CANARY}.txt`, destinationPath: "fixture.txt" }],
          assertions: [{ type: "contains", path: "result.txt", value: CANARY }],
          sourcePath: `/secret/${CANARY}.yaml`,
          contentHash: "secret-hash",
        },
      ],
    };
    const evaluator: HoldoutEvaluator = {
      evaluate: async (input) => {
        observedSuites.push(input.suite);
        return summary(
          input.resolvedSkill.snapshot.id,
          input.resolvedSkill.snapshot.id === "parent-a" ? 0.8 : 0.95,
        );
      },
    };
    const skills = new Map([
      ["parent-a", resolvedSkill("parent-a")],
      ["candidate-snapshot-1", resolvedSkill("candidate-snapshot-1")],
    ]);
    const handle = createLocalHoldoutExecutionHandle({
      loadSuite: () => {
        loads += 1;
        return suite;
      },
      evaluator,
      snapshots: { getById: (id) => skills.get(id)! },
      config: {
        repeat: 1,
        timeoutMs: 100,
        executionProfile: MOCK_EXECUTION_PROFILE,
        permissions: { schemaVersion: 1 },
        effectiveConfig: { runner: { type: "mock" } },
      },
    });

    expect(loads).toBe(0);
    expect(Object.keys(handle)).toEqual(["execute"]);
    expect(JSON.stringify(handle)).not.toContain(CANARY);
    const result = await new HoldoutGate({ getTournament: () => tournament() }).execute(
      { mergeRunId: "merge-1", bestParentId: "A", candidateIds: ["candidate-1"] },
      handle,
    );

    expect(loads).toBe(1);
    expect(observedSuites).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result).toMatchObject({
      mergeRunId: "merge-1",
      partition: "holdout",
      entries: [
        { kind: "parent", id: "A", snapshotId: "parent-a", score: 0.8 },
        { kind: "candidate", id: "candidate-1", snapshotId: "candidate-snapshot-1", score: 0.95 },
      ],
    });
  });

  it("rejects an unselected candidate before the holdout loader is invoked", async () => {
    let loads = 0;
    const handle = createLocalHoldoutExecutionHandle({
      loadSuite: () => {
        loads += 1;
        throw new Error(CANARY);
      },
      evaluator: { evaluate: async () => summary("unused", 0) },
      snapshots: { getById: () => resolvedSkill("unused") },
      config: {
        repeat: 1,
        timeoutMs: 100,
        executionProfile: MOCK_EXECUTION_PROFILE,
        permissions: { schemaVersion: 1 },
        effectiveConfig: {},
      },
    });
    const gate = new HoldoutGate({ getTournament: () => tournament() });

    await expect(
      gate.execute(
        { mergeRunId: "merge-1", bestParentId: "A", candidateIds: ["candidate-2"] },
        handle,
      ),
    ).rejects.toThrow(/not selected/u);
    expect(loads).toBe(0);
  });

  it("rejects a non-holdout suite inside the opaque handle", async () => {
    const handle = createLocalHoldoutExecutionHandle({
      loadSuite: () => ({ id: "development", partition: "development", rootPath: ".", cases: [] }),
      evaluator: { evaluate: async () => summary("unused", 0) },
      snapshots: { getById: () => resolvedSkill("unused") },
      config: {
        repeat: 1,
        timeoutMs: 100,
        executionProfile: MOCK_EXECUTION_PROFILE,
        permissions: { schemaVersion: 1 },
        effectiveConfig: {},
      },
    });
    await expect(
      new HoldoutGate({ getTournament: () => tournament() }).execute(
        { mergeRunId: "merge-1", bestParentId: "A", candidateIds: ["candidate-1"] },
        handle,
      ),
    ).rejects.toThrow(/non-holdout/u);
  });
});
