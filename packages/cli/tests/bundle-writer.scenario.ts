// Registered by the CLI project lifecycle scenario suite.
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { writeBundle } from "../src/bundles";
import { skillbenchBundleManifestSchema } from "@skillbench/sdk/bundles";
import { inspectSkill } from "@skillbench/sdk/inspect";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };

describe("writeBundle", () => {
  it("atomically writes a complete, portable bundle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-bundle-"));
    const skill = await new LocalSourceResolver(policy).resolve(
      resolve("tests/fixtures/skills/basic"),
    );
    const result = await inspectSkill({ resolve: async () => skill }, "fixture");
    const written = writeBundle({
      command: "inspect",
      jobId: "job-1",
      output: "result.skillbench",
      cwd,
      result,
      sources: [{ role: "skill", skill }],
      reportMarkdown: "# Inspection\n",
    });

    const manifest = skillbenchBundleManifestSchema.parse(
      JSON.parse(readFileSync(written.manifestPath, "utf8")),
    );
    expect(manifest).toMatchObject({
      status: "complete",
      command: "inspect",
      sources: [{ role: "skill", fingerprint: skill.snapshot.fingerprint }],
    });
    expect(readFileSync(join(written.path, "sources", "skill", "SKILL.md"), "utf8")).toContain(
      "basic-skill",
    );
    expect(readFileSync(written.reportPath, "utf8")).toBe("# Inspection\n");
    expect(manifest.reports).toEqual([
      expect.objectContaining({ id: "summary", path: "report.md" }),
    ]);
    for (const directory of ["sources", "reports", "artifacts", "instructions"]) {
      expect(statSync(join(written.path, directory)).isDirectory(), directory).toBe(true);
    }
  });

  it("refuses non-empty destinations and unsafe forced replacement", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-bundle-safe-"));
    const skill = await new LocalSourceResolver(policy).resolve(
      resolve("tests/fixtures/skills/basic"),
    );
    const destination = join(cwd, "existing");
    mkdirSync(destination);
    writeFileSync(join(destination, "personal.txt"), "keep");
    const input = {
      command: "inspect" as const,
      jobId: "job-1",
      output: destination,
      cwd,
      result: {},
      sources: [{ role: "skill" as const, skill }],
      reportMarkdown: "# Inspection\n",
    };

    expect(() => writeBundle(input)).toThrow(/not empty/u);
    expect(() => writeBundle({ ...input, force: true })).toThrow(/only replace/u);
    expect(readFileSync(join(destination, "personal.txt"), "utf8")).toBe("keep");
  });
});
