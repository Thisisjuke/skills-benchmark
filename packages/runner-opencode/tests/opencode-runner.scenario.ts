import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { OpenCodeRunner } from "@skillbench/runner-opencode";
import {
  MOCK_EXECUTION_PROFILE,
  type ExecutionProfile,
  type RunInput,
} from "@skillbench/sdk/runners";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { verifyRunnerContract } from "@skillbench/test-contracts";
import { describe, expect, it } from "vite-plus/test";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };
const fakeOpenCode = resolve("tests/fixtures/fake-opencode.ts");
const executionProfile = {
  runner: "opencode" as const,
  runnerVersion: "1.18.12",
  model: "anthropic/claude-test",
  variant: "high",
};

async function input(
  timeoutMs = 1_000,
  profile: ExecutionProfile = executionProfile,
): Promise<RunInput> {
  const resolved = await new LocalSourceResolver(policy).resolve(
    "../sdk/tests/fixtures/skills/basic",
  );
  const parent = mkdtempSync(join(tmpdir(), "skillbench-opencode-runner-"));
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

function runner(mode: string, maxOutputBytes = 1024 * 1024): OpenCodeRunner {
  return new OpenCodeRunner({
    executable: process.execPath,
    executableArgs: [fakeOpenCode],
    maxOutputBytes,
    environment: { SKILLBENCH_FAKE_OPENCODE_MODE: mode },
  });
}

describe("OpenCodeRunner", () => {
  it("satisfies the reusable runner contract", async () => {
    await verifyRunnerContract({
      runner: runner("success"),
      runnerName: "opencode",
      executionProfile,
      mismatchedProfile: MOCK_EXECUTION_PROFILE,
      createInput: (profile) => input(1_000, profile),
    });
  });

  it("runs a configured OpenCode CLI, parses JSONL and removes its session", async () => {
    const runInput = await input();
    const result = await runner("success").run(runInput);

    expect(result).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdout: "FAKE_OPENCODE_OK",
      stderr: "",
      tokens: { input: 19, output: 7 },
      trace: {
        protocol: "opencode-run-jsonl-v1",
        version: "1.18.12",
        executionProfile,
        sessionId: "ses_fake",
        totalCost: 0.012,
        sessionCleanup: "deleted",
        inheritedConfiguration: true,
      },
    });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ relativePath: "argv.json" }),
      expect.objectContaining({ relativePath: "generated.txt", sizeBytes: 27 }),
    ]);
    expect(existsSync(join(runInput.workspacePath, ".opencode", "deleted-session.txt"))).toBe(
      true,
    );
    const argv = JSON.parse(
      readFileSync(join(runInput.workspacePath, "argv.json"), "utf8"),
    ) as string[];
    expect(argv.at(-1)).toBe(runInput.prompt);
    expect(argv).toContain("--pure");
    expect(argv).toContain("--model");
    expect(argv).toContain("anthropic/claude-test");
    expect(argv).toContain("--variant");
    expect(argv).toContain("high");
    expect(argv).not.toContain("--auto");

    const agent = readFileSync(
      join(runInput.workspacePath, ".opencode", "agents", "skillbench.md"),
      "utf8",
    );
    expect(agent).toContain("edit: allow");
    expect(agent).toContain("bash: deny");
    expect(agent).toContain("external_directory: deny");
    expect(agent).toContain('"*.env": deny');
  });

  it("uses an edit-denied agent for read-only runs", async () => {
    const runInput = await input();
    runInput.permissions = { schemaVersion: 1, sandbox: "read-only" };
    await runner("success").run(runInput);
    expect(
      readFileSync(
        join(runInput.workspacePath, ".opencode", "agents", "skillbench.md"),
        "utf8",
      ),
    ).toContain("edit: deny");
  });

  it("omits --model when OpenCode owns model selection", async () => {
    const runInput = await input(1_000, {
      runner: "opencode",
      runnerVersion: "1.18.12",
    });
    await runner("success").run(runInput);
    const argv = JSON.parse(
      readFileSync(join(runInput.workspacePath, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).not.toContain("--model");
  });

  it("maps provider errors, invalid output, missing text and timeout", async () => {
    const nonzero = await runner("nonzero").run(await input());
    expect(nonzero).toMatchObject({ status: "failed", exitCode: 7 });
    expect(nonzero.stderr).toContain("fake provider failure");

    for (const mode of ["invalid", "missing-text"]) {
      const result = await runner(mode).run(await input());
      expect(result).toMatchObject({ status: "failed", exitCode: 0 });
      expect(result.stderr).toContain("without a final text JSONL event");
    }

    await expect(runner("timeout").run(await input(500))).resolves.toMatchObject({
      status: "timed-out",
      exitCode: null,
      trace: { sessionCleanup: "deleted" },
    });
  });

  it("keeps output bounded and reports cleanup failures without hiding success", async () => {
    const bounded = await runner("large", 256).run(await input());
    expect(new TextEncoder().encode(bounded.stderr).byteLength).toBeLessThanOrEqual(256);
    expect(bounded.trace).toMatchObject({ stderrTruncated: true });

    const cleanupFailure = await runner("cleanup-failure").run(await input());
    expect(cleanupFailure).toMatchObject({
      status: "completed",
      trace: { sessionCleanup: "failed" },
    });
    expect(cleanupFailure.stderr).toContain("session cleanup failed");
  });

  it("cleans up by unique title when cancellation interrupts stdout capture", async () => {
    const controller = new AbortController();
    const runInput = await input(5_000);
    const execution = runner("cancel").run({ ...runInput, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled by test")), 500);

    await expect(execution).rejects.toThrow("cancelled by test");
    expect(existsSync(join(runInput.workspacePath, ".opencode", "deleted-session.txt"))).toBe(
      true,
    );
  });

  it("rejects missing executables and unsupported versions", async () => {
    await expect(
      new OpenCodeRunner({ executable: "/definitely/missing/opencode" }).version(),
    ).rejects.toMatchObject({ code: "OPENCODE_NOT_FOUND" });
    await expect(runner("unsupported-version").version()).rejects.toMatchObject({
      code: "OPENCODE_VERSION_UNSUPPORTED",
    });
  });
});
