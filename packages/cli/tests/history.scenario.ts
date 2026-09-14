// Registered by the CLI project lifecycle scenario suite.
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { CLI_HISTORY_LIMIT, CliHistoryStore } from "../src/history";

function entry(cwd: string, index: number) {
  return {
    cwd,
    sourceA: `./skills/a-${index}`,
    sourceB: `https://github.com/owner/repo/tree/main/skill-${index}`,
    evals: "evals/development",
    partition: "development" as const,
    repeat: 1,
    runner: "mock" as const,
  };
}

describe("CliHistoryStore", () => {
  it("writes atomically, deduplicates and keeps only the ten newest entries", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-history-"));
    let tick = 0;
    const store = new CliHistoryStore(
      cwd,
      undefined,
      () => new Date(Date.UTC(2026, 8, 6, 0, 0, tick++)),
      () => `history-${tick}`,
    );

    for (let index = 0; index < CLI_HISTORY_LIMIT + 1; index += 1) {
      store.record(entry(cwd, index));
    }
    expect(store.list()).toHaveLength(CLI_HISTORY_LIMIT);
    expect(store.list()[0]?.sourceA).toBe("./skills/a-10");
    expect(store.list().some((candidate) => candidate.sourceA === "./skills/a-0")).toBe(false);

    const originalId = store.list().find((candidate) => candidate.sourceA === "./skills/a-5")!.id;
    store.record(entry(cwd, 5));
    expect(store.list()[0]).toMatchObject({ id: originalId, sourceA: "./skills/a-5" });
    expect(readdirSync(dirname(store.path)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("recovers from a corrupt file without overwriting it during reads", () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-history-corrupt-"));
    const store = new CliHistoryStore(cwd);
    const directory = dirname(store.path);
    writeFileSync(join(cwd, "placeholder"), "");
    expect(existsSync(directory)).toBe(false);

    store.record(entry(cwd, 1));
    writeFileSync(store.path, "not-json\n");
    expect(store.list()).toEqual([]);
  });
});
