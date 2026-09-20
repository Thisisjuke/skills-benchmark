import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createProgram } from "../src/cli/program";
import {
  cancelled,
  interactiveEnabled,
  PromptSession,
  type PromptOption,
  type PromptPort,
} from "../src/cli/interactive";
import { estimateModelCalls } from "../src/application";
import { renderPreflight } from "../src/cli/renderers";
import { loadConfig, skillbenchConfigSchema } from "../src/config";
import { loadEvalSuite } from "@skillbench/sdk/evaluator";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { CliHistoryStore } from "../src/history";
import { initializeProject } from "../src/init";
import { loadProjectRuntimeAssets } from "../src/assets";

class ScriptedPrompts implements PromptPort {
  readonly calls: string[] = [];
  readonly selections: Array<{
    message: string;
    options: PromptOption<string>[];
    initialValue?: string;
  }> = [];

  constructor(private readonly answers: Array<string | boolean | Error>) {}

  async select<Value extends string>(input: {
    message: string;
    options: PromptOption<Value>[];
    initialValue?: Value;
  }): Promise<Value> {
    this.calls.push(`select:${input.message}`);
    this.selections.push(input as (typeof this.selections)[number]);
    const answer = this.answers.shift();
    if (answer instanceof Error) throw answer;
    return answer as Value;
  }

  async text(input: { message: string; defaultValue?: string }): Promise<string> {
    this.calls.push(`text:${input.message}`);
    const answer = this.answers.shift() as string;
    return answer === "" ? (input.defaultValue ?? answer) : answer;
  }

  async confirm(input: { message: string }): Promise<boolean> {
    this.calls.push(`confirm:${input.message}`);
    return this.answers.shift() as boolean;
  }

  cancel(message: string): void {
    this.calls.push(`cancel:${message}`);
  }

  note(_message: string, title?: string): void {
    this.calls.push(`note:${title ?? ""}`);
  }

  async progress<Value>(
    message: string,
    task: (update: (message: string) => void) => Promise<Value>,
  ): Promise<Value> {
    this.calls.push(`progress:${message}`);
    return task((nextMessage) => this.calls.push(`status:${nextMessage}`));
  }
}

function config() {
  return loadConfig({ cwd: mkdtempSync(join(tmpdir(), "skillbench-interactive-")) }).config;
}

function configuredCodex() {
  return skillbenchConfigSchema.parse({
    runners: [
      {
        type: "codex",
        model: "gpt-configured",
        reasoningEffort: "medium",
        sandbox: "workspace-write",
      },
      {
        type: "codex",
        model: "gpt-fast",
        reasoningEffort: "low",
        sandbox: "read-only",
      },
    ],
  });
}

async function mockPreflight() {
  const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };
  const skill = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
  return {
    operation: "eval" as const,
    skills: [skill],
    suite: loadEvalSuite("tests/fixtures/evals/development"),
    suiteInput: resolve("tests/fixtures/evals/development"),
    repeat: 1,
    executionProfile: { runner: "mock" as const, runnerVersion: "mock-v1" },
  };
}

