import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";
import { SKILLBENCH_CLI_COMMANDS } from "@skillbench/invocation-contract";
import { AUTOMATION_REQUEST_FIXTURES } from "@skillbench/test-contracts";
import { createDebugLogger } from "@skillbench/sdk/logging";
import { createProgram } from "../../src/cli/program";
import { reasoningEffort, runnerType } from "../../src/cli/options";
import { initializeProject } from "../../src/init";

const fixtureSkill = fileURLToPath(new URL("../fixtures/skills/basic", import.meta.url));

async function runCli(cwd: string, args: readonly string[]): Promise<string> {
  const output: string[] = [];
  await createProgram({
    stdinIsTTY: false,
    stderrIsTTY: false,
    writeStdout: (value) => output.push(value),
    services: { cwd: () => cwd },
  }).parseAsync(["node", "skillbench", ...args]);
  return output.join("");
}

async function expectCliError(
  run: () => Promise<unknown>,
  code: string,
  expectedMessageParts: readonly string[],
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect(error).toBeInstanceOf(Error);
    for (const part of expectedMessageParts) expect((error as Error).message).toContain(part);
    return;
  }
  throw new Error(`Expected ${code}`);
}

function createEvalSuite(cwd: string): string {
  if (!existsSync(join(cwd, ".skillbench", "config.yaml"))) initializeProject(cwd);
  const directory = join(cwd, "evals");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "basic.yaml"),
    [
      "id: tooling",
      "name: Tooling smoke",
      "partition: development",
      "prompt: Validate the execution chain.",
      "assertions:",
      "  - type: exit-code",
      "    value: 0",
      "",
    ].join("\n"),
  );
  return directory;
}

function createHoldoutSuite(cwd: string): string {
  const directory = join(cwd, "holdout-evals");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "basic.yaml"),
    [
      "id: holdout-tooling",
      "name: Holdout tooling smoke",
      "partition: holdout",
      "prompt: Validate the execution chain on unseen input.",
      "assertions:",
      "  - type: exit-code",
      "    value: 0",
      "",
    ].join("\n"),
  );
  return directory;
}

