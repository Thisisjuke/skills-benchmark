// Registered by the SDK runner scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { executionProfileSchema, MOCK_EXECUTION_PROFILE } from "@skillbench/sdk/runners";

describe("ExecutionProfile", () => {
  it("validates the reproducible mock profile", () => {
    expect(executionProfileSchema.parse(MOCK_EXECUTION_PROFILE)).toEqual({
      runner: "mock",
      runnerVersion: "mock-v1",
    });
  });

  it("rejects malformed or non-serializable provider profiles", () => {
    expect(
      executionProfileSchema.safeParse({
        runner: "third-party",
        runnerVersion: "1.0.0",
        callback: () => undefined,
      }).success,
    ).toBe(false);
  });

  it("accepts a serializable third-party runner profile without changing the SDK union", () => {
    expect(
      executionProfileSchema.parse({
        runner: "third-party",
        runnerVersion: "third-party-cli 1.0.0",
        model: "small",
        settings: { effort: "low", nested: { budget: 1_000 } },
      }),
    ).toEqual({
      runner: "third-party",
      runnerVersion: "third-party-cli 1.0.0",
      model: "small",
      settings: { effort: "low", nested: { budget: 1_000 } },
    });
    expect(
      executionProfileSchema.safeParse({
        runner: "third-party",
        runnerVersion: "1.0.0",
        settings: { invalid: () => undefined },
      }).success,
    ).toBe(false);
  });
});
