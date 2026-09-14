// Registered by the Codex provider scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  codexExecutionProfileSchema,
  createCodexExecutionProfile,
} from "@skillbench/runner-codex";
import { executionProfileSchema } from "@skillbench/sdk/runners";

describe("CodexExecutionProfile", () => {
  it("validates an explicit reproducible profile through the adapter and SDK contracts", () => {
    const profile = createCodexExecutionProfile({
      runnerVersion: "codex-cli 0.153.0",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });

    expect(codexExecutionProfileSchema.parse(profile)).toEqual(profile);
    expect(executionProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects missing choices and unsupported versions or efforts", () => {
    expect(() => createCodexExecutionProfile({ runnerVersion: "codex-cli 0.153.0" })).toThrow(
      /runner\.model.*runner\.reasoningEffort/u,
    );
    expect(
      codexExecutionProfileSchema.safeParse({
        runner: "codex",
        runnerVersion: "unknown",
        model: "gpt-test",
        reasoningEffort: "extreme",
      }).success,
    ).toBe(false);
  });
});
