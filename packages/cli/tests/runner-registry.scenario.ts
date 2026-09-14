// Registered by the CLI protocol scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { silentLogger } from "@skillbench/sdk/logging";
import { MOCK_EXECUTION_PROFILE, MockRunner } from "@skillbench/sdk/runners";
import { createRunnerRegistry, type RunnerDefinition } from "../src/composition/runner-registry";
import { executableForChoice } from "../src/composition/execution-runtime";
import { skillbenchConfigSchema } from "../src/config";

const fixtureDefinition: RunnerDefinition = {
  id: "fixture",
  name: "Fixture",
  label: "Runner factice",
  hint: "Preuve d’extension du registre",
  capabilities: {
    incursModelCalls: false,
    comparisonJudge: false,
  },
  defaultExecutable: "fixture",
  efforts: [],
  acceptsEffort: () => false,
  createChoice: () => ({ runner: "mock" }),
  create: async () => ({
    runner: new MockRunner(),
    executionProfile: MOCK_EXECUTION_PROFILE,
  }),
  matches: (profile) => profile.runner === "fixture",
  formatProfile: (profile) => `${profile.runner} ${profile.runnerVersion}`,
  profileConfig: (profile) => ({ type: profile.runner }),
};

describe("runner registry", () => {
  it("uses the executable belonging to the selected runner", () => {
    const config = skillbenchConfigSchema.parse({
      runner: {
        type: "codex",
        executable: "custom-codex",
        model: "gpt-test",
        reasoningEffort: "low",
      },
    });

    expect(
      executableForChoice(config, {
        runner: "codex",
        model: "gpt-test",
        reasoningEffort: "low",
      }),
    ).toBe("custom-codex");
    expect(
      executableForChoice(config, {
        runner: "claude",
        model: "claude-test",
        reasoningEffort: "low",
      }),
    ).toBe("claude");

    const claudeConfig = skillbenchConfigSchema.parse({
      runner: {
        type: "claude",
        executable: "custom-claude",
        model: "claude-test",
        reasoningEffort: "low",
      },
    });
    expect(
      executableForChoice(claudeConfig, {
        runner: "codex",
        model: "gpt-test",
        reasoningEffort: "low",
      }),
    ).toBe("codex");
  });

  it("derives lookup, labels and runtime creation from one additional definition", async () => {
    const registry = createRunnerRegistry([fixtureDefinition]);

    expect(registry.definitions.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "fixture", label: "Runner factice" },
    ]);
    expect(
      registry.definition("fixture").formatProfile({
        runner: "fixture",
        runnerVersion: "fixture-v1",
      }),
    ).toBe("fixture fixture-v1");
    await expect(
      registry.definition("fixture").create(
        {
          executable: "fixture",
          sandbox: "read-only",
          maxOutputBytes: 1024,
          logger: silentLogger,
        },
        { runner: "mock" },
      ),
    ).resolves.toMatchObject({ executionProfile: MOCK_EXECUTION_PROFILE });
  });

  it("rejects ambiguous definitions", () => {
    expect(() => createRunnerRegistry([fixtureDefinition, fixtureDefinition])).toThrow(
      /identifiers must be unique/,
    );
  });
});
