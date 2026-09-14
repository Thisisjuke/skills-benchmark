// Registered by the CLI project lifecycle scenario suite.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("resolves safe defaults relative to the working directory", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    const { config, configFile } = loadConfig({ cwd });

    expect(configFile).toBeUndefined();
    expect(config.runner.type).toBe("codex");
    expect(config.runner).toMatchObject({
      executable: "codex",
      sandbox: "workspace-write",
      maxOutputBytes: 1024 * 1024,
    });
    expect(config.eval.repeat).toBe(3);
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
    expect(config.reports).toEqual({ markdown: true });
  });

  it("loads YAML overrides and reports the invalid field", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(join(cwd, "skillbench.yaml"), "eval:\n  repeat: 5\n");
    expect(loadConfig({ cwd }).config.eval.repeat).toBe(5);

    writeFileSync(join(cwd, "skillbench.yaml"), "eval:\n  repeat: 0\n");
    expect(() => loadConfig({ cwd })).toThrow(/eval\.repeat/);
  });

  it("discovers the nearest initialized project from a nested directory", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-config-root-"));
    const nested = join(root, "skills", "example");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "skillbench.yaml"), "eval:\n  repeat: 5\n");

    const loaded = loadConfig({ cwd: nested });

    expect(loaded.projectRoot).toBe(root);
    expect(loaded.configFile).toBe(join(root, "skillbench.yaml"));
    expect(loaded.config.eval.repeat).toBe(5);
  });

  it("rejects unknown configuration keys", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(join(cwd, "skillbench.yaml"), "server:\n  port: 3000\n");
    expect(() => loadConfig({ cwd })).toThrow(/server/);

    writeFileSync(join(cwd, "skillbench.yaml"), "storage:\n  path: obsolete.sqlite\n");
    expect(() => loadConfig({ cwd })).toThrow(/storage/);
  });

  it("validates Codex runner process controls", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(
      join(cwd, "skillbench.yaml"),
      "runner:\n  type: codex\n  model: gpt-example\n  reasoningEffort: high\n  sandbox: read-only\n  maxOutputBytes: 2048\n",
    );
    expect(loadConfig({ cwd }).config.runner).toMatchObject({
      model: "gpt-example",
      reasoningEffort: "high",
      sandbox: "read-only",
      maxOutputBytes: 2048,
    });

    writeFileSync(join(cwd, "skillbench.yaml"), "runner:\n  sandbox: danger-full-access\n");
    expect(() => loadConfig({ cwd })).toThrow(/runner\.sandbox/u);

    writeFileSync(join(cwd, "skillbench.yaml"), "runner:\n  reasoningEffort: extreme\n");
    expect(() => loadConfig({ cwd })).toThrow(/runner\.reasoningEffort/u);
  });

  it("selects Claude defaults and validates its effort levels", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(
      join(cwd, "skillbench.yaml"),
      "runner:\n  type: claude\n  model: claude-sonnet-4-6\n  reasoningEffort: max\n",
    );
    expect(loadConfig({ cwd }).config.runner).toMatchObject({
      type: "claude",
      executable: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });

    writeFileSync(
      join(cwd, "skillbench.yaml"),
      "runner:\n  type: claude\n  reasoningEffort: minimal\n",
    );
    expect(() => loadConfig({ cwd })).toThrow(/Claude effort/u);
  });

  it("can disable the pinned Promptfoo assertion adapter explicitly", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(join(cwd, "skillbench.yaml"), "promptfoo:\n  enabled: false\n");
    expect(loadConfig({ cwd }).config.promptfoo).toEqual({ enabled: false });
    writeFileSync(join(cwd, "skillbench.yaml"), "promptfoo:\n  version: 0.121.0\n");
    expect(() => loadConfig({ cwd })).toThrow(/promptfoo.*version/u);
  });

  it("rejects comparison weights that are not normalized or functionally dominant", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-config-"));
    writeFileSync(join(cwd, "skillbench.yaml"), "comparison:\n  weights:\n    latency: 0.10\n");
    expect(() => loadConfig({ cwd })).toThrow(/sum to 1/u);

    writeFileSync(
      join(cwd, "skillbench.yaml"),
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
});
