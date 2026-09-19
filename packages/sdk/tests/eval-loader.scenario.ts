// Registered by the SDK evaluation scenario suite.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { loadEvalSuite } from "@skillbench/sdk/evaluator";

function expectEvalError(
  load: () => unknown,
  code: string,
  expectedMessageParts: readonly string[],
): void {
  try {
    load();
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect(error).toBeInstanceOf(Error);
    for (const part of expectedMessageParts) expect((error as Error).message).toContain(part);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("loadEvalSuite", () => {
  it("loads a development suite with fixtures and every V1 assertion", () => {
    const suite = loadEvalSuite("tests/fixtures/evals/development");

    expect(suite.partition).toBe("development");
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0]).toMatchObject({
      id: "fixture-quality",
      fixtures: [
        {
          sourcePath: resolve("tests/fixtures/evals/development/fixtures/project"),
          destinationPath: ".",
        },
      ],
    });
    expect(suite.cases[0]?.assertions.map((assertion) => assertion.type)).toEqual([
      "file-exists",
      "contains",
      "regex",
      "command",
      "exit-code",
      "llm-rubric",
    ]);
    expect(suite.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects duplicate ids", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const development = join(root, "development");
    mkdirSync(development);
    const yaml =
      "id: duplicate\nname: duplicate\nprompt: test\nassertions:\n  - type: exit-code\n    value: 0\n";
    writeFileSync(join(development, "a.yaml"), yaml);
    writeFileSync(join(development, "b.yaml"), yaml);

    expectEvalError(() => loadEvalSuite(development), "EVAL_ID_DUPLICATE", [
      join(development, "a.yaml"),
      join(development, "b.yaml"),
      "unique id",
    ]);
  });

  it("explains how to repair missing, empty, invalid, and mispartitioned suites", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-eval-errors-"));
    const missing = join(root, "missing");
    expectEvalError(() => loadEvalSuite(missing), "EVAL_PATH_NOT_FOUND", [
      missing,
      "Create it or provide the path",
    ]);

    const empty = join(root, "empty");
    mkdirSync(empty);
    expectEvalError(() => loadEvalSuite(empty), "EVAL_SUITE_EMPTY", [
      empty,
      "Add at least one .yaml or .yml eval file",
    ]);

    const invalid = join(root, "invalid.yaml");
    writeFileSync(invalid, "id: invalid\n");
    expectEvalError(() => loadEvalSuite(invalid), "EVAL_VALIDATION_ERROR", [
      invalid,
      "Fix this YAML file",
    ]);

    const development = join(root, "development");
    const wrongPartition = join(development, "holdout.yaml");
    mkdirSync(development);
    writeFileSync(
      wrongPartition,
      "id: wrong-partition\nname: Wrong partition\npartition: holdout\nprompt: Test\nassertions:\n  - type: exit-code\n    value: 0\n",
    );
    expectEvalError(() => loadEvalSuite(development), "EVAL_PARTITION_CONFLICT", [
      wrongPartition,
      "Change the file partition",
    ]);
  });

  it("rejects unknown assertions and invalid regular expressions", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const development = join(root, "development");
    mkdirSync(development);
    writeFileSync(
      join(development, "invalid.yaml"),
      "id: invalid\nname: invalid\nprompt: test\nassertions:\n  - type: regex\n    path: file.txt\n    pattern: '['\n",
    );
    expect(() => loadEvalSuite(development)).toThrow(/pattern/);

    writeFileSync(
      join(development, "invalid.yaml"),
      "id: invalid\nname: invalid\nprompt: test\nassertions:\n  - type: unknown\n",
    );
    expect(() => loadEvalSuite(development)).toThrow(/type/);
  });

  it("loads only the bounded Promptfoo assertion subset", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const development = join(root, "development");
    mkdirSync(development);
    writeFileSync(
      join(development, "promptfoo.yaml"),
      "id: promptfoo\nname: promptfoo\nprompt: test\nassertions:\n  - type: promptfoo\n    assertion:\n      type: contains\n      value: expected\n      metric: output-contract\n",
    );
    expect(loadEvalSuite(development).cases[0]?.assertions[0]).toEqual({
      type: "promptfoo",
      assertion: { type: "contains", value: "expected", metric: "output-contract" },
    });
    writeFileSync(
      join(development, "promptfoo.yaml"),
      "id: promptfoo\nname: promptfoo\nprompt: test\nassertions:\n  - type: promptfoo\n    assertion:\n      type: javascript\n      value: process.exit(1)\n",
    );
    expect(() => loadEvalSuite(development)).toThrow(/assertion\.type/u);
  });

  it("rejects fixtures escaping the suite root", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const development = join(root, "development");
    mkdirSync(development);
    writeFileSync(join(root, "outside.txt"), "outside");
    writeFileSync(
      join(development, "unsafe.yaml"),
      "id: unsafe\nname: unsafe\nprompt: test\nfixtures:\n  - source: ../outside.txt\nassertions:\n  - type: exit-code\n    value: 0\n",
    );
    expect(() => loadEvalSuite(development)).toThrow(/must not escape|escapes suite root/);
  });

  it("requires an unambiguous partition", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const path = join(root, "case.yaml");
    writeFileSync(
      path,
      "id: case\nname: case\nprompt: test\nassertions:\n  - type: exit-code\n    value: 0\n",
    );
    expect(() => loadEvalSuite(path)).toThrow(/partition is ambiguous/);
    expect(loadEvalSuite(path, { partition: "holdout" }).partition).toBe("holdout");
  });

  it("changes suite identity when fixture content changes", () => {
    const root = mkdtempSync(join(tmpdir(), "skillbench-evals-"));
    const development = join(root, "development");
    const fixtures = join(development, "fixtures");
    mkdirSync(fixtures, { recursive: true });
    writeFileSync(join(fixtures, "input.txt"), "first");
    writeFileSync(
      join(development, "case.yaml"),
      "id: case\nname: case\nprompt: test\nfixtures:\n  - source: fixtures/input.txt\n    destination: input.txt\nassertions:\n  - type: file-exists\n    value: input.txt\n",
    );
    const first = loadEvalSuite(development).id;
    writeFileSync(join(fixtures, "input.txt"), "second");
    expect(loadEvalSuite(development).id).not.toBe(first);
  });
});
