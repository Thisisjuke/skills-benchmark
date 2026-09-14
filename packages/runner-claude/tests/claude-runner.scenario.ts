// Registered by the Claude provider scenario suite.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { verifyRunnerContract } from "@skillbench/test-contracts";
import { ClaudeRunner } from "@skillbench/runner-claude";
import {
  MOCK_EXECUTION_PROFILE,
  type ExecutionProfile,
  type RunInput,
} from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { describe, expect, it } from "vite-plus/test";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };
const fakeClaude = resolve("tests/fixtures/fake-claude.ts");
const executionProfile = {
  runner: "claude" as const,
  runnerVersion: "2.1.128 (Claude Code)",
  model: "claude-sonnet-4-6",
  effort: "low" as const,
};

async function input(
  profile: ExecutionProfile = executionProfile,
  timeoutMs = 1_000,
): Promise<RunInput> {
  const resolved = await new LocalSourceResolver(policy).resolve(
    "../sdk/tests/fixtures/skills/basic",
  );
  const parent = mkdtempSync(join(tmpdir(), "skillbench-claude-runner-"));
  return {
    runId: "run",
    evalCaseId: "case",
    repetition: 1,
    snapshot: resolved.snapshot,
    prompt: "Do the task; this text is one argv.",
    fixtures: [],
    timeoutMs,
    workspacePath: join(parent, "attempt"),
    permissions: { schemaVersion: 1, sandbox: "workspace-write" },
    executionProfile: profile,
  };
}

function runner(mode: string, maxOutputBytes = 1024 * 1024): ClaudeRunner {
  return new ClaudeRunner({
    executable: process.execPath,
    executableArgs: [fakeClaude],
    maxOutputBytes,
    environment: { SKILLBENCH_FAKE_CLAUDE_MODE: mode },
  });
}

describe("ClaudeRunner", () => {
  it("satisfies the reusable runner contract", async () => {
    await verifyRunnerContract({
      runner: runner("success"),
      runnerName: "claude",
      executionProfile,
      mismatchedProfile: MOCK_EXECUTION_PROFILE,
      createInput: (profile) => input(profile),
    });
  });

  it("runs Claude in isolated JSON print mode and captures changed files", async () => {
    const runInput = await input();
    const result = await runner("success").run(runInput);
    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdout: "FAKE_CLAUDE_OK",
      stderr: "",
      tokens: { input: 17, output: 6 },
      trace: {
        protocol: "claude-print-json-v1",
        version: "2.1.128 (Claude Code)",
        executionProfile,
        sessionId: "fake-session",
        numTurns: 2,
        skillDirectory: expect.stringMatching(/^\.claude\/skills\/skillbench-/u),
      },
    });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ relativePath: "argv.json" }),
      expect.objectContaining({ relativePath: "generated.txt", sizeBytes: 25 }),
    ]);
    expect(existsSync(join(runInput.workspacePath, ".claude", "skills"))).toBe(true);
    const argv = JSON.parse(
      readFileSync(join(runInput.workspacePath, "argv.json"), "utf8"),
    ) as string[];
    expect(argv.at(-1)).toBe(runInput.prompt);
    expect(argv).toContain("--no-session-persistence");
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).toContain("--setting-sources");
    expect(argv).toContain("--effort");
    expect(argv).toContain("low");
    expect(argv).toContain("acceptEdits");
    expect(argv).toContain("Read,Glob,Grep,Skill,Edit,Write,Bash");
  });

  it("uses a tool-restricted, non-interactive read-only mode", async () => {
    const runInput = await input();
    runInput.permissions = { schemaVersion: 1, sandbox: "read-only" };
    await runner("success").run(runInput);
    const argv = JSON.parse(
      readFileSync(join(runInput.workspacePath, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toContain("dontAsk");
    expect(argv).toContain("Read,Glob,Grep,Skill");
  });

  it("maps non-zero, invalid protocol, timeout and bounded output", async () => {
    await expect(runner("nonzero").run(await input())).resolves.toMatchObject({
      status: "failed",
      exitCode: 7,
    });
    const incompatible = await runner("incompatible").run(await input());
    expect(incompatible).toMatchObject({ status: "failed", exitCode: 0 });
    expect(incompatible.stderr).toContain("without a valid result JSON object");
    await expect(runner("timeout").run(await input(executionProfile, 30))).resolves.toMatchObject({
      status: "timed-out",
      exitCode: null,
    });
    const bounded = await runner("large", 256).run(await input());
    expect(new TextEncoder().encode(bounded.stderr).byteLength).toBeLessThanOrEqual(256);
    expect(bounded.trace).toMatchObject({ stderrTruncated: true });
  });

  it("rejects a missing executable", async () => {
    await expect(
      new ClaudeRunner({ executable: "/definitely/missing/claude" }).version(),
    ).rejects.toMatchObject({
      code: "CLAUDE_NOT_FOUND",
    });
  });
});