describe("interactive CLI contracts", () => {
  it("initializes an incomplete project and resumes the requested comparison", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-interactive-resume-"));
    const prompts = new ScriptedPrompts([
      "mock",
      ".skillbench/runs",
      true,
      ".skillbench/reports/comparison.md",
      true,
    ]);
    const output: string[] = [];

    await createProgram({
      prompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: (value) => output.push(value),
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "compare",
      resolve("tests/fixtures/skills/basic"),
      resolve("tests/fixtures/skills/basic"),
      "--evals",
      resolve("tests/fixtures/evals/development"),
      "--repeat",
      "1",
    ]);

    expect(output.join("")).toContain("Comparison complete");
    expect(existsSync(join(cwd, ".skillbench", "assets.yaml"))).toBe(true);
    expect(loadConfig({ cwd }).config.outputs.directory).toBe(".skillbench/runs");
    expect(prompts.calls.filter((call) => call === "select:Which runner should be used?")).toEqual(
      [],
    );
    expect(prompts.calls).toContain(
      "select:Which runner should this project use by default?",
    );
  });

  it("uses explicit flags before prompts and configuration", async () => {
    const prompts = new ScriptedPrompts([]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });
    const selected = await session.runnerChoice(config(), {
      runner: "codex",
      model: "gpt-from-flag",
      reasoningEffort: "xhigh",
    });

    expect(selected.choice).toEqual({
      runner: "codex",
      model: "gpt-from-flag",
      reasoningEffort: "xhigh",
    });
    expect(prompts.calls).toEqual([]);
  });

  it("accepts the first configured runner as the default", async () => {
    const prompts = new ScriptedPrompts([true]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    const selected = await session.runnerChoice(configuredCodex(), {});
    expect(selected.choice).toEqual({
      runner: "codex",
      model: "gpt-configured",
      reasoningEffort: "medium",
    });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nCodex · gpt-configured · medium",
    ]);
  });

  it("selects another configured runner without asking for its profile again", async () => {
    const prompts = new ScriptedPrompts([false, "1"]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    const selected = await session.runnerChoice(configuredCodex(), {});

    expect(selected.choice).toEqual({
      runner: "codex",
      model: "gpt-fast",
      reasoningEffort: "low",
    });
    expect(selected.configuration).toMatchObject({ sandbox: "read-only" });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nCodex · gpt-configured · medium",
      "select:Which configured runner should be used?",
    ]);
    expect(prompts.selections[0]?.options).toEqual([
      { value: "0", label: "Codex · gpt-configured · medium" },
      { value: "1", label: "Codex · gpt-fast · low" },
      { value: "__skillbench_add_runner__", label: "Add a runner" },
    ]);
  });

  it("configures and persists a newly added runner", async () => {
    const configured = configuredCodex();
    const before = structuredClone(configured);
    const prompts = new ScriptedPrompts([
      false,
      "__skillbench_add_runner__",
      "claude",
      "claude-sonnet-4-6",
      "max",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });
    const added: unknown[] = [];

    const selected = await session.runnerChoice(configured, {}, {
      onRunnerAdded: (runner) => {
        added.push(runner);
      },
    });
    expect(selected.choice).toEqual({
      runner: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nCodex · gpt-configured · medium",
      "select:Which configured runner should be used?",
      "select:Which runner should be added?",
      "text:Enter a model identifier for Claude",
      "select:Which reasoning effort should be used?",
    ]);
    expect(added).toEqual([
      expect.objectContaining({
        type: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "max",
      }),
    ]);
    expect(configured).toEqual(before);
  });

  it("accepts the configured runner without prompting in no-input mode", async () => {
    const prompts = new ScriptedPrompts([]);
    const session = new PromptSession({ interactive: false, yes: false, prompts });

    const selected = await session.runnerChoice(configuredCodex(), {});
    expect(selected.choice).toEqual({
      runner: "codex",
      model: "gpt-configured",
      reasoningEffort: "medium",
    });
    expect(prompts.calls).toEqual([]);
  });

  it("initializes through inspect then reuses that runner for compare", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-inspect-compare-runner-"));
    const inspectPrompts = new ScriptedPrompts(["mock", ".skillbench/runs", true]);

    await createProgram({
      prompts: inspectPrompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: () => undefined,
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "inspect",
      resolve("tests/fixtures/skills/basic"),
    ]);

    const evals = resolve("tests/fixtures/evals/development");
    const comparePrompts = new ScriptedPrompts([
      true,
      ".skillbench/reports/comparison.md",
      true,
    ]);
    await createProgram({
      prompts: comparePrompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: () => undefined,
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "compare",
      resolve("tests/fixtures/skills/basic"),
      resolve("tests/fixtures/skills/basic"),
      "--evals",
      evals,
      "--repeat",
      "1",
    ]);

    expect(comparePrompts.calls).toContain("confirm:Use the default runner?\nMock");
    expect(comparePrompts.calls).not.toContain("select:Which configured runner should be used?");
  });

  it("persists a newly configured runner from a command", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-runner-override-"));
    initializeProject(cwd, {
      profile: {
        runner: "codex",
        model: "gpt-configured",
        reasoningEffort: "medium",
      },
    });
    const configPath = join(cwd, ".skillbench", "config.yaml");
    const prompts = new ScriptedPrompts([
      false,
      "__skillbench_add_runner__",
      "mock",
      true,
    ]);

    await createProgram({
      prompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: () => undefined,
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "eval",
      resolve("tests/fixtures/skills/basic"),
      "--evals",
      resolve("tests/fixtures/evals/development"),
      "--repeat",
      "1",
      "--no-output",
    ]);

    expect(loadConfig({ cwd }).config.runners).toHaveLength(2);
    expect(loadConfig({ cwd }).config.runners[1]).toMatchObject({ type: "mock" });
    expect(readFileSync(configPath, "utf8")).toContain("- type: mock");
  });

  it("lists configured evaluation files instead of requesting an opaque path", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-eval-prompt-"));
    initializeProject(cwd);
    const prompts = new ScriptedPrompts([
      true,
      ".skillbench/evals/development/default.yaml",
      true,
    ]);

    await createProgram({
      prompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: () => undefined,
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "eval",
      resolve("tests/fixtures/skills/basic"),
      "--repeat",
      "1",
      "--no-output",
    ]);

    expect(prompts.calls).toContain("select:Which development evaluation should be used?");
    expect(prompts.selections.at(-1)).toMatchObject({
      initialValue: ".skillbench/evals/development/default.yaml",
      options: [
        expect.objectContaining({
          label: "Create a release checklist",
          value: ".skillbench/evals/development/default.yaml",
        }),
      ],
    });
    expect(prompts.calls).toContain(
      "status:[1/1] Sending basic-skill, “Create a release checklist”, iteration 1 to Mock…",
    );
    expect(prompts.calls).toContain(
      "status:[1/1] Checking results for basic-skill, “Create a release checklist”, iteration 1…",
    );
  });

  it("validates a selected eval before asking for later compare inputs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-invalid-eval-prompt-"));
    initializeProject(cwd);
    const invalidEval = join(cwd, ".skillbench", "evals", "development", "invalid.yaml");
    writeFileSync(
      invalidEval,
      [
        "id: invalid-rubric",
        "name: Invalid rubric",
        "partition: development",
        "prompt: Test the invalid rubric.",
        "assertions:",
        "  - type: llm-rubric",
        "    value: This key is not supported.",
        "",
      ].join("\n"),
    );
    const prompts = new ScriptedPrompts([true]);

    await expect(
      createProgram({
        prompts,
        stdinIsTTY: true,
        stderrIsTTY: true,
        services: { cwd: () => cwd },
      }).parseAsync([
        "node",
        "skillbench",
        "compare",
        resolve("tests/fixtures/skills/basic"),
        resolve("tests/fixtures/skills/basic"),
        "--evals",
        invalidEval,
      ]),
    ).rejects.toMatchObject({ code: "EVAL_VALIDATION_ERROR" });

    expect(prompts.calls).toEqual(["confirm:Use the default runner?\nMock"]);
  });

  it("collects sources and a Codex profile interactively", async () => {
    const prompts = new ScriptedPrompts([
      "./local-skill",
      false,
      "__skillbench_add_runner__",
      "codex",
      "gpt-cheap",
      "low",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    expect(await session.requiredText(undefined, "skill", "Source ?")).toBe("./local-skill");
    expect((await session.runnerChoice(config(), {})).choice).toEqual({
      runner: "codex",
      model: "gpt-cheap",
      reasoningEffort: "low",
    });
    expect(prompts.calls).toEqual([
      "text:Source ?",
      "confirm:Use the default runner?\nMock",
      "select:Which configured runner should be used?",
      "select:Which runner should be added?",
      "text:Enter a model identifier for Codex",
      "select:Which reasoning effort should be used?",
    ]);
  });

  it("trims supplied text inputs and streams progress updates", async () => {
    const prompts = new ScriptedPrompts([]);
    const statuses: string[] = [];
    const session = new PromptSession({
      interactive: true,
      yes: false,
      prompts,
      onStatus: (message, current, total) => statuses.push(`${current}/${total}:${message}`),
    });

    await expect(session.requiredText("  ./local-skill  ", "skill", "Source ?")).resolves.toBe(
      "./local-skill",
    );
    await expect(session.value("  evals/default.yaml  ", "Evals ?", "fallback")).resolves.toBe(
      "evals/default.yaml",
    );
    await session.progress("Comparing skills", async () => {
      session.status("Sending iteration to Codex…", 1, 2);
      session.status("Checking iteration results…", 1, 2);
    });

    expect(prompts.calls).toEqual([
      "progress:Comparing skills",
      "status:[1/2] Sending iteration to Codex…",
      "status:[1/2] Checking iteration results…",
    ]);
    expect(statuses).toEqual([
      "1/2:Sending iteration to Codex…",
      "1/2:Checking iteration results…",
    ]);
  });

  it("collects a Claude model and provider-supported effort interactively", async () => {
    const prompts = new ScriptedPrompts([
      false,
      "__skillbench_add_runner__",
      "claude",
      "claude-sonnet-4-6",
      "max",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    expect((await session.runnerChoice(config(), {})).choice).toEqual({
      runner: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nMock",
      "select:Which configured runner should be used?",
      "select:Which runner should be added?",
      "text:Enter a model identifier for Claude",
      "select:Which reasoning effort should be used?",
    ]);
  });

  it("collects an OpenCode provider/model and optional variant without an effort prompt", async () => {
    const prompts = new ScriptedPrompts([
      false,
      "__skillbench_add_runner__",
      "opencode",
      true,
      "anthropic/claude-sonnet-4-6",
      "high",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    expect((await session.runnerChoice(config(), {})).choice).toEqual({
      runner: "opencode",
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
    });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nMock",
      "select:Which configured runner should be used?",
      "select:Which runner should be added?",
      "confirm:Choose an OpenCode model explicitly?",
      "text:Enter a model identifier for OpenCode",
      "text:Which OpenCode variant should be used? (optional)",
    ]);
  });

  it("lets OpenCode resolve its model when explicit selection is declined", async () => {
    const prompts = new ScriptedPrompts([
      false,
      "__skillbench_add_runner__",
      "opencode",
      false,
      "",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    expect((await session.runnerChoice(config(), {})).choice).toEqual({ runner: "opencode" });
    expect(prompts.calls).toEqual([
      "confirm:Use the default runner?\nMock",
      "select:Which configured runner should be used?",
      "select:Which runner should be added?",
      "confirm:Choose an OpenCode model explicitly?",
      "text:Which OpenCode variant should be used? (optional)",
    ]);
  });

  it("accepts the recommended Codex model when init submits the model prompt empty", async () => {
    const prompts = new ScriptedPrompts([
      "codex",
      "",
      "low",
    ]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    await expect(session.initializationRunnerChoice({})).resolves.toEqual({
      runner: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    expect(prompts.calls).toEqual([
      "select:Which runner should this project use by default?",
      "text:Enter a model identifier for Codex",
      "select:Which reasoning effort should be the project default?",
    ]);
  });

  it("never prompts in JSON/no-input mode and does not invent a missing model", async () => {
    const prompts = new ScriptedPrompts(["must-not-be-read"]);
    const session = new PromptSession({ interactive: false, yes: true, prompts });

    await expect(session.requiredText(undefined, "skill-a", "Source A ?")).rejects.toMatchObject({
      code: "CLI_INPUT_REQUIRED",
    });
    await expect(session.runnerChoice(config(), { runner: "codex" })).rejects.toMatchObject({
      code: "CODEX_PROFILE_REQUIRED",
    });
    expect(prompts.calls).toEqual([]);
    expect(
      interactiveEnabled({
        stdinIsTTY: true,
        stderrIsTTY: true,
        json: true,
        inputEnabled: true,
      }),
    ).toBe(false);
  });

  it("never reuses a configured profile for a different runner", async () => {
    const session = new PromptSession({
      interactive: false,
      yes: true,
      prompts: new ScriptedPrompts([]),
    });

    await expect(session.runnerChoice(config(), { runner: "claude" })).rejects.toMatchObject({
      code: "CLAUDE_PROFILE_REQUIRED",
    });
    const selected = await session.runnerChoice(config(), {
      runner: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });
    expect(selected.choice).toEqual({
      runner: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });
  });

  it("skips only confirmation with --yes and maps refusal to exit code 130", async () => {
    const acceptedPrompts = new ScriptedPrompts([]);
    await new PromptSession({
      interactive: true,
      yes: true,
      prompts: acceptedPrompts,
    }).confirmPreflight(await mockPreflight());
    expect(acceptedPrompts.calls).toEqual(["note:Preflight"]);

    const refusedPrompts = new ScriptedPrompts([false]);
    await expect(
      new PromptSession({
        interactive: true,
        yes: false,
        prompts: refusedPrompts,
      }).confirmPreflight(await mockPreflight()),
    ).rejects.toMatchObject({ code: "CLI_CANCELLED", exitCode: 130 });
  });

  it("selects a discovered GitHub skill only in interactive mode", async () => {
    const prompts = new ScriptedPrompts(["skills/b/SKILL.md"]);
    const interactive = new PromptSession({ interactive: true, yes: false, prompts });
    expect(await interactive.chooseSkill(["skills/a/SKILL.md", "skills/b/SKILL.md"])).toBe(
      "skills/b/SKILL.md",
    );
    expect(prompts.calls).toEqual(["select:Which SKILL.md should be used?"]);

    await expect(
      new PromptSession({
        interactive: false,
        yes: false,
        prompts: new ScriptedPrompts([]),
      }).chooseSkill(["skills/a/SKILL.md", "skills/b/SKILL.md"]),
    ).rejects.toMatchObject({ code: "GITHUB_SKILL_SELECTION_REQUIRED" });
  });

  it("renders prominent notices through the terminal prompt composition", () => {
    const prompts = new ScriptedPrompts([]);
    const session = new PromptSession({ interactive: true, yes: false, prompts });

    session.notice("The sources address different task categories.", "Merge skipped");

    expect(prompts.calls).toEqual(["note:Merge skipped"]);
  });

  it("opens a command selector when the root command runs in a TTY", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-root-selector-"));
    const output: string[] = [];
    const selectingPrompts = new ScriptedPrompts([
      "inspect",
      "mock",
      ".skillbench/runs",
      true,
      resolve("tests/fixtures/skills/basic"),
    ]);
    await createProgram({
      prompts: selectingPrompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: (value) => output.push(value),
      services: { cwd: () => cwd },
    }).parseAsync(["node", "skillbench"]);
    expect(selectingPrompts.calls).toEqual([
      "select:What would you like to do?",
      "select:Which runner should this project use by default?",
      "text:Where should Skillbench save its runs?",
      "note:Project initialization",
      "confirm:Create these project files?",
      "text:Which skill should be inspected (path or GitHub URL)?",
      "progress:Resolving source",
    ]);
    expect(selectingPrompts.selections[0]).toMatchObject({ initialValue: "init" });
    expect(
      selectingPrompts.selections[0]?.options.find((option) => option.value === "init")?.hint,
    ).toContain("Recommended");
    expect(output.join("")).toContain("Name: basic-skill");
    expect(existsSync(join(cwd, ".skillbench", "config.yaml"))).toBe(true);

    const prompts = new ScriptedPrompts([]);
    prompts.select = async (input) => {
      prompts.calls.push(`select:${input.message}`);
      throw cancelled();
    };
    await expect(
      createProgram({ prompts, stdinIsTTY: true, stderrIsTTY: true }).parseAsync([
        "node",
        "skillbench",
      ]),
    ).rejects.toMatchObject({ code: "CLI_CANCELLED", exitCode: 130 });
    expect(prompts.calls).toEqual(["select:What would you like to do?"]);
  });

  it("infers Codex from non-interactive model flags through injected services", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-injected-cli-"));
    const evals = join(cwd, "evals");
    mkdirSync(evals);
    writeFileSync(
      join(evals, "case.yaml"),
      "id: flags\nname: flags\npartition: development\nprompt: test\nassertions:\n  - type: exit-code\n    value: 0\n",
    );
    initializeProject(cwd);
    const prompts = new ScriptedPrompts(["must-not-be-read"]);
    const output: string[] = [];
    const choices: unknown[] = [];
    await createProgram({
      prompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: (value) => output.push(value),
      services: {
        cwd: () => cwd,
        createExecutionRuntime: async (_config, _logger, choice, _root, configuration) => {
          choices.push(choice);
          return {
            executionProfile: {
              runner: "codex",
              runnerVersion: "codex-cli 0.153.0",
              model: choice.model!,
              reasoningEffort: choice.reasoningEffort!,
            },
            runner: {
              run: async () => ({
                status: "completed" as const,
                exitCode: 0,
                stdout: "ok",
                stderr: "",
                durationMs: 1,
                artifacts: [],
              }),
            },
            assertions: {
              evaluate: async (assertion) => ({
                type: assertion.type,
                status: "passed" as const,
                passed: true,
                score: 1,
                message: "ok",
                evidence: {},
                durationMs: 0,
              }),
            },
            instructionAssets: loadProjectRuntimeAssets(cwd),
            configuration: configuration!,
          };
        },
      },
    }).parseAsync([
      "node",
      "skillbench",
      "eval",
      resolve("tests/fixtures/skills/basic"),
      "--evals",
      evals,
      "--model",
      "gpt-from-flag",
      "--reasoning-effort",
      "low",
      "--no-input",
      "--json",
    ]);

    expect(prompts.calls).toEqual([]);
    expect(choices).toEqual([{ runner: "codex", model: "gpt-from-flag", reasoningEffort: "low" }]);
    const envelope = JSON.parse(output.join("")) as {
      schemaVersion: number;
      type: string;
      command: string;
      data: { runId: string; executionProfile: unknown };
    };
    expect(envelope).toMatchObject({ schemaVersion: 1, type: "result", command: "eval" });
    const summary = envelope.data;
    expect(summary.executionProfile).toEqual({
      runner: "codex",
      runnerVersion: "codex-cli 0.153.0",
      model: "gpt-from-flag",
      reasoningEffort: "low",
    });
    expect(existsSync(join(cwd, ".skillbench", "tmp"))).toBe(true);
  });

  it("records only successful interactive comparisons in the bounded CLI history", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-interactive-history-"));
    const evals = join(cwd, "evals");
    mkdirSync(evals);
    writeFileSync(
      join(evals, "case.yaml"),
      "id: history\nname: history\npartition: development\nprompt: test\nassertions:\n  - type: exit-code\n    value: 0\n",
    );
    initializeProject(cwd);
    const prompts = new ScriptedPrompts([
      true,
      ".skillbench/reports/comparison.md",
      true,
    ]);
    await createProgram({
      prompts,
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: () => undefined,
      services: { cwd: () => cwd },
    }).parseAsync([
      "node",
      "skillbench",
      "compare",
      resolve("tests/fixtures/skills/basic"),
      resolve("tests/fixtures/skills/basic"),
      "--evals",
      evals,
      "--repeat",
      "1",
    ]);

    expect(new CliHistoryStore(cwd).list()).toHaveLength(1);
    expect(new CliHistoryStore(cwd).list()[0]).toMatchObject({
      runner: "mock",
      repeat: 1,
      evals,
    });
    expect(new CliHistoryStore(cwd).list()[0]?.output).toBeUndefined();
  });

  it("disambiguates identical history sources with suite, runner and run metadata", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-history-selector-"));
    const store = new CliHistoryStore(
      cwd,
      undefined,
      () => new Date("2026-09-08T10:30:00.000Z"),
    );
    const shared = {
      cwd,
      sourceA: "./skill-a",
      sourceB: "./skill-b",
      partition: "development" as const,
      repeat: 1,
    };
    store.record({ ...shared, evals: "evals/smoke", runner: "mock" });
    store.record({
      ...shared,
      evals: "evals/quality",
      runner: "codex",
      model: "gpt-cheap",
      reasoningEffort: "low",
    });
    const prompts = new ScriptedPrompts([cancelled()]);

    await expect(
      createProgram({
        prompts,
        stdinIsTTY: true,
        stderrIsTTY: true,
        services: { cwd: () => cwd, createHistoryStore: () => store },
      }).parseAsync(["node", "skillbench", "history"]),
    ).rejects.toMatchObject({ code: "CLI_CANCELLED", exitCode: 130 });

    const selection = prompts.selections[0];
    expect(selection).toMatchObject({ message: "Which comparison should be rerun?" });
    expect(selection?.options.map((option) => option.label)).toEqual([
      "./skill-a vs ./skill-b",
      "./skill-a vs ./skill-b",
    ]);
    expect(selection?.options.map((option) => option.hint)).toEqual([
      "evals/quality · codex · gpt-cheap · low · 1× · 2026-09-08 10:30Z",
      "evals/smoke · mock · 1× · 2026-09-08 10:30Z",
    ]);
  });
});

describe("preflight", () => {
  it("shows reproducibility metadata and estimates eval, comparison and merge calls", async () => {
    const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };
    const skill = await new LocalSourceResolver(policy).resolve("tests/fixtures/skills/basic");
    const suite = loadEvalSuite("tests/fixtures/evals/development");
    const executionProfile = {
      runner: "codex" as const,
      runnerVersion: "codex-cli 0.153.0",
      model: "gpt-cheap",
      reasoningEffort: "low" as const,
    };

    const comparison = {
      operation: "compare" as const,
      skills: [skill, skill],
      suite,
      suiteInput: resolve("tests/fixtures/evals/development"),
      repeat: 2,
      executionProfile,
    };
    expect(estimateModelCalls({ ...comparison, operation: "eval", skills: [skill] })).toBe(2);
    expect(estimateModelCalls(comparison)).toBe(6);
    expect(estimateModelCalls({ ...comparison, operation: "merge", candidateCount: 3 })).toBe(12);
    const preflight = renderPreflight(comparison).join("\n");
    expect(preflight).toContain("Runner: Codex · gpt-cheap · low effort");
    expect(preflight).toContain(`Eval suite: ${resolve("tests/fixtures/evals/development")}`);
    expect(preflight).toContain("Partition: development");
    expect(preflight).toContain("Cases: 1");
    expect(preflight).toContain("Repeats: 2");
    expect(preflight).toContain("Estimated model calls: 6");
    expect(preflight).toContain(skill.snapshot.fingerprint.slice(0, 12));
    expect(preflight).not.toContain(skill.snapshot.fingerprint);
    expect(
      estimateModelCalls({
        ...comparison,
        executionProfile: { runner: "mock", runnerVersion: "mock-v1" },
      }),
    ).toBe(0);
  });
});
