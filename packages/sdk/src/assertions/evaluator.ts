import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, sep } from "node:path";

import { execa } from "execa";

import { toErrorMessage } from "../errors";
import type {
  AssertionResult,
  CommandAssertion,
  EvalAssertion,
  LlmRubricAssertion,
  RegexAssertion,
} from "../evaluator";
import type { AssertionEngine } from "../evaluator";
import { resolveInside } from "../runners/workspace";
import { splitCommand } from "./command";
import type {
  AssertionContext,
  AssertionEvaluatorOptions,
  AssertionHandler,
  RubricEvaluator,
} from "./types";

const MAX_EVIDENCE_OUTPUT = 16_384;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

function truncate(value: string): string {
  return value.length <= MAX_EVIDENCE_OUTPUT
    ? value
    : `${value.slice(0, MAX_EVIDENCE_OUTPUT)}\n[truncated]`;
}

async function safeExistingPath(workspacePath: string, path: string): Promise<string> {
  const target = resolveInside(workspacePath, path, "assertion path");
  const [rootRealPath, targetRealPath] = await Promise.all([
    realpath(workspacePath),
    realpath(target),
  ]);
  const fromRoot = relative(rootRealPath, targetRealPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Assertion path resolves outside workspace: ${path}`);
  }
  return targetRealPath;
}

function result(
  assertion: EvalAssertion,
  startedAt: number,
  values: Omit<AssertionResult, "type" | "durationMs">,
): AssertionResult {
  return { type: assertion.type, durationMs: performance.now() - startedAt, ...values };
}

type RegisteredAssertionHandler = (
  assertion: EvalAssertion,
  context: AssertionContext,
) => Promise<AssertionResult>;

export class AssertionEvaluator implements AssertionEngine {
  private readonly handlers = new Map<EvalAssertion["type"], RegisteredAssertionHandler>();
  private readonly rubricEvaluator: RubricEvaluator | undefined;

  constructor(options: AssertionEvaluatorOptions = {}) {
    this.rubricEvaluator = options.rubricEvaluator;
    this.handlers.set("file-exists", this.fileExists.bind(this));
    this.handlers.set("contains", this.contains.bind(this));
    this.handlers.set("regex", this.regex.bind(this));
    this.handlers.set("command", this.command.bind(this));
    this.handlers.set("exit-code", this.exitCode.bind(this));
    this.handlers.set("llm-rubric", this.llmRubric.bind(this));
    for (const [type, handler] of Object.entries(options.handlers ?? {})) {
      if (handler !== undefined) {
        this.handlers.set(type as EvalAssertion["type"], handler as RegisteredAssertionHandler);
      }
    }
  }

  register<Type extends EvalAssertion["type"]>(type: Type, handler: AssertionHandler<Type>): void {
    this.handlers.set(type, handler as RegisteredAssertionHandler);
  }

  async evaluate(assertion: EvalAssertion, context: AssertionContext): Promise<AssertionResult> {
    context.signal?.throwIfAborted();
    const handler = this.handlers.get(assertion.type);
    if (handler === undefined) {
      return {
        type: assertion.type,
        status: "error",
        passed: false,
        score: 0,
        message: `No assertion handler registered for ${assertion.type}`,
        evidence: {},
        durationMs: 0,
      };
    }
    try {
      return await handler(assertion, context);
    } catch (error) {
      if (context.signal?.aborted === true) throw error;
      return {
        type: assertion.type,
        status: "error",
        passed: false,
        score: 0,
        message: toErrorMessage(error),
        evidence: {},
        durationMs: 0,
      };
    }
  }

  private async fileExists(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "file-exists")
      throw new Error("file-exists handler received wrong assertion");
    try {
      const path = await safeExistingPath(context.workspacePath, assertion.value);
      const stats = await lstat(path);
      const passed = !stats.isSymbolicLink();
      return result(assertion, startedAt, {
        status: passed ? "passed" : "failed",
        passed,
        score: passed ? 1 : 0,
        message: passed
          ? `Path exists: ${assertion.value}`
          : `Path is a symbolic link: ${assertion.value}`,
        evidence: { path: assertion.value, kind: stats.isDirectory() ? "directory" : "file" },
      });
    } catch {
      return result(assertion, startedAt, {
        status: "failed",
        passed: false,
        score: 0,
        message: `Path does not exist inside workspace: ${assertion.value}`,
        evidence: { path: assertion.value },
      });
    }
  }

  private async contains(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "contains") throw new Error("contains handler received wrong assertion");
    const path = await safeExistingPath(context.workspacePath, assertion.path);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
    const passed = content.includes(assertion.value);
    return result(assertion, startedAt, {
      status: passed ? "passed" : "failed",
      passed,
      score: passed ? 1 : 0,
      message: passed
        ? `File contains expected text: ${assertion.path}`
        : `Expected text not found: ${assertion.path}`,
      evidence: { path: assertion.path, expected: assertion.value },
    });
  }

  private async regex(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "regex") throw new Error("regex handler received wrong assertion");
    const typed = assertion as RegexAssertion;
    const path = await safeExistingPath(context.workspacePath, typed.path);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
    const passed = new RegExp(typed.pattern, typed.flags).test(content);
    return result(assertion, startedAt, {
      status: passed ? "passed" : "failed",
      passed,
      score: passed ? 1 : 0,
      message: passed
        ? `Regular expression matched: ${typed.path}`
        : `Regular expression did not match: ${typed.path}`,
      evidence: { path: typed.path, pattern: typed.pattern, flags: typed.flags ?? "" },
    });
  }

  private async command(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "command") throw new Error("command handler received wrong assertion");
    const typed = assertion as CommandAssertion;
    const argv = typeof typed.command === "string" ? splitCommand(typed.command) : typed.command;
    const cwd = await safeExistingPath(context.workspacePath, typed.cwd ?? ".");
    const timeoutMs = typed.timeoutMs ?? context.defaultCommandTimeoutMs;
    const [executable, ...args] = argv;
    if (executable === undefined) throw new Error("Command cannot be empty");
    const commandResult = await execa(executable, args, {
      cwd,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      forceKillAfterDelay: 1_000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      reject: false,
      stripFinalNewline: false,
      ...(context.signal === undefined ? {} : { cancelSignal: context.signal }),
    });
    context.signal?.throwIfAborted();
    const timedOut = commandResult.timedOut;
    if (commandResult.exitCode === undefined && !timedOut) throw commandResult;
    const exitCode = commandResult.exitCode;
    const passed = !timedOut && exitCode === typed.expectedExitCode;
    return result(assertion, startedAt, {
      status: passed ? "passed" : "failed",
      passed,
      score: passed ? 1 : 0,
      message: timedOut
        ? `Command timed out after ${timeoutMs}ms`
        : passed
          ? `Command exited with ${exitCode}`
          : `Command exited with ${exitCode}, expected ${typed.expectedExitCode}`,
      evidence: {
        argv,
        cwd: typed.cwd ?? ".",
        exitCode,
        timedOut,
        stdout: truncate(commandResult.stdout),
        stderr: truncate(commandResult.stderr),
      },
    });
  }

  private async exitCode(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "exit-code")
      throw new Error("exit-code handler received wrong assertion");
    const passed = context.runnerResult.exitCode === assertion.value;
    return result(assertion, startedAt, {
      status: passed ? "passed" : "failed",
      passed,
      score: passed ? 1 : 0,
      message: passed
        ? `Runner exited with ${assertion.value}`
        : `Runner exited with ${context.runnerResult.exitCode}, expected ${assertion.value}`,
      evidence: { actual: context.runnerResult.exitCode, expected: assertion.value },
    });
  }

  private async llmRubric(
    assertion: EvalAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    if (assertion.type !== "llm-rubric")
      throw new Error("llm-rubric handler received wrong assertion");
    const typed = assertion as LlmRubricAssertion;
    if (this.rubricEvaluator === undefined) {
      return result(assertion, startedAt, {
        status: "not-evaluated",
        passed: null,
        score: null,
        message: "No rubric evaluator is configured",
        evidence: {},
      });
    }
    const rubric = await this.rubricEvaluator.evaluate({
      rubric: typed.rubric,
      prompt: context.prompt,
      workspacePath: context.workspacePath,
      runnerResult: context.runnerResult,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    });
    return result(assertion, startedAt, {
      status: rubric.passed ? "passed" : "failed",
      passed: rubric.passed,
      score: rubric.score,
      message: rubric.message,
      evidence: rubric.evidence ?? {},
    });
  }
}
