// Registered by the SDK runner scenario suite.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { MOCK_EXECUTION_PROFILE, MockRunner, skillDirectoryName } from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe("MockRunner", () => {
  it("materializes the skill and fixtures and writes deterministic artifacts", async () => {
    const skill = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
    const parent = mkdtempSync(join(tmpdir(), "skillbench-mock-"));
    const workspace = join(parent, "attempt");
    const runner = new MockRunner(() => ({
      files: { "src/result.txt": "generated" },
      durationMs: 12,
      tokens: { input: 10, output: 4 },
      skillActivated: true,
    }));

    const runInput = {
      runId: "run",
      evalCaseId: "case",
      repetition: 1,
      snapshot: skill.snapshot,
      prompt: "test",
      fixtures: [
        {
          sourcePath: "tests/fixtures/evals/development/fixtures/project",
          destinationPath: ".",
        },
      ],
      timeoutMs: 100,
      workspacePath: workspace,
      permissions: { schemaVersion: 1 as const },
      executionProfile: MOCK_EXECUTION_PROFILE,
    };
    const result = await runner.run(runInput);

    expect(result).toMatchObject({ status: "completed", exitCode: 0, durationMs: 12 });
    expect(readFileSync(join(workspace, "src/result.txt"), "utf8")).toBe("generated");
    expect(readFileSync(join(workspace, "output.txt"), "utf8")).toBe("deterministic output\n");
    expect(
      existsSync(join(workspace, ".agents", "skills", skillDirectoryName(runInput), "SKILL.md")),
    ).toBe(true);
    expect(existsSync(join(workspace, ".skillbench", "run.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(workspace, ".skillbench", "run.json"), "utf8")),
    ).toMatchObject({
      executionProfile: MOCK_EXECUTION_PROFILE,
    });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ relativePath: "src/result.txt", sizeBytes: 9 }),
    ]);
  });

  it("refuses output paths that overwrite the installed skill or escape the workspace", async () => {
    const skill = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
    for (const unsafePath of ["../outside", ".agents/skills/replaced", ".skillbench/run.json"]) {
      const workspace = join(mkdtempSync(join(tmpdir(), "skillbench-mock-")), "attempt");
      const runner = new MockRunner(() => ({ files: { [unsafePath]: "unsafe" } }));
      await expect(
        runner.run({
          runId: "run",
          evalCaseId: "case",
          repetition: 1,
          snapshot: skill.snapshot,
          prompt: "test",
          fixtures: [],
          timeoutMs: 100,
          workspacePath: workspace,
          permissions: { schemaVersion: 1 },
          executionProfile: MOCK_EXECUTION_PROFILE,
        }),
      ).rejects.toMatchObject({ code: "WORKSPACE_PATH_UNSAFE" });
    }
  });
});
