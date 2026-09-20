import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createOpenCodeExecutionProfile,
  OpenCodeRunner,
} from "@skillbench/runner-opencode";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { describe, expect, it } from "vite-plus/test";

const liveEnabled = process.env.SKILLBENCH_OPENCODE_LIVE === "1";
const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe.skipIf(!liveEnabled)("OpenCodeRunner live", () => {
  it("uses the configured model, discovers the skill and deletes the session", async () => {
    const model = process.env.SKILLBENCH_OPENCODE_MODEL;
    if (model === undefined) throw new Error("SKILLBENCH_OPENCODE_MODEL is required");
    const parent = mkdtempSync(join(tmpdir(), "skillbench-opencode-live-"));
    try {
      const resolved = await new LocalSourceResolver(policy).resolve(
        "../sdk/tests/fixtures/skills/basic",
      );
      const runner = new OpenCodeRunner({
        executable: process.env.SKILLBENCH_OPENCODE_EXECUTABLE ?? "opencode",
        sandbox: "read-only",
      });
      const executionProfile = createOpenCodeExecutionProfile({
        runnerVersion: await runner.version(),
        model,
        ...(process.env.SKILLBENCH_OPENCODE_VARIANT === undefined
          ? {}
          : { variant: process.env.SKILLBENCH_OPENCODE_VARIANT }),
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
        trace: { protocol: "opencode-run-jsonl-v1", sessionCleanup: "deleted" },
      });
      expect(result.stdout.trim()).toBe("BASIC_SKILL_OK");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
