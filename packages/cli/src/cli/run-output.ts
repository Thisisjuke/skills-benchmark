import { mkdirSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { SkillbenchOperation } from "@skillbench/invocation-contract";
import { SkillbenchError } from "@skillbench/sdk/errors";
import type { SkillbenchConfig } from "../config";

export type RunOutputOptions = {
  output?: string;
  outputEnabled?: boolean;
  force?: boolean;
};

export function resolveRunOutput(input: {
  command: SkillbenchOperation;
  config: SkillbenchConfig;
  createId: () => string;
  interactive: boolean;
  now: () => Date;
  options: RunOutputOptions;
  projectRoot: string;
}): string | undefined {
  if (input.options.output !== undefined) return input.options.output;
  if (!input.interactive || input.options.outputEnabled === false) return undefined;

  const directory = resolve(input.projectRoot, input.config.outputs.directory, input.command);
  const stem = `${compactUtcTimestamp(input.now())}-${shortId(input.createId())}`;
  mkdirSync(directory, { recursive: true });
  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const name = suffix === 0 ? stem : `${stem}-${suffix + 1}`;
    const candidate = join(directory, `${name}.skillbench`);
    try {
      mkdirSync(candidate);
      return candidate;
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw error;
    }
  }
  throw new SkillbenchError(`Could not allocate a unique run directory in ${directory}`, {
    code: "CLI_OUTPUT_ALLOCATION_FAILED",
  });
}

export async function withRunOutputReservation<Value>(
  output: string | undefined,
  automatic: boolean,
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (automatic && output !== undefined) releaseEmptyReservation(output);
    throw error;
  }
}

function releaseEmptyReservation(path: string): void {
  try {
    rmdirSync(path);
  } catch (error) {
    if (isMissing(error) || isNotEmpty(error)) return;
    throw error;
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isNotEmpty(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOTEMPTY";
}

function compactUtcTimestamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

function shortId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9]/gu, "").slice(0, 8).toLowerCase();
  return safe === "" ? "run" : safe;
}
