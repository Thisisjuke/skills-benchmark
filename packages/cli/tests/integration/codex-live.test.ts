import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { CodexRunner, createCodexExecutionProfile } from "@skillbench/runner-codex";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const liveEnabled = process.env.SKILLBENCH_CODEX_LIVE === "1";
const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe.skipIf(!liveEnabled)("CodexRunner live", () => {
  it("discovers an isolated skill and completes the JSONL protocol", async () => {
    const parent = mkdtempSync(join(tmpdir(), "skillbench-codex-live-"));
    try {
      const resolved = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
      const runner = new CodexRunner({
        executable: process.env.SKILLBENCH_CODEX_EXECUTABLE ?? "codex",
        sandbox: "read-only",
      });
      const executionProfile = createCodexExecutionProfile({
        runnerVersion: await runner.version(),
        model: process.env.SKILLBENCH_CODEX_MODEL ?? "gpt-5.6-luna",
        reasoningEffort: "low",
      });
      const result = await runner.run({
        runId: "live-run",
        evalCaseId: "skill-discovery",
        repetition: 1,
        snapshot: resolved.snapshot,
        prompt:
          "Use the installed basic-skill instructions. Do not use tools. Reply with exactly BASIC_SKILL_OK.",
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
      expect(result.tokens?.input).toBeGreaterThan(0);
      expect(result.trace).toMatchObject({ protocol: "codex-exec-jsonl-v1" });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