describe("database-free CLI", () => {
  it("exposes only the autonomous product commands", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-help-"));
    const commands = createProgram({ services: { cwd: () => cwd } }).commands.map((command) =>
      command.name(),
    );

    expect(commands).toEqual(SKILLBENCH_CLI_COMMANDS);
  });

  it("accepts the runner profiles from the shared automation fixtures", () => {
    for (const { request } of AUTOMATION_REQUEST_FIXTURES) {
      if (request.command === "inspect") continue;
      expect(runnerType(request.profile.runner)).toBe(request.profile.runner);
      if (request.profile.runner !== "mock") {
        expect(reasoningEffort(request.profile.reasoningEffort)).toBe(
          request.profile.reasoningEffort,
        );
      }
    }
  });

  it("shows the global automation and diagnostic options in subcommand help", () => {
    const program = createProgram();
    for (const command of program.commands) {
      const help = command.helpInformation();
      expect(help, command.name()).toContain("Global Options:");
      for (const option of [
        "--config",
        "--debug",
        "--offline",
        "--runner",
        "--model",
        "--reasoning-effort",
        "--no-input",
        "--no-history",
        "--jsonl",
        "--yes",
      ]) {
        expect(help, `${command.name()} ${option}`).toContain(option);
      }
    }
    for (const name of ["inspect", "eval", "compare", "merge"]) {
      const help = program.commands.find((command) => command.name() === name)?.helpInformation();
      expect(help).toContain("--no-output");
      expect(help).toContain("use this exact result bundle directory");
    }
    expect(program.commands.find((command) => command.name() === "eval")?.helpInformation()).toContain(
      "YAML scoring tasks and assertions",
    );
    expect(program.commands.find((command) => command.name() === "merge")?.helpInformation()).toContain(
      "holdout YAML tasks for final candidate validation",
    );
  });

  it("inspects a local skill without creating hidden state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-inspect-"));
    const result = await runCli(cwd, ["inspect", fixtureSkill, "--json", "--no-input"]);

    expect(JSON.parse(result)).toMatchObject({
      schemaVersion: 1,
      type: "result",
      command: "inspect",
      data: { kind: "inspect", name: "basic-skill", origin: { type: "local" } },
    });
    expect(existsSync(join(cwd, ".skillbench"))).toBe(false);
  });

  it("requires init for execution but keeps doctor available without it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-project-gate-"));
    await expect(runCli(cwd, ["eval", fixtureSkill, "--no-input"])).rejects.toMatchObject({
      code: "CLI_PROJECT_REQUIRED",
    });

    const doctor = JSON.parse(await runCli(cwd, ["doctor", "--json", "--no-input"]));
    expect(doctor).toMatchObject({
      command: "doctor",
      data: {
        project: { initialized: false },
        assets: { valid: false, remediation: "Run: skillbench init --no-input" },
        runner: {
          configured: false,
          runner: null,
          executable: null,
          available: null,
          version: null,
          remediation: "Run: skillbench init",
        },
      },
    });

    const explicitRunnerDoctor = JSON.parse(
      await runCli(cwd, ["doctor", "--runner", "mock", "--json", "--no-input"]),
    );
    expect(explicitRunnerDoctor).toMatchObject({
      data: {
        project: { initialized: false },
        runner: {
          configured: true,
          runner: "mock",
          executable: "mock",
          available: true,
          version: "built-in",
        },
      },
    });

    const initialized = JSON.parse(await runCli(cwd, ["init", "--json", "--no-input"]));
    expect(initialized).toMatchObject({
      command: "init",
      data: { runner: "mock", profile: { runner: "mock" } },
    });
    expect(existsSync(join(cwd, ".skillbench", "assets.yaml"))).toBe(true);
  });

  it("rejects excess positional arguments instead of silently ignoring them", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-arguments-"));

    await expect(
      runCli(cwd, ["inspect", fixtureSkill, "unexpected", "--no-input"]),
    ).rejects.toMatchObject({ code: "commander.excessArguments" });
    await expect(runCli(cwd, ["compar"])).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
  });

  it("validates eval and source paths before requiring a runner profile", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-validation-order-"));
    initializeProject(cwd);

    await expect(
      runCli(cwd, ["eval", fixtureSkill, "--evals", "missing-evals", "--no-input"]),
    ).rejects.toMatchObject({ code: "EVAL_PATH_NOT_FOUND" });

    const evals = createEvalSuite(cwd);
    await expect(
      runCli(cwd, ["eval", "missing-skill", "--evals", evals, "--no-input"]),
    ).rejects.toMatchObject({ code: "LOCAL_SOURCE_NOT_FOUND" });
  });

  it("returns actionable errors for each invalid eval suite state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-eval-errors-"));
    initializeProject(cwd);
    const missing = join(cwd, "missing-evals");
    const empty = join(cwd, "empty-evals");
    mkdirSync(empty);
    const invalid = join(cwd, "invalid.yaml");
    writeFileSync(invalid, "id: invalid\n");
    const development = join(cwd, "wrong", "development");
    mkdirSync(development, { recursive: true });
    const wrongPartition = join(development, "holdout.yaml");
    writeFileSync(
      wrongPartition,
      "id: wrong-partition\nname: Wrong partition\npartition: holdout\nprompt: Test\nassertions:\n  - type: exit-code\n    value: 0\n",
    );

    for (const scenario of [
      {
        path: missing,
        expectedPath: missing,
        code: "EVAL_PATH_NOT_FOUND",
        action: "Create it or provide the path",
      },
      {
        path: empty,
        expectedPath: empty,
        code: "EVAL_SUITE_EMPTY",
        action: "Add at least one .yaml",
      },
      {
        path: invalid,
        expectedPath: invalid,
        code: "EVAL_VALIDATION_ERROR",
        action: "Fix this YAML file",
      },
      {
        path: development,
        expectedPath: wrongPartition,
        code: "EVAL_PARTITION_CONFLICT",
        action: "Change the file partition",
      },
    ]) {
      await expectCliError(
        () => runCli(cwd, ["eval", fixtureSkill, "--evals", scenario.path, "--no-input"]),
        scenario.code,
        [scenario.expectedPath, scenario.action],
      );
    }
  });

  it("writes only the explicitly requested bundle", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-output-"));
    const result = await runCli(cwd, [
      "inspect",
      fixtureSkill,
      "--output",
      "portable-result",
      "--json",
      "--no-input",
    ]);

    expect(JSON.parse(result)).toMatchObject({ command: "inspect", type: "result" });
    expect(existsSync(join(cwd, "portable-result", "manifest.json"))).toBe(true);
    expect(existsSync(join(cwd, "portable-result", "result.json"))).toBe(true);
    expect(readFileSync(join(cwd, "portable-result", "report.md"), "utf8")).toContain(
      "# Skill inspection",
    );
    expect(existsSync(join(cwd, ".skillbench"))).toBe(false);
  });

  it("streams phase and completed JSONL events without human output", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-jsonl-"));
    const output = await runCli(cwd, ["inspect", fixtureSkill, "--jsonl", "--no-input"]);
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events.map((event) => event.event)).toEqual(["phase", "completed"]);
    expect(events.every((event) => event.schemaVersion === 1)).toBe(true);
    expect(new Set(events.map((event) => event.jobId)).size).toBe(1);
  });

  it("keeps debug diagnostics separate from JSON and JSONL stdout", async () => {
    for (const mode of ["--json", "--jsonl"] as const) {
      const cwd = mkdtempSync(join(tmpdir(), "skillbench-debug-output-"));
      const stdout: string[] = [];
      const stderr: string[] = [];
      await createProgram({
        logger: createDebugLogger({ enabled: true, write: (value) => stderr.push(value) }),
        stdinIsTTY: false,
        stderrIsTTY: false,
        writeStdout: (value) => stdout.push(value),
        services: { cwd: () => cwd },
      }).parseAsync(["node", "skillbench", "--debug", "inspect", fixtureSkill, mode, "--no-input"]);

      const serialized = stdout.join("").trim();
      const documents =
        mode === "--json"
          ? [JSON.parse(serialized)]
          : serialized.split("\n").map((line) => JSON.parse(line));
      expect(documents.length).toBeGreaterThan(0);
      expect(stderr.join("")).toContain("[debug]");
      expect(stdout.join("")).not.toContain("[debug]");
    }
  });

  it("returns complete eval and compare results without a repository", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-workflows-"));
    const evals = createEvalSuite(cwd);
    const common = ["--evals", evals, "--repeat", "1", "--runner", "mock", "--no-input", "--json"];

    const evaluation = await runCli(cwd, [
      "eval",
      fixtureSkill,
      ...common,
      "--output",
      "results/eval.skillbench",
    ]);
    expect(JSON.parse(evaluation)).toMatchObject({
      type: "result",
      command: "eval",
      data: {
        partition: "development",
        status: "completed",
        instructionAssets: [],
      },
    });
    const manifest = JSON.parse(
      readFileSync(join(cwd, "results", "eval.skillbench", "manifest.json"), "utf8"),
    );
    expect(manifest.instructions).toEqual([]);
    expect(manifest.reports).toEqual([
      expect.objectContaining({ id: "summary", path: "report.md" }),
    ]);
    expect(readFileSync(join(cwd, "results", "eval.skillbench", "report.md"), "utf8")).toContain(
      "# Skill evaluation",
    );

    const comparison = await runCli(cwd, ["compare", fixtureSkill, fixtureSkill, ...common]);
    expect(JSON.parse(comparison)).toMatchObject({
      type: "result",
      command: "compare",
      data: {
        verdict: { winner: "tie" },
        report: { type: "comparison", markdown: expect.stringContaining("basic-skill") },
      },
    });
    expect(existsSync(join(cwd, ".skillbench", "tmp"))).toBe(true);
  });

  it("renders an actionable human comparison without opaque identifiers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-human-output-"));
    const evals = createEvalSuite(cwd);
    const output = await runCli(cwd, [
      "compare",
      fixtureSkill,
      fixtureSkill,
      "--evals",
      evals,
      "--runner",
      "mock",
      "--no-input",
      "--output",
      "compare.skillbench",
    ]);

    expect(output).toContain("Comparison complete");
    expect(output).toContain(`Source A: ${fixtureSkill}`);
    expect(output).toContain(`Eval suite: ${evals}`);
    expect(output).not.toContain("Artifacts: not written");
    expect(output).not.toContain("generated in result");
    expect(output).not.toMatch(/[a-f0-9]{64}/u);
    expect(output).toContain(`Report: ${join(cwd, "compare.skillbench", "report.md")}`);
    expect(readFileSync(join(cwd, "compare.skillbench", "report.md"), "utf8")).toContain(
      "# Skill comparison",
    );
  });

  it("rejects contradictory output flags before executing an operation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-output-conflicts-"));

    await expect(
      runCli(cwd, ["inspect", fixtureSkill, "--output", "bundle", "--no-output"]),
    ).rejects.toMatchObject({ code: "CLI_OUTPUT_CONFLICT" });
    await expect(
      runCli(cwd, ["inspect", fixtureSkill, "--force", "--no-output"]),
    ).rejects.toMatchObject({ code: "CLI_OUTPUT_CONFLICT" });
    await expect(runCli(cwd, ["inspect", fixtureSkill, "--force"])).rejects.toMatchObject({
      code: "CLI_OUTPUT_REQUIRED",
    });
  });

  it("opts out of interactive artifacts with --no-output", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-no-output-"));
    initializeProject(cwd);
    const output: string[] = [];

    await createProgram({
      stdinIsTTY: true,
      stderrIsTTY: true,
      writeStdout: (value) => output.push(value),
      services: { cwd: () => cwd },
    }).parseAsync(["node", "skillbench", "inspect", fixtureSkill, "--no-output"]);

    expect(output.join("")).not.toContain("Bundle:");
    expect(existsSync(join(cwd, ".skillbench", "runs", "inspect"))).toBe(false);
  });

  it("protects explicit bundles unless --force is supplied", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-force-output-"));
    const args = ["inspect", fixtureSkill, "--output", "inspection.skillbench", "--no-input"];

    await runCli(cwd, args);
    await expect(runCli(cwd, args)).rejects.toMatchObject({ code: "CLI_OUTPUT_NOT_EMPTY" });
    await expect(runCli(cwd, [...args, "--force"])).resolves.toContain("Bundle:");
  });

  it("writes a unique default bundle for every interactive operation", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-automatic-output-"));
    const evals = createEvalSuite(cwd);
    const operations = [
      ["inspect", fixtureSkill],
      ["eval", fixtureSkill, "--evals", evals, "--repeat", "1", "--runner", "mock", "--yes"],
      [
        "compare",
        fixtureSkill,
        fixtureSkill,
        "--evals",
        evals,
        "--repeat",
        "1",
        "--runner",
        "mock",
        "--yes",
      ],
      [
        "merge",
        fixtureSkill,
        fixtureSkill,
        "--evals",
        evals,
        "--repeat",
        "1",
        "--runner",
        "mock",
        "--yes",
      ],
    ] as const;

    for (const args of operations) {
      const output: string[] = [];
      await createProgram({
        stdinIsTTY: true,
        stderrIsTTY: true,
        writeStdout: (value) => output.push(value),
        services: { cwd: () => cwd },
      }).parseAsync(["node", "skillbench", ...args]);
      const command = args[0];
      expect(output.join(""), command).toContain(`Bundle: ${join(cwd, ".skillbench", "runs", command)}`);
      expect(existsSync(join(cwd, ".skillbench", "runs", command)), command).toBe(true);
      const bundles = readdirSync(join(cwd, ".skillbench", "runs", command));
      expect(bundles, command).toHaveLength(1);
      expect(
        existsSync(join(cwd, ".skillbench", "runs", command, bundles[0]!, "report.md")),
        command,
      ).toBe(true);
    }
  });

  it("can repeat identical interactive defaults without output collisions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-repeat-output-"));
    initializeProject(cwd);
    for (let index = 0; index < 10; index += 1) {
      await createProgram({
        createId: () => "fixed-id",
        now: () => new Date("2026-09-14T08:07:06.000Z"),
        stdinIsTTY: true,
        stderrIsTTY: true,
        writeStdout: () => undefined,
        services: { cwd: () => cwd },
      }).parseAsync(["node", "skillbench", "inspect", fixtureSkill]);
    }

    expect(
      Array.from({ length: 10 }, (_, index) =>
        existsSync(
          join(
            cwd,
            ".skillbench",
            "runs",
            "inspect",
            `20260914-080706-fixedid${index === 0 ? "" : `-${index + 1}`}.skillbench`,
            "manifest.json",
          ),
        ),
      ),
    ).toEqual(Array.from({ length: 10 }, () => true));
  });

  it("explains the next command after project initialization", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-init-output-"));
    const output = await runCli(cwd, ["init"]);

    expect(output).toContain("Skillbench project initialized.");
    expect(output).toContain("  - .skillbench/config.yaml");
    expect(output).toContain("Runs directory: .skillbench/runs");
    expect(output).toContain(
      "Edit .skillbench/evals/development/example.yaml to define the tasks and assertions used to score your skills.",
    );
    expect(output).toContain("skillbench compare <skill-a> <skill-b>");
    expect(output).not.toContain(cwd);
  });

  it("runs merge transiently and never writes an implicit artifact directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-merge-"));
    const evals = createEvalSuite(cwd);
    const result = await runCli(cwd, [
      "merge",
      fixtureSkill,
      fixtureSkill,
      "--evals",
      evals,
      "--repeat",
      "1",
      "--runner",
      "mock",
      "--no-input",
      "--json",
      "--output",
      "results/merge.skillbench",
    ]);

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({
      type: "result",
      command: "merge",
      data: {
        comparisonReused: false,
        plan: { status: "RECOMMENDED" },
        instructionAssets: [
          expect.objectContaining({ id: "merge-candidate-template" }),
        ],
        candidates: expect.arrayContaining([expect.objectContaining({ strategy: "a-preserving" })]),
      },
    });
    const manifest = JSON.parse(
      readFileSync(join(cwd, "results", "merge.skillbench", "manifest.json"), "utf8"),
    );
    expect(manifest.instructions).toEqual([
      expect.objectContaining({ id: "merge-candidate-template" }),
    ]);
    expect(manifest.reports).toEqual([
      expect.objectContaining({ id: "summary", path: "report.md" }),
    ]);
    for (const candidate of parsed.data.candidates) {
      expect(
        existsSync(
          join(
            cwd,
            "results",
            "merge.skillbench",
            "artifacts",
            "candidates",
            candidate.id,
            "SKILL.md",
          ),
        ),
      ).toBe(true);
    }
    expect(
      existsSync(join(cwd, "results", "merge.skillbench", "artifacts", "recommended", "SKILL.md")),
    ).toBe(true);
    expect(existsSync(join(cwd, "results", "merge.skillbench", "artifacts", "final"))).toBe(false);
    const mergeReport = readFileSync(join(cwd, "results", "merge.skillbench", "report.md"), "utf8");
    expect(mergeReport).toContain("artifacts/recommended/");
    expect(mergeReport).toContain("artifacts/final/` was not created");
    expect(existsSync(join(cwd, ".skillbench", "tmp"))).toBe(true);
  });

  it("promotes only a holdout-accepted candidate to final", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-merge-final-"));
    const evals = createEvalSuite(cwd);
    const holdout = createHoldoutSuite(cwd);
    const configPath = join(cwd, ".skillbench", "config.yaml");
    writeFileSync(
      configPath,
      `${readFileSync(configPath, "utf8")}\nmerge:\n  candidates: 3\n  requireImprovement: false\n  minimumImprovement: 0\n`,
    );

    const result = JSON.parse(
      await runCli(cwd, [
        "merge",
        fixtureSkill,
        fixtureSkill,
        "--evals",
        evals,
        "--holdout",
        holdout,
        "--repeat",
        "1",
        "--runner",
        "mock",
        "--no-input",
        "--json",
        "--output",
        "merge.skillbench",
      ]),
    );

    expect(result.data.holdoutValidation.verdict).toMatchObject({
      status: "ACCEPTED",
      winnerKind: "candidate",
    });
    expect(existsSync(join(cwd, "merge.skillbench", "artifacts", "final", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(cwd, "merge.skillbench", "report.md"), "utf8")).toContain(
      "Holdout-approved final skill",
    );
  });

  it("reuses an explicit compatible comparison result by fingerprint", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-comparison-input-"));
    const evals = createEvalSuite(cwd);
    const common = ["--evals", evals, "--repeat", "1", "--runner", "mock", "--no-input", "--json"];
    const comparison = await runCli(cwd, ["compare", fixtureSkill, fixtureSkill, ...common]);
    const comparisonPath = join(cwd, "comparison.json");
    writeFileSync(comparisonPath, comparison);

    const merged = await runCli(cwd, [
      "merge",
      fixtureSkill,
      fixtureSkill,
      "--comparison",
      comparisonPath,
      ...common,
    ]);
    expect(JSON.parse(merged)).toMatchObject({
      command: "merge",
      data: { comparisonReused: true },
    });
  });

  it("rejects remote GitHub inputs in offline mode before network access", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-offline-"));
    await expect(
      runCli(cwd, [
        "inspect",
        "https://github.com/owner/repository/tree/main/skills/example",
        "--offline",
        "--json",
        "--no-input",
      ]),
    ).rejects.toMatchObject({ code: "SOURCE_OFFLINE_REMOTE_FORBIDDEN" });
  });
});
