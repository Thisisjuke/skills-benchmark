// Registered by the SDK source scenario suite.
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { LocalSourceResolver } from "@skillbench/sdk/sources/local";

const policy = { maxFileSizeBytes: 1024 * 1024, maxSnapshotSizeBytes: 4 * 1024 * 1024 };

describe("LocalSourceResolver", () => {
  it("resolves relative inputs from its injected base directory", async () => {
    const resolver = new LocalSourceResolver(policy, {
      baseDirectory: resolve("tests/fixtures"),
    });

    const result = await resolver.resolve("skills/basic");

    expect(result.snapshot.rootPath).toBe(resolve("tests/fixtures/skills/basic"));
  });

  it("snapshots a complete skill directory deterministically", async () => {
    const resolver = new LocalSourceResolver(policy);
    const first = await resolver.resolve("tests/fixtures/skills/basic", { now: new Date(0) });
    const second = await resolver.resolve("tests/fixtures/skills/basic/SKILL.md", {
      now: new Date("2025-01-01"),
    });

    expect(first.snapshot.rootPath).toBe(resolve("tests/fixtures/skills/basic"));
    expect(first.snapshot.files.map((entry) => entry.relativePath)).toEqual([
      "references/guide.md",
      "scripts/check.ts",
      "SKILL.md",
    ]);
    expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
    expect(first.snapshot.fetchedAt).not.toBe(second.snapshot.fetchedAt);
  });

  it("does not include the absolute root path in the fingerprint", async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "skillbench-source-a-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "skillbench-source-b-"));
    const markdown = "---\nname: x\ndescription: x\n---\n";
    writeFileSync(join(firstRoot, "SKILL.md"), markdown);
    writeFileSync(join(secondRoot, "SKILL.md"), markdown);

    const resolver = new LocalSourceResolver(policy);
    const first = await resolver.resolve(firstRoot);
    const second = await resolver.resolve(secondRoot);
    expect(first.snapshot.rootPath).not.toBe(second.snapshot.rootPath);
    expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
  });

  it("rejects symlinks instead of reading outside the skill root", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-source-"));
    writeFileSync(join(root, "SKILL.md"), "---\nname: x\ndescription: x\n---\n");
    symlinkSync("/etc/hosts", join(root, "hosts"));

    await expect(new LocalSourceResolver(policy).resolve(root)).rejects.toThrow(/Symbolic links/);
  });

  it("enforces the snapshot size policy", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-source-"));
    mkdirSync(join(root, "references"));
    writeFileSync(join(root, "SKILL.md"), "---\nname: x\ndescription: x\n---\n");
    writeFileSync(join(root, "references", "large.md"), "x".repeat(100));

    await expect(
      new LocalSourceResolver({ maxFileSizeBytes: 60, maxSnapshotSizeBytes: 120 }).resolve(root),
    ).rejects.toThrow(/maxFileSizeBytes/);
  });
});
