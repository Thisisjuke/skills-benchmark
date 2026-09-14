// Registered by the SDK runner scenario suite.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  MOCK_EXECUTION_PROFILE,
  skillDirectoryName,
  WorkspaceManager,
  type RunInput,
} from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

async function createInput(workspacePath: string): Promise<RunInput> {
  const resolved = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
  return {
    runId: "run/id with unsafe characters",
    evalCaseId: "case",
    repetition: 1,
    snapshot: { ...resolved.snapshot, id: "../../unsafe snapshot id" },
    prompt: "test",
    fixtures: [],
    timeoutMs: 100,
    workspacePath,
    permissions: { schemaVersion: 1 },
    executionProfile: MOCK_EXECUTION_PROFILE,
  };
}

describe("WorkspaceManager", () => {
  it("materializes concurrent runs without mutable paths or names in common", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-workspaces-"));
    const left = await createInput(join(parent, "left"));
    const right = await createInput(join(parent, "right"));
    const manager = new WorkspaceManager(() => new Date("2026-09-03T00:00:00.000Z"));

    const [leftPrepared, rightPrepared] = await Promise.all([
      manager.prepare(left),
      manager.prepare(right),
    ]);
    expect(leftPrepared.skillDirectoryName).toMatch(/^skillbench-[a-f0-9]{20}$/u);
    expect(rightPrepared.skillDirectoryName).toBe(leftPrepared.skillDirectoryName);
    expect(leftPrepared.skillPath).not.toBe(rightPrepared.skillPath);
    writeFileSync(join(left.workspacePath, "sentinel.txt"), "left");
    expect(existsSync(join(right.workspacePath, "sentinel.txt"))).toBe(false);
    expect(readFileSync(leftPrepared.manifestPath, "utf8")).toContain(
      `.agents/skills/${skillDirectoryName(left)}`,
    );
  });

  it("rejects workspace collisions without altering the existing run", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-workspace-collision-"));
    const input = await createInput(join(parent, "attempt"));
    const manager = new WorkspaceManager();
    await manager.prepare(input);
    writeFileSync(join(input.workspacePath, "sentinel.txt"), "preserve");

    await expect(manager.prepare(input)).rejects.toMatchObject({ code: "WORKSPACE_COLLISION" });
    expect(readFileSync(join(input.workspacePath, "sentinel.txt"), "utf8")).toBe("preserve");
  });

  it("removes a partially prepared workspace when fixture copying fails", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-workspace-failure-"));
    const input = await createInput(join(parent, "attempt"));
    input.fixtures = [
      { sourcePath: join(parent, "missing-fixture"), destinationPath: "nested/fixture.txt" },
    ];

    await expect(new WorkspaceManager().prepare(input)).rejects.toThrow();
    expect(existsSync(input.workspacePath)).toBe(false);
  });

  it("supports a provider-owned skill root without exposing provider internals as artifacts", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-workspace-provider-root-"));
    const input = await createInput(join(parent, "attempt"));
    const manager = new WorkspaceManager(undefined, undefined, { skillRoot: ".claude/skills" });
    const prepared = await manager.prepare(input);

    expect(prepared.skillDirectory).toBe(`.claude/skills/${skillDirectoryName(input)}`);
    expect(existsSync(join(prepared.skillPath, "SKILL.md"))).toBe(true);
    expect(readFileSync(prepared.manifestPath, "utf8")).toContain(prepared.skillDirectory);
    expect([
      ...manager.diffArtifacts(new Map(), await manager.captureState(input.workspacePath)),
    ]).toEqual([]);
  });

  it("rejects unsafe provider skill roots", () => {
    for (const skillRoot of ["../skills", "/tmp/skills", "C:\\temp\\skills"]) {
      expect(() => new WorkspaceManager(undefined, undefined, { skillRoot })).toThrow(
        /safe relative directory/u,
      );
    }
  });
});
