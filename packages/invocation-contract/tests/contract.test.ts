import { describe, expect, it } from "vite-plus/test";

import {
  createSkillbenchErrorEnvelope,
  createSkillbenchResultEnvelope,
  skillbenchAutomationRequestSchema,
  skillbenchCommandSchema,
  skillbenchEnvelopeSchema,
  skillbenchEventSchema,
} from "../src";

describe("Skillbench invocation contract", () => {
  it("contains only real CLI commands and the root error context", () => {
    expect(skillbenchCommandSchema.options).toEqual([
      "cli",
      "init",
      "doctor",
      "history",
      "inspect",
      "eval",
      "compare",
      "merge",
    ]);
  });

  it("builds and parses versioned result and error envelopes", () => {
    const result = createSkillbenchResultEnvelope("inspect", { name: "portable" });
    const error = createSkillbenchErrorEnvelope("compare", {
      code: "SOURCE_INVALID",
      message: "Invalid source",
      exitCode: 2,
    });
    expect(skillbenchEnvelopeSchema.parse(result)).toEqual(result);
    expect(skillbenchEnvelopeSchema.parse(error)).toEqual(error);
    expect(() => createSkillbenchResultEnvelope("inspect", { invalid: undefined })).toThrow();
  });

  it("validates every stable JSONL event shape", () => {
    const base = {
      schemaVersion: 1,
      command: "compare",
      jobId: "job-1",
      timestamp: "2026-09-06T10:00:00.000Z",
    } as const;
    const events = [
      { ...base, event: "started", data: {} },
      { ...base, event: "phase", data: { name: "resolve-sources" } },
      { ...base, event: "progress", data: { message: "Resolved", current: 1, total: 2 } },
      { ...base, event: "artifact", data: { kind: "report", path: "report.md" } },
      { ...base, event: "completed", data: { result: { winner: "A" } } },
      { ...base, event: "failed", data: { error: { code: "FAILED", message: "Failed", exitCode: 1 } } },
      { ...base, event: "cancelled", data: { reason: "SIGTERM" } },
    ];
    for (const event of events) expect(skillbenchEventSchema.parse(event)).toEqual(event);
  });

  it("requires a valid runner profile for model operations", () => {
    expect(
      skillbenchAutomationRequestSchema.parse({
        command: "compare",
        sourceA: "./a",
        sourceB: "./b",
        evals: "evals/development",
        profile: { runner: "claude", model: "claude-sonnet-4-6", reasoningEffort: "max" },
      }),
    ).toMatchObject({ profile: { runner: "claude" } });
    expect(
      skillbenchAutomationRequestSchema.parse({
        command: "eval",
        source: "./skill",
        evals: "evals/development",
        profile: {
          runner: "opencode",
          model: "anthropic/claude-sonnet-4-6",
          variant: "high",
        },
      }),
    ).toMatchObject({ profile: { runner: "opencode", variant: "high" } });
    expect(
      skillbenchAutomationRequestSchema.parse({
        command: "eval",
        source: "./skill",
        evals: "evals/development",
        profile: { runner: "opencode" },
      }),
    ).toMatchObject({ profile: { runner: "opencode" } });
    expect(() =>
      skillbenchAutomationRequestSchema.parse({
        command: "eval",
        source: "./skill",
        evals: "evals/development",
        profile: { runner: "codex", reasoningEffort: "low" },
      }),
    ).toThrow();
    expect(() =>
      skillbenchAutomationRequestSchema.parse({
        command: "eval",
        source: "./skill",
        evals: "evals/development",
        profile: { runner: "opencode", model: "claude-sonnet-4-6" },
      }),
    ).toThrow(/provider\/model/u);
  });
});
