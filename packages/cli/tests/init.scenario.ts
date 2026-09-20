// Registered by the CLI project lifecycle scenario suite.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadEvalSuite } from "@skillbench/sdk/evaluator";

import { initializeProject, shouldRecommendInitialization } from "../src/init";

describe("initializeProject", () => {
  it("creates configuration and eval files without storage", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-"));
    expect(shouldRecommendInitialization(cwd)).toBe(true);
    const result = initializeProject(cwd);

    expect(result.created).toHaveLength(8);
    const config = readFileSync(join(cwd, ".skillbench", "config.yaml"), "utf8");
    expect(config).not.toContain("storage:");
    expect(config).toContain('directory: ".skillbench/runs"');
    const active = readFileSync(
      join(cwd, ".skillbench", "evals", "development", "default.yaml"),
      "utf8",
    );
    const example = readFileSync(
      join(cwd, ".skillbench", "evals", "examples", "example.yaml"),
      "utf8",
    );
    expect(active).toContain("Create a release checklist");
    expect(active).toContain("RELEASE_CHECKLIST.md");
    expect(example).toContain("Reference only");
    expect(example).toContain("Prepare a release plan and risk register");
    expect(example).toContain("risk-register.json");
    expect(loadEvalSuite(join(cwd, ".skillbench", "evals", "development"))).toMatchObject({
      partition: "development",
      cases: [
        {
          id: "create-release-checklist",
          assertions: expect.arrayContaining([
            { type: "file-exists", value: "RELEASE_CHECKLIST.md" },
            {
              type: "contains",
              path: "RELEASE_CHECKLIST.md",
              value: "# Release checklist",
            },
            {
              type: "llm-rubric",
              rubric: "The checklist is concise, actionable, and easy to scan.",
            },
          ]),
        },
      ],
    });
    expect(
      loadEvalSuite(join(cwd, ".skillbench", "evals", "examples", "example.yaml"), {
        partition: "development",
      }),
    ).toMatchObject({
      cases: [
        {
          id: "prepare-release-plan",
          assertions: expect.arrayContaining([
            {
              type: "llm-rubric",
              rubric: expect.stringContaining("rollback readiness"),
            },
          ]),
        },
      ],
    });
    expect(existsSync(join(cwd, ".skillbench", "assets.yaml"))).toBe(true);
    expect(existsSync(join(cwd, ".skillbench", "reports", "comparison.md"))).toBe(true);
    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
    expect(gitignore).toContain(".skillbench/runs/");
    expect(gitignore).not.toContain(".skillbench/\n");
    expect(shouldRecommendInitialization(cwd)).toBe(false);
    expect(() => initializeProject(cwd)).toThrow(/overwrite existing files/u);
  });

  it("limits --force to the known starter files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-force-"));
    initializeProject(cwd);
    const preservedRun = join(cwd, ".skillbench", "runs", "inspect", "personal.txt");
    mkdirSync(join(cwd, ".skillbench", "runs", "inspect"), { recursive: true });
    writeFileSync(preservedRun, "keep", "utf8");

    expect(() => initializeProject(cwd, { force: true })).not.toThrow();
    expect(readFileSync(preservedRun, "utf8")).toBe("keep");
  });

  it("preserves existing gitignore rules and adds generated state once", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-ignore-"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\n", "utf8");

    initializeProject(cwd);
    initializeProject(cwd, { force: true });

    expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(
      [
        "node_modules/",
        ".skillbench/runs/",
        ".skillbench/tmp/",
        ".skillbench/promptfoo/",
        ".skillbench/cli-history.json",
        ".skillbench/web/",
        ".skillbench/skillbench-web.sqlite",
        "",
      ].join("\n"),
    );
  });

  it("stores a custom runs directory without creating it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-output-"));
    const result = initializeProject(cwd, { outputsDirectory: "artifacts/skillbench" });

    expect(result.outputsDirectory).toBe("artifacts/skillbench");
    expect(readFileSync(join(cwd, ".skillbench", "config.yaml"), "utf8")).toContain(
      'directory: "artifacts/skillbench"',
    );
    expect(existsSync(join(cwd, "artifacts"))).toBe(false);
  });

  it("recognizes an initialized project from a nested directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-nested-"));
    const nested = join(cwd, "skills", "example");
    mkdirSync(nested, { recursive: true });
    initializeProject(cwd);

    expect(shouldRecommendInitialization(nested)).toBe(false);
  });
});
