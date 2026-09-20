// Registered by the Web request scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { buildCliArguments, webJobRequestSchema } from "../src/jobs";
import { AUTOMATION_REQUEST_FIXTURES } from "./fixtures/automation";

describe("Web job request", () => {
  it("maps every shared automation fixture to a supported CLI command", () => {
    for (const fixture of AUTOMATION_REQUEST_FIXTURES) {
      const request = webJobRequestSchema.parse(fixture.request);
      const argv = buildCliArguments(request, "/tmp/output");
      expect(argv).toContain(request.command);
      expect(argv).toContain("/tmp/output");
    }
  });

  it("maps a typed comparison to argv with mandatory delegated-mode flags", () => {
    const request = webJobRequestSchema.parse({
      command: "compare",
      sourceA: "./local",
      sourceB: "https://github.com/acme/skills/tree/main/demo",
      evals: "./evals/development",
      profile: { runner: "mock" },
    });
    const argv = buildCliArguments(request, "/tmp/output");

    expect(argv).toContain("--no-history");
    expect(argv).toContain("--no-input");
    expect(argv).toContain("--jsonl");
    expect(argv).toContain("--yes");
    expect(argv).toContain("compare");
    expect(argv.at(-1)).toBe("/tmp/output");
  });

  it("rejects unknown fields instead of exposing arbitrary argv", () => {
    expect(() =>
      webJobRequestSchema.parse({ command: "inspect", source: "./skill", argv: ["--debug"] }),
    ).toThrow();
  });

  it("rejects an incomplete paid profile before a job is created", () => {
    expect(() =>
      webJobRequestSchema.parse({
        command: "eval",
        source: "./skill",
        evals: "./evals/development",
        profile: { runner: "codex", reasoningEffort: "low" },
      }),
    ).toThrow();
  });

  it("maps Claude through the same shared runner contract", () => {
    const request = webJobRequestSchema.parse({
      command: "eval",
      source: "./skill",
      evals: "./evals/development",
      profile: {
        runner: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "max",
      },
    });
    expect(buildCliArguments(request, "/tmp/output")).toContain("claude");
  });

  it("maps OpenCode model and optional variant without reasoning effort", () => {
    const request = webJobRequestSchema.parse({
      command: "eval",
      source: "./skill",
      evals: "./evals/development",
      profile: {
        runner: "opencode",
        model: "anthropic/claude-sonnet-4-6",
        variant: "high",
      },
    });
    const argv = buildCliArguments(request, "/tmp/output");
    expect(argv).toEqual(
      expect.arrayContaining([
        "--runner",
        "opencode",
        "--model",
        "anthropic/claude-sonnet-4-6",
        "--variant",
        "high",
      ]),
    );
    expect(argv).not.toContain("--reasoning-effort");
  });

  it("lets OpenCode choose its model when the profile omits one", () => {
    const request = webJobRequestSchema.parse({
      command: "eval",
      source: "./skill",
      evals: "./evals/development",
      profile: { runner: "opencode" },
    });
    const argv = buildCliArguments(request, "/tmp/output");
    expect(argv).toEqual(expect.arrayContaining(["--runner", "opencode"]));
    expect(argv).not.toContain("--model");
  });
});
