import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeRunner, createClaudeExecutionProfile } from "@skillbench/runner-claude";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { describe, expect, it } from "vite-plus/test";

const liveEnabled = process.env.SKILLBENCH_CLAUDE_LIVE === "1";
const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe.skipIf(!liveEnabled)("ClaudeRunner live", () => {
  it("discovers an isolated skill and completes the JSON protocol", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-claude-live-"));
    try {
      const resolved = await new LocalSourceResolver(policy).resolve(
        "../sdk/tests/fixtures/skills/basic",
      );
      const runner = new ClaudeRunner({
        executable: process.env.SKILLBENCH_CLAUDE_EXECUTABLE ?? "claude",
        sandbox: "read-only",
      });
      const executionProfile = createClaudeExecutionProfile({
        runnerVersion: await runner.version(),
        model: process.env.SKILLBENCH_CLAUDE_MODEL ?? "claude-sonnet-4-6",
        effort: "low",
      });
      const result = await runner.run({
        runId: "live-run",
        evalCaseId: "skill-discovery",
        repetition: 1,
        snapshot: resolved.snapshot,
        prompt: "Use the installed basic-skill instructions. Reply with exactly BASIC_SKILL_OK.",
        fixtures: [],
        timeoutMs: 120_000,
        workspacePath: join(parent, "attempt"),
        permissions: { schemaVersion: 1, sandbox: "read-only" },
        executionProfile,
      });
      expect(result, result.stderr || JSON.stringify(result.trace)).toMatchObject({
        status: "completed",
        exitCode: 0,
      });
      expect(result.stdout.trim()).toBe("BASIC_SKILL_OK");
      expect(result.trace).toMatchObject({ protocol: "claude-print-json-v1" });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
