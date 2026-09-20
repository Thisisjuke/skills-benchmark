// Registered by the SDK comparison scenario suite.
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { RunnerBackedJudge } from "@skillbench/sdk/judge";
import {
  executionProfileSchema,
  MOCK_EXECUTION_PROFILE,
  type RunInput,
  type RunResult,
  type Runner,
} from "@skillbench/sdk/runners";
import { FINGERPRINT_ALGORITHM, fingerprintFiles, hashBytes } from "@skillbench/sdk/skills";

const judgeContent = new TextEncoder().encode("---\nname: judge\ndescription: Test judge\n---\n");
const judgeFile = {
  relativePath: "SKILL.md",
  content: judgeContent,
  contentHash: hashBytes(judgeContent),
  sizeBytes: judgeContent.byteLength,
};
const JUDGE_OPTIONS = {
  skillSnapshot: {
    id: "judge",
    origin: { type: "local" as const, originalInput: "test-judge" },
    rootPath: "judge",
    files: [judgeFile],
    fingerprint: fingerprintFiles([judgeFile]),
    fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
    fetchedAt: new Date(0).toISOString(),
  },
};

const THIRD_PARTY_PROFILE = executionProfileSchema.parse({
  runner: "third-party",
  runnerVersion: "third-party-cli 1.0.0",
  model: "small",
  settings: {},
});

function runner(
  handler: (input: RunInput) => Partial<RunResult> | Promise<Partial<RunResult>>,
): Runner {
  return {
    run: async (runInput) => ({
      status: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
      artifacts: [],
      ...(await handler(runInput)),
    }),
  };
}

const input = {
  rubric: "Prefer clarity",
  prompt: "Explain the result",
  candidates: [
    { label: "X" as const, output: "clear", artifacts: [] },
    { label: "Y" as const, output: "unclear", artifacts: [] },
  ] as const,
};

describe("RunnerBackedJudge", () => {
  it("uses only the Runner contract, parses strict JSON and cleans its workspace", async () => {
    const workspaceParent = mkdtempSync(join(tmpdir(), "skillbench-runner-judge-"));
    let receivedPrompt = "";
    const fakeRunner = runner((runInput) => {
      receivedPrompt = runInput.prompt;
      return {
        stdout: JSON.stringify({ winner: "X", confidence: 0.75, reasons: ["clearer"] }),
        tokens: { input: 20, output: 8 },
      };
    });
    const result = await new RunnerBackedJudge(fakeRunner, {
      ...JUDGE_OPTIONS,
      workspaceParent,
      executionProfile: THIRD_PARTY_PROFILE,
    }).compare(input);

    expect(result).toMatchObject({ winner: "X", confidence: 0.75, reasons: ["clearer"] });
    expect(receivedPrompt).toContain('"label":"X"');
    expect(receivedPrompt).toContain('"label":"Y"');
    expect(receivedPrompt).not.toContain("instruction");
    expect(existsSync(workspaceParent) ? readdirSync(workspaceParent) : []).toEqual([]);
  });

  it("rejects invalid JSON and non-completed runner results", async () => {
    await expect(
      new RunnerBackedJudge(
        runner(() => ({ stdout: "not-json" })),
        {
          ...JUDGE_OPTIONS,
          executionProfile: MOCK_EXECUTION_PROFILE,
        },
      ).compare(input),
    ).rejects.toThrow(/invalid JSON/u);
    await expect(
      new RunnerBackedJudge(
        runner(() => ({ status: "timed-out" })),
        {
          ...JUDGE_OPTIONS,
          executionProfile: MOCK_EXECUTION_PROFILE,
        },
      ).compare(input),
    ).rejects.toThrow(/timed-out/u);
  });

  it("forwards cancellation to the runner", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const fakeRunner = runner((runInput) => {
      receivedSignal = runInput.signal;
      return { stdout: JSON.stringify({ winner: "tie", confidence: 0, reasons: ["same"] }) };
    });

    await new RunnerBackedJudge(fakeRunner, {
      ...JUDGE_OPTIONS,
      executionProfile: MOCK_EXECUTION_PROFILE,
    }).compare({ ...input, signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
  });
});
