// Registered by the CLI project lifecycle scenario suite.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { initializeProject, shouldRecommendInitialization } from "../src/init";

describe("initializeProject", () => {
  it("creates configuration and eval files without storage", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-"));
    expect(shouldRecommendInitialization(cwd)).toBe(true);
    const result = initializeProject(cwd);

    expect(result.created).toHaveLength(7);
    expect(readFileSync(join(cwd, "skillbench.yaml"), "utf8")).not.toContain("storage:");
    expect(existsSync(join(cwd, "evals", "development", "example.yaml"))).toBe(true);
    expect(existsSync(join(cwd, "skillbench", "assets.yaml"))).toBe(true);
    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain(".skillbench/");
    expect(existsSync(join(cwd, ".skillbench"))).toBe(false);
    expect(shouldRecommendInitialization(cwd)).toBe(false);
    expect(() => initializeProject(cwd)).toThrow(/overwrite existing files/u);
  });

  it("limits --force to the known starter files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-force-"));
    initializeProject(cwd);
    expect(() => initializeProject(cwd, { force: true })).not.toThrow();
  });

  it("preserves existing gitignore rules and adds generated state once", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-ignore-"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n", "utf8");

    initializeProject(cwd);
    initializeProject(cwd, { force: true });

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
      "node_modules/\n.skillbench/\n",
    );
  });
});
