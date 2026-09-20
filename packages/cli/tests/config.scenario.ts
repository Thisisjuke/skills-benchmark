// Registered by the CLI project lifecycle scenario suite.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { addConfiguredRunner, loadConfig } from "../src/config";

function writeConfig(cwd: string, content: string): void {
  mkdirSync(join(cwd, ".skillbench"), { recursive: true });
  writeFileSync(join(cwd, ".skillbench", "config.yaml"), content);
}

describe("loadConfig", () => {
  it("resolves safe defaults relative to the working directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    const { config, configFile } = loadConfig({ cwd });

    expect(configFile).toBeUndefined();
    expect(config.runners).toHaveLength(1);
    expect(config.runners[0]).toMatchObject({
      type: "mock",
      executable: "mock",
      sandbox: "workspace-write",
      maxOutputBytes: 1024 * 1024,
    });
    expect(config.eval.repeat).toBe(3);
    expect(config.eval.path).toBe(".skillbench/evals/development/default.yaml");
    expect(config.comparison.tieThreshold).toBe(0.01);
    expect(config.promptfoo).toEqual({ enabled: true });
    expect(
      Object.values(config.comparison.weights).reduce((sum, weight) => sum + weight, 0),
    ).toBeCloseTo(1, 12);
    expect(config.sources).toEqual({
      timeoutMs: 30_000,
      maxFileSizeBytes: 2 * 1024 * 1024,
      maxSnapshotSizeBytes: 25 * 1024 * 1024,
    });
    expect(config.reports).toEqual({
      markdown: true,
      template: ".skillbench/reports/comparison.md",
    });
    expect(config.outputs).toEqual({ directory: ".skillbench/runs" });
  });

  it("loads YAML overrides and reports the invalid field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(cwd, "eval:\n  repeat: 5\n");
    expect(loadConfig({ cwd }).config.eval.repeat).toBe(5);

    writeConfig(cwd, "eval:\n  repeat: 0\n");
    expect(() => loadConfig({ cwd })).toThrow(/eval\.repeat/);
  });

  it("discovers the nearest initialized project from a nested directory", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-config-root-"));
    const nested = join(root, "skills", "example");
    mkdirSync(nested, { recursive: true });
    writeConfig(root, "eval:\n  repeat: 5\n");

    const loaded = loadConfig({ cwd: nested });

    expect(loaded.projectRoot).toBe(root);
    expect(loaded.configFile).toBe(join(root, ".skillbench", "config.yaml"));
    expect(loaded.config.eval.repeat).toBe(5);
  });

  it("rejects unknown configuration keys", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(cwd, "server:\n  port: 3000\n");
    expect(() => loadConfig({ cwd })).toThrow(/server/);

    writeConfig(cwd, "storage:\n  path: obsolete.sqlite\n");
    expect(() => loadConfig({ cwd })).toThrow(/storage/);
  });

  it("validates Codex runner process controls", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(
      cwd,
      "runners:\n  - type: codex\n    model: gpt-example\n    reasoningEffort: high\n    sandbox: read-only\n    maxOutputBytes: 2048\n",
    );
    expect(loadConfig({ cwd }).config.runners[0]).toMatchObject({
      model: "gpt-example",
      reasoningEffort: "high",
      sandbox: "read-only",
      maxOutputBytes: 2048,
    });

    writeConfig(cwd, "runners:\n  - type: mock\n    sandbox: danger-full-access\n");
    expect(() => loadConfig({ cwd })).toThrow(/runners\.0\.sandbox/u);

    writeConfig(cwd, "runners:\n  - type: codex\n    reasoningEffort: extreme\n");
    expect(() => loadConfig({ cwd })).toThrow(/runners\.0\.reasoningEffort/u);
  });

  it("selects Claude defaults and validates its effort levels", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(
      cwd,
      "runners:\n  - type: claude\n    model: claude-sonnet-4-6\n    reasoningEffort: max\n",
    );
    expect(loadConfig({ cwd }).config.runners[0]).toMatchObject({
      type: "claude",
      executable: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });

    writeConfig(
      cwd,
      "runners:\n  - type: claude\n    model: claude-sonnet-4-6\n    reasoningEffort: minimal\n",
    );
    expect(() => loadConfig({ cwd })).toThrow(/Claude effort/u);
  });

  it("loads an OpenCode profile and keeps variant provider-specific", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-opencode-"));
    writeConfig(
      cwd,
      "runners:\n  - type: opencode\n    model: anthropic/claude-sonnet-4-6\n    variant: high\n",
    );
    expect(loadConfig({ cwd }).config.runners[0]).toMatchObject({
      type: "opencode",
      executable: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
    });

    writeConfig(cwd, "runners:\n  - type: opencode\n    reasoningEffort: low\n");
    expect(() => loadConfig({ cwd })).toThrow(/reasoningEffort.*OpenCode/u);
    writeConfig(cwd, "runners:\n  - type: codex\n    model: gpt-test\n    reasoningEffort: low\n    variant: high\n");
    expect(() => loadConfig({ cwd })).toThrow(/variant.*Codex/u);
  });

  it("appends complete runners without replacing the config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-runners-"));
    writeConfig(
      cwd,
      [
        "# keep this comment",
        "runners:",
        "  - type: codex",
        "    model: gpt-existing",
        "    reasoningEffort: low",
        "",
      ].join("\n"),
    );
    const configFile = join(cwd, ".skillbench", "config.yaml");

    const added = {
      type: "opencode" as const,
      executable: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
      sandbox: "workspace-write" as const,
      maxOutputBytes: 1024 * 1024,
    };
    addConfiguredRunner(configFile, added);
    addConfiguredRunner(configFile, added);

    expect(loadConfig({ cwd }).config.runners).toHaveLength(2);
    expect(loadConfig({ cwd }).config.runners[1]).toMatchObject(added);
    const source = readFileSync(configFile, "utf8");
    expect(source).toContain("# keep this comment");
    expect(source.match(/anthropic\/claude-sonnet-4-6/gu)).toHaveLength(1);
  });

  it("requires manual migration for the legacy runner field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-legacy-runner-"));
    writeConfig(cwd, "runner:\n  type: mock\n");

    expect(() => loadConfig({ cwd })).toThrow(/migrate it manually to the runners list/u);
  });

  it("can disable the pinned Promptfoo assertion adapter explicitly", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(cwd, "promptfoo:\n  enabled: false\n");
    expect(loadConfig({ cwd }).config.promptfoo).toEqual({ enabled: false });
    writeConfig(cwd, "promptfoo:\n  version: 0.121.0\n");
    expect(() => loadConfig({ cwd })).toThrow(/promptfoo.*version/u);
  });

  it("rejects comparison weights that are not normalized or functionally dominant", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeConfig(cwd, "comparison:\n  weights:\n    latency: 0.10\n");
    expect(() => loadConfig({ cwd })).toThrow(/sum to 1/u);

    writeConfig(
      cwd,
      [
        "comparison:",
        "  weights:",
        "    functionalCorrectness: 0.20",
        "    outputQuality: 0.40",
        "    edgeCases: 0.15",
        "    skillTriggering: 0.10",
        "    instructionFollowing: 0.05",
        "    tokenEfficiency: 0.05",
        "    latency: 0.05",
        "",
      ].join("\n"),
    );
    expect(() => loadConfig({ cwd })).toThrow(/functionalCorrectness/u);
  });

  it("ignores root-level legacy configs unless explicitly selected", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-legacy-"));
    writeFileSync(join(cwd, "skillbench.yaml"), "eval:\n  repeat: 5\n");

    expect(loadConfig({ cwd }).configFile).toBeUndefined();
    expect(loadConfig({ cwd }).config.eval.repeat).toBe(3);
    expect(loadConfig({ cwd, configPath: "skillbench.yaml" })).toMatchObject({
      configFile: join(cwd, "skillbench.yaml"),
      projectRoot: cwd,
      config: { eval: { repeat: 5 } },
    });
  });

  it("accepts a configured run directory and rejects an empty value", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-output-"));
    writeConfig(cwd, "outputs:\n  directory: artifacts/runs\n");
    expect(loadConfig({ cwd }).config.outputs.directory).toBe("artifacts/runs");

    writeConfig(cwd, "outputs:\n  directory: '   '\n");
    expect(() => loadConfig({ cwd })).toThrow(/outputs\.directory/u);
  });

  it("keeps the published and offline example configurations loadable", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-examples-"));
    const published = loadConfig({
      cwd,
      configPath: fileURLToPath(new URL("../skillbench.example.yaml", import.meta.url)),
    });
    const offline = loadConfig({
      cwd,
      configPath: fileURLToPath(
        new URL("../examples/basic/skillbench.yaml", import.meta.url),
      ),
    });

    expect(published.config.outputs.directory).toBe(".skillbench/runs");
    expect(offline.config).toMatchObject({
      runners: [{ type: "mock" }],
      outputs: { directory: ".skillbench/runs" },
    });
  });
});
