import { describe, expect, it } from "vite-plus/test";

import {
  createOpenCodeExecutionProfile,
  openCodeExecutionProfileSchema,
} from "@skillbench/runner-opencode";
import { executionProfileSchema } from "@skillbench/sdk/runners";

describe("OpenCodeExecutionProfile", () => {
  it("validates a provider/model profile with an optional variant", () => {
    const profile = createOpenCodeExecutionProfile({
      runnerVersion: "1.18.12",
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
    });

    expect(openCodeExecutionProfileSchema.parse(profile)).toEqual(profile);
    expect(executionProfileSchema.parse(profile)).toEqual(profile);
  });

  it("allows OpenCode to resolve its configured or last-used model", () => {
    const profile = createOpenCodeExecutionProfile({ runnerVersion: "1.18.12" });
    expect(profile).toEqual({ runner: "opencode", runnerVersion: "1.18.12" });
    expect(executionProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects malformed models and unsupported version shapes", () => {
    for (const model of ["claude", "/claude", "anthropic/"]) {
      expect(
        openCodeExecutionProfileSchema.safeParse({
          runner: "opencode",
          runnerVersion: "1.18.12",
          model,
        }).success,
      ).toBe(false);
    }
  });
});
