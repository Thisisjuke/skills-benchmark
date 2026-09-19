import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { skillbenchConfigSchema } from "../src/config";
import { resolveRunOutput, withRunOutputReservation } from "../src/cli/run-output";

describe("automatic run output", () => {
  it("allocates a readable command path under the configured runs directory", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "skillbench-run-output-"));
    const output = resolveRunOutput({
      command: "inspect",
      config: skillbenchConfigSchema.parse({ outputs: { directory: "artifacts" } }),
      createId: () => "ABCD-1234-rest",
      interactive: true,
      now: () => new Date("2026-09-14T08:07:06.000Z"),
      options: {},
      projectRoot,
    });

    expect(output).toBe(join(projectRoot, "artifacts", "inspect", "20260914-080706-abcd1234.skillbench"));
    expect(existsSync(output!)).toBe(true);
  });

  it("avoids collisions between runs created in the same second", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "skillbench-run-collision-"));
    const input = {
      command: "compare" as const,
      config: skillbenchConfigSchema.parse({}),
      createId: () => "same-id",
      interactive: true,
      now: () => new Date("2026-09-14T08:07:06.000Z"),
      options: {},
      projectRoot,
    };
    resolveRunOutput(input);

    expect(resolveRunOutput(input)).toBe(
      join(
        projectRoot,
        ".skillbench/runs/compare/20260914-080706-sameid-2.skillbench",
      ),
    );
  });

  it("does not infer output for non-interactive or opted-out commands", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "skillbench-run-disabled-"));
    const base = {
      command: "eval" as const,
      config: skillbenchConfigSchema.parse({}),
      createId: () => "id",
      now: () => new Date("2026-09-14T08:07:06.000Z"),
      projectRoot,
    };

    expect(resolveRunOutput({ ...base, interactive: false, options: {} })).toBeUndefined();
    expect(
      resolveRunOutput({
        ...base,
        interactive: true,
        options: { outputEnabled: false },
      }),
    ).toBeUndefined();
    expect(
      resolveRunOutput({
        ...base,
        interactive: false,
        options: { output: "explicit.skillbench" },
      }),
    ).toBe("explicit.skillbench");
  });

  it("releases an empty automatic reservation when the operation fails", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "skillbench-run-cleanup-"));
    const output = resolveRunOutput({
      command: "inspect",
      config: skillbenchConfigSchema.parse({}),
      createId: () => "failed-id",
      interactive: true,
      now: () => new Date("2026-09-14T08:07:06.000Z"),
      options: {},
      projectRoot,
    });

    await expect(
      withRunOutputReservation(output, true, async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");
    expect(existsSync(output!)).toBe(false);
  });
});
