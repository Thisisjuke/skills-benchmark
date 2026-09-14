// Registered by the CLI protocol scenario suite.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  SKILLBENCH_OPERATIONS,
  skillbenchAutomationRequestSchema,
  skillbenchEventSchema,
  sourceProviderIdSchema,
} from "@thisisjuke/skillbench/contracts";
import { skillbenchBundleManifestSchema } from "@thisisjuke/skillbench/contracts/bundles";
import { resolveSkillbenchCliPath } from "@thisisjuke/skillbench/cli-path";
import { describe, expect, it } from "vite-plus/test";

describe("public package contracts", () => {
  it("exports the supported automation and protocol boundary", () => {
    expect(SKILLBENCH_OPERATIONS).toEqual(["inspect", "eval", "compare", "merge"]);
    expect(
      skillbenchAutomationRequestSchema.parse({ command: "inspect", source: "./skill" }),
    ).toEqual({ command: "inspect", source: "./skill" });
    expect(
      skillbenchEventSchema.parse({
        schemaVersion: 1,
        event: "started",
        command: "inspect",
        jobId: "job-1",
        timestamp: "2026-09-10T00:00:00.000Z",
        data: {},
      }).event,
    ).toBe("started");
    expect(sourceProviderIdSchema.parse("github")).toBe("github");
  });

  it("exports bundle validation without exposing an internal workspace import", () => {
    expect(
      skillbenchBundleManifestSchema.safeParse({
        schemaVersion: 1,
        kind: "skillbench-bundle",
        status: "complete",
        command: "inspect",
      }).success,
    ).toBe(false);
  });

  it("resolves the installed CLI through a supported entrypoint", () => {
    const cliPath = resolveSkillbenchCliPath();
    expect(cliPath.endsWith("cli.mjs")).toBe(true);
    expect(existsSync(cliPath)).toBe(true);
  });

  it("keeps CLI output observable when invoked as a child process", () => {
    const result = spawnSync(process.execPath, [resolveSkillbenchCliPath(), "--help"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: skillbench");
  });
});
