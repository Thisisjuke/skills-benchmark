// Registered by the CLI project lifecycle scenario suite.
import {
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadProjectRuntimeAssets } from "../src/assets";
import { initializeProject } from "../src/init";

describe("project runtime assets", () => {
  it("fingerprints local edits and never falls back when an asset is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-assets-"));
    initializeProject(cwd);
    const instruction = join(cwd, "skillbench", "prompts", "judge-instruction.txt");
    const initial = loadProjectRuntimeAssets(cwd);

    writeFileSync(instruction, `${readFileSync(instruction, "utf8")}\nBe concise.\n`, "utf8");
    const changed = loadProjectRuntimeAssets(cwd);
    expect(changed.judgeInstruction.contentHash).not.toBe(
      initial.judgeInstruction.contentHash,
    );

    unlinkSync(instruction);
    expect(() => loadProjectRuntimeAssets(cwd)).toThrow(/skillbench init --force/u);
  });

  it("rejects an instruction symlink that escapes the project", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-assets-"));
    const outside = join(mkdtempSync(join(tmpdir(), "skillbench-outside-")), "prompt.txt");
    initializeProject(cwd);
    const instruction = join(cwd, "skillbench", "prompts", "judge-instruction.txt");
    writeFileSync(outside, "External instructions", "utf8");
    unlinkSync(instruction);
    symlinkSync(outside, instruction);

    expect(() => loadProjectRuntimeAssets(cwd)).toThrow(/skillbench init --force/u);
  });
});
