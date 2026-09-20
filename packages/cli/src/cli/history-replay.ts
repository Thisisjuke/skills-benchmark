import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import type { SkillSourceService } from "@skillbench/sdk/sources";

import type { CliHistoryEntry } from "../history";

export function findHistoryEntry(
  entries: readonly CliHistoryEntry[],
  id: string,
): CliHistoryEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new SkillbenchError(`History entry not found: ${id}`, {
      code: "CLI_HISTORY_NOT_FOUND",
    });
  }
  return entry;
}

export function historyArguments(entry: CliHistoryEntry): string[] {
  return [
    "--runner",
    entry.runner,
    ...(entry.model === undefined ? [] : ["--model", entry.model]),
    ...(entry.reasoningEffort === undefined
      ? []
      : ["--reasoning-effort", entry.reasoningEffort]),
    ...(entry.variant === undefined ? [] : ["--variant", entry.variant]),
    "compare",
    entry.sourceA,
    entry.sourceB,
    "--evals",
    entry.evals,
    "--partition",
    entry.partition,
    "--repeat",
    String(entry.repeat),
    ...(entry.output === undefined ? [] : ["--output", entry.output]),
    ...(entry.skillPathA === undefined ? [] : ["--skill-path-a", entry.skillPathA]),
    ...(entry.skillPathB === undefined ? [] : ["--skill-path-b", entry.skillPathB]),
  ];
}

export function validateHistoryPaths(
  entry: CliHistoryEntry,
  sources: SkillSourceService,
): void {
  for (const input of [entry.sourceA, entry.sourceB]) {
    if (sources.capabilities(input).locality === "remote") continue;
    const path = isAbsolute(input) ? input : resolve(entry.cwd, input);
    if (!existsSync(path)) {
      throw new SkillbenchError(`History source no longer exists: ${path}`, {
        code: "CLI_HISTORY_SOURCE_MISSING",
      });
    }
  }
  const evals = isAbsolute(entry.evals) ? entry.evals : resolve(entry.cwd, entry.evals);
  if (!existsSync(evals)) {
    throw new SkillbenchError(`History eval suite no longer exists: ${evals}`, {
      code: "CLI_HISTORY_EVALS_MISSING",
    });
  }
}
