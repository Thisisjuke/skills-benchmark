// Registered by the Claude provider scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  claudeExecutionProfileSchema,
  createClaudeExecutionProfile,
  isClaudeExecutionProfile,
} from "@skillbench/runner-claude";
import { executionProfileSchema } from "@skillbench/sdk/runners";

describe("Claude execution profile", () => {
  it("requires and preserves an explicit model and effort", () => {
    const profile = createClaudeExecutionProfile({
      runnerVersion: "2.1.128 (Claude Code)",
      model: "claude-sonnet-4-6",
      effort: "low",
    });
    expect(profile).toEqual({
      runner: "claude",
      runnerVersion: "2.1.128 (Claude Code)",
      model: "claude-sonnet-4-6",
      effort: "low",
    });
    expect(claudeExecutionProfileSchema.parse(profile)).toEqual(profile);
    expect(executionProfileSchema.parse(profile)).toEqual(profile);
    expect(isClaudeExecutionProfile(profile)).toBe(true);
  });

  it("rejects missing values and unknown profile keys", () => {
    expect(() => createClaudeExecutionProfile({ runnerVersion: "2.1.128 (Claude Code)" })).toThrow(
      /model.*reasoningEffort.*configured runner profile/u,
    );
    expect(
      claudeExecutionProfileSchema.safeParse({
        runner: "claude",
        runnerVersion: "2.1.128 (Claude Code)",
        model: "claude-sonnet-4-6",
        effort: "low",
        unknown: true,
      }).success,
    ).toBe(false);
  });
});
