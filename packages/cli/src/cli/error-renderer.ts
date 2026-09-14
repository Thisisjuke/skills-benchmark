import { CommanderError } from "commander";

import packageJson from "../../package.json" with { type: "json" };
import {
  SkillbenchError,
  toErrorMessage,
} from "@skillbench/sdk/errors";
import { redactText } from "@skillbench/sdk/logging";
import {
  createSkillbenchErrorEnvelope,
  type SkillbenchCommand,
  type SkillbenchProtocolError,
} from "@skillbench/invocation-contract";

const MAX_DEBUG_ERROR_CHARS = 32 * 1024;

export function renderCliError(
  error: unknown,
  options: { redactions?: readonly string[] } = {},
): string {
  const code =
    error instanceof SkillbenchError
      ? error.code
      : error instanceof CommanderError
        ? error.code
        : "UNEXPECTED_ERROR";
  return `skillbench: ${redactText(toErrorMessage(error), options.redactions ?? [])} [${code}]\n`;
}

export function renderCliJsonError(
  error: unknown,
  options: { redactions?: readonly string[]; command?: SkillbenchCommand } = {},
): string {
  return `${JSON.stringify(
    createSkillbenchErrorEnvelope(
      options.command ?? "cli",
      toCliProtocolError(error, options.redactions ?? []),
    ),
  )}\n`;
}

export function toCliProtocolError(
  error: unknown,
  redactions: readonly string[] = [],
): SkillbenchProtocolError {
  return {
    code: errorCode(error),
    message: redactText(toErrorMessage(error), redactions),
    exitCode:
      error instanceof SkillbenchError || error instanceof CommanderError ? error.exitCode : 1,
  };
}

export function renderDebugError(
  error: unknown,
  options: { redactions?: readonly string[]; phase?: string } = {},
): string {
  const details = {
    event: "cli.error",
    phase: options.phase ?? "command",
    cliVersion: packageJson.version,
    code:
      error instanceof SkillbenchError
        ? error.code
        : error instanceof CommanderError
          ? error.code
          : "UNEXPECTED_ERROR",
  };
  const chain = errorChain(error)
    .map((item, index) => `Cause ${index}:\n${stackOf(item)}`)
    .join("\n");
  const redacted = redactText(chain, options.redactions ?? []);
  const bounded =
    redacted.length <= MAX_DEBUG_ERROR_CHARS
      ? redacted
      : `${redacted.slice(0, MAX_DEBUG_ERROR_CHARS)}\n[debug stack truncated]`;
  return `[debug] ${JSON.stringify(details)}\n${bounded}\n`;
}

function errorCode(error: unknown): string {
  return error instanceof SkillbenchError
    ? error.code
    : error instanceof CommanderError
      ? error.code
      : "UNEXPECTED_ERROR";
}

function errorChain(error: unknown): unknown[] {
  const output: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current) && output.length < 10) {
    output.push(current);
    seen.add(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return output;
}

function stackOf(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? `${error.name}: ${error.message}`)
    : String(error);
}
