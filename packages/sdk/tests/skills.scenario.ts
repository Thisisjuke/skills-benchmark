// Registered by the SDK source scenario suite.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { fingerprintFiles, hashBytes, parseSkill, type SkillFile } from "@skillbench/sdk/skills";

function file(relativePath: string, content: string): SkillFile {
  const bytes = new TextEncoder().encode(content);
  return {
    relativePath,
    content: bytes,
    contentHash: hashBytes(bytes),
    sizeBytes: bytes.byteLength,
  };
}

describe("skill parser and fingerprint", () => {
  it("parses frontmatter and relative references", () => {
    const content = readFileSync(resolve("tests/fixtures/skills/basic/SKILL.md"), "utf8");
    const parsed = parseSkill([file("SKILL.md", content)]);

    expect(parsed.name).toBe("basic-skill");
    expect(parsed.metadata).toEqual({ category: "fixture" });
    expect(parsed.relativeReferences).toEqual(["references/guide.md", "scripts/check.ts"]);
  });

  it("is independent from input order and changes with file content", () => {
    const first = file("SKILL.md", "---\nname: x\ndescription: x\n---\n");
    const reference = file("references/a.md", "one");
    const changedReference = file("references/a.md", "two");

    expect(fingerprintFiles([first, reference])).toBe(fingerprintFiles([reference, first]));
    expect(fingerprintFiles([first, reference])).not.toBe(
      fingerprintFiles([first, changedReference]),
    );
  });

  it("requires valid frontmatter", () => {
    expect(() => parseSkill([file("SKILL.md", "# Missing frontmatter")])).toThrow(/frontmatter/);
  });
});
