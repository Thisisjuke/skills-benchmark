#!/usr/bin/env node

import { CommanderError } from "commander";

import packageJson from "../package.json" with { type: "json" };
import { createProgram } from "./cli/program";
import {
  renderCliError,
  renderCliJsonError,
  renderDebugError,
  toCliProtocolError,
} from "./cli/error-renderer";
import { CliJsonlWriter } from "./cli/jsonl-output";
import { writeStderr, writeStdout } from "./cli/stdio";
import { SkillbenchError } from "@skillbench/sdk/errors";
import { createDebugLogger, runtimeRedactions } from "@skillbench/sdk/logging";
import {
  SKILLBENCH_CLI_COMMANDS,
  skillbenchCliCommandSchema,
  type SkillbenchCommand,
} from "@skillbench/invocation-contract";

const ROOT_COMMANDS = new Set<string>(SKILLBENCH_CLI_COMMANDS);
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--config",
  "--model",
  "--reasoning-effort",
  "--runner",
]);

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const debug = argv.includes("--debug");
  const redactions = runtimeRedactions();
  const logger = createDebugLogger({ enabled: debug, redactions });
  const phase = phaseFromArgv(argv);
  const command = commandFromArgv(argv);
  const json = argv.includes("--json");
  const jsonl = argv.includes("--jsonl");
  const jobId = crypto.randomUUID();
  const jsonlWriter = new CliJsonlWriter(command, jobId, writeStdout);
  const abortController = new AbortController();
  let receivedSignal: NodeJS.Signals | undefined;
  const cancel = (signal: NodeJS.Signals) => {
    receivedSignal = signal;
    abortController.abort(
      new SkillbenchError(`Operation cancelled by ${signal}`, {
        code: "CLI_CANCELLED",
        exitCode: 130,
      }),
    );
  };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  logger.debug("cli.start", { cliVersion: packageJson.version, phase });
  if (jsonl) jsonlWriter.started();
  try {
    await createProgram({ logger, jobId, signal: abortController.signal }).parseAsync([...argv]);
  } catch (error) {
    if (abortController.signal.aborted) {
      const cancellation =
        abortController.signal.reason instanceof SkillbenchError
          ? abortController.signal.reason
          : new SkillbenchError("Operation cancelled", {
              code: "CLI_CANCELLED",
              exitCode: 130,
            });
      if (jsonl) jsonlWriter.cancelled(receivedSignal);
      else writeStderr(renderCliError(cancellation, { redactions }));
      process.exitCode = 130;
      return;
    }
    if (error instanceof SkillbenchError && error.code === "CLI_CANCELLED") {
      if (jsonl) jsonlWriter.cancelled(error.message);
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0) {
        if (jsonl) jsonlWriter.failed(toCliProtocolError(error, redactions));
        else writeError(error, json, redactions, command);
      }
      if (debug && error.exitCode !== 0) {
        writeStderr(renderDebugError(error, { redactions, phase }));
      }
      process.exitCode = error.exitCode;
      return;
    }
    if (jsonl) jsonlWriter.failed(toCliProtocolError(error, redactions));
    else writeError(error, json, redactions, command);
    if (debug) writeStderr(renderDebugError(error, { redactions, phase }));
    process.exitCode = error instanceof SkillbenchError ? error.exitCode : 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

function writeError(
  error: unknown,
  json: boolean,
  redactions: readonly string[],
  command: SkillbenchCommand,
): void {
  if (json) {
    writeStdout(renderCliJsonError(error, { redactions, command }));
    return;
  }
  writeStderr(renderCliError(error, { redactions }));
}

function commandFromArgv(argv: readonly string[]): SkillbenchCommand {
  const root = rootCommandFromArgv(argv);
  const parsed = skillbenchCliCommandSchema.safeParse(root?.name);
  if (parsed.success) return parsed.data;
  return "cli";
}

function phaseFromArgv(argv: readonly string[]): string {
  return rootCommandFromArgv(argv)?.name ?? "argument-parsing";
}

function rootCommandFromArgv(argv: readonly string[]): { name: string; index: number } | undefined {
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === undefined) continue;
    if (GLOBAL_OPTIONS_WITH_VALUE.has(value)) {
      index += 1;
      continue;
    }
    if (
      value.startsWith("--config=") ||
      value.startsWith("--model=") ||
      value.startsWith("--reasoning-effort=") ||
      value.startsWith("--runner=") ||
      (value.startsWith("-c") && value.length > 2)
    ) {
      continue;
    }
    if (value.startsWith("-")) continue;
    return ROOT_COMMANDS.has(value) ? { name: value, index } : undefined;
  }
  return undefined;
}

void main();
