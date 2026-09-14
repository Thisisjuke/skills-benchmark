// Registered by the SDK runner scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  runnerPermissionsSchema,
  runnerTraceSchema,
  runResultSchema,
} from "@skillbench/sdk/runners";

describe("runner wire contracts", () => {
  it("requires versioned permissions", () => {
    expect(runnerPermissionsSchema.parse({ schemaVersion: 1, sandbox: "read-only" })).toEqual({
      schemaVersion: 1,
      sandbox: "read-only",
    });
    expect(runnerPermissionsSchema.safeParse({ sandbox: "read-only" }).success).toBe(false);
    expect(runnerPermissionsSchema.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });

  it("bounds provider trace extensions to JSON", () => {
    expect(
      runnerTraceSchema.parse({
        schemaVersion: 1,
        provider: "fixture-runner",
        protocol: "fixture-v1",
        sequence: [1, 2],
      }),
    ).toMatchObject({ provider: "fixture-runner", sequence: [1, 2] });
    expect(
      runnerTraceSchema.safeParse({
        schemaVersion: 1,
        provider: "fixture-runner",
        protocol: "fixture-v1",
        invalid: undefined,
      }).success,
    ).toBe(false);
  });

  it("validates a complete runner result", () => {
    expect(
      runResultSchema.safeParse({
        status: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 1,
        artifacts: [],
      }).success,
    ).toBe(true);
    expect(runResultSchema.safeParse({ status: "completed" }).success).toBe(false);
  });
});
