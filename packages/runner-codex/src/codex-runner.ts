import { SkillbenchError } from "@skillbench/sdk/errors";
import { silentLogger, type Logger } from "@skillbench/sdk/logging";
import {
  parseRunResult,
  runnerPermissionsSchema,
  WorkspaceManager,
  type RunInput,
  type RunResult,
  type Runner,
  type RunnerSandbox,
} from "@skillbench/sdk/runners";
import {
  appendBounded,
  BoundedProcessExecutor,
  CachedVersionProbe,
  createRunnerTrace,
  RunnerProcessStartError,
  sandboxFromPermissions,
  selectEnvironment,
  type BoundedProcessResult,
} from "@skillbench/runner-kit";
import { isCodexExecutionProfile } from "./execution-profile";

export type CodexSandbox = RunnerSandbox;

export type CodexRunnerOptions = {
  executable?: string;
  executableArgs?: readonly string[];
  sandbox?: CodexSandbox;
  maxOutputBytes?: number;
  versionTimeoutMs?: number;
  environment?: Readonly<Record<string, string>>;
  logger?: Logger;
};

type CodexEvent = Record<string, unknown> & { type: string };

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const ENVIRONMENT_ALLOWLIST = [
  "ALL_PROXY",
  "CODEX_HOME",
  "COLORTERM",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "NO_COLOR",
  "NO_PROXY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "PATH",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export class CodexRunner implements Runner {
  private readonly executable: string;
  private readonly sandbox: CodexSandbox;
  private readonly maxOutputBytes: number;
  private readonly versionTimeoutMs: number;
  private readonly logger: Logger;
  private readonly workspaces: WorkspaceManager;
  private readonly processes: BoundedProcessExecutor;
  private readonly versionProbe: CachedVersionProbe;

  constructor(options: CodexRunnerOptions = {}, workspaces?: WorkspaceManager) {
    this.executable = options.executable ?? "codex";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
    this.logger = options.logger ?? silentLogger;
    this.workspaces = workspaces ?? new WorkspaceManager(undefined, this.logger);
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1) {
      throw new SkillbenchError("Codex maxOutputBytes must be a positive integer", {
        code: "CODEX_CONFIG_INVALID",
      });
    }
    this.processes = new BoundedProcessExecutor({
      executable: this.executable,
      ...(options.executableArgs === undefined ? {} : { executableArgs: options.executableArgs }),
      environment:
        options.environment ??
        selectEnvironment(process.env, ENVIRONMENT_ALLOWLIST, { NO_COLOR: "1" }),
      maxOutputBytes: this.maxOutputBytes,
    });
    this.versionProbe = new CachedVersionProbe(() => this.loadVersion());
  }

  async run(input: RunInput): Promise<RunResult> {
    if (!isCodexExecutionProfile(input.executionProfile)) {
      throw new SkillbenchError("CodexRunner requires a Codex execution profile", {
        code: "RUNNER_PROFILE_MISMATCH",
      });
    }
    const version = await this.version();
    if (input.executionProfile.runnerVersion !== version) {
      throw new SkillbenchError(
        `Codex version changed after preflight (${input.executionProfile.runnerVersion} -> ${version})`,
        { code: "CODEX_VERSION_CHANGED" },
      );
    }
    this.logger.debug("codex.run.start", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      model: input.executionProfile.model,
      reasoningEffort: input.executionProfile.reasoningEffort,
      runnerVersion: version,
      sandbox: input.permissions.sandbox ?? this.sandbox,
      timeoutMs: input.timeoutMs,
    });
    const prepared = await this.workspaces.prepare(input);
    const before = await this.workspaces.captureState(input.workspacePath);
    const sandbox = sandboxFromPermissions(
      runnerPermissionsSchema.parse(input.permissions),
      this.sandbox,
    );
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
      "never",
      "--sandbox",
      sandbox,
      "-C",
      input.workspacePath,
      "--model",
      input.executionProfile.model,
      "-c",
      `model_reasoning_effort=${JSON.stringify(input.executionProfile.reasoningEffort)}`,
      input.prompt,
    ];
    const startedAt = performance.now();
    const processResult = await this.execute(
      args,
      input.workspacePath,
      input.timeoutMs,
      input.signal,
    );
    input.signal?.throwIfAborted();
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const after = await this.workspaces.captureState(input.workspacePath);
    const parsed = parseEvents(processResult.stdout.text);
    const turnFailed = parsed.events.some((event) => event.type === "turn.failed");
    const turnCompleted = parsed.events.some((event) => event.type === "turn.completed");
    const protocolFailure =
      !processResult.timedOut && processResult.exitCode === 0 && !turnCompleted;
    const status = processResult.timedOut
      ? "timed-out"
      : processResult.exitCode === 0 && !turnFailed && !protocolFailure
        ? "completed"
        : "failed";
    const finalMessage = findFinalMessage(parsed.events);
    const usage = findUsage(parsed.events);
    const threadId = findThreadId(parsed.events);
    const protocolMessage = protocolFailure
      ? "Codex exited successfully without a turn.completed JSONL event."
      : parsed.invalidLines > 0
        ? `Ignored ${parsed.invalidLines} invalid Codex JSONL event line(s).`
        : "";

    const output: RunResult = {
      status,
      exitCode: processResult.timedOut ? null : processResult.exitCode,
      stdout: finalMessage,
      stderr: appendBounded(processResult.stderr.text, protocolMessage, this.maxOutputBytes),
      durationMs,
      artifacts: this.workspaces.diffArtifacts(before, after),
      ...(usage === undefined ? {} : { tokens: usage }),
      trace: createRunnerTrace("codex", "codex-exec-jsonl-v1", {
        version,
        executionProfile: structuredClone(input.executionProfile),
        ...(threadId === undefined ? {} : { threadId }),
        skillDirectory: prepared.skillDirectory,
        command: this.processes.command([...args.slice(0, -1), "<prompt>"]),
        events: parsed.events,
        invalidEventLines: parsed.invalidLines,
        stdoutTruncated: processResult.stdout.truncated,
        stderrTruncated: processResult.stderr.truncated,
      }),
    };
    this.logger.debug("codex.run.complete", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      status,
      exitCode: output.exitCode,
      durationMs,
      inputTokens: usage?.input,
      outputTokens: usage?.output,
      artifactCount: output.artifacts.length,
    });
    return parseRunResult(output);
  }

  async version(): Promise<string> {
    return this.versionProbe.get();
  }

  private async loadVersion(): Promise<string> {
    this.logger.debug("codex.version.start", { executable: this.executable });
    const result = await this.execute(["--version"], process.cwd(), this.versionTimeoutMs);
    if (result.timedOut) {
      throw new SkillbenchError(
        `Codex version check timed out after ${this.versionTimeoutMs}ms (${this.executable})`,
        { code: "CODEX_VERSION_TIMEOUT" },
      );
    }
    const version = result.stdout.text.trim();
    if (result.exitCode !== 0) {
      throw new SkillbenchError(
        `Codex is unavailable or incompatible (${this.executable}): ${result.stderr.text.trim() || `exit ${result.exitCode}`}`,
        { code: "CODEX_UNAVAILABLE" },
      );
    }
    if (!/^codex-cli\s+\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
      throw new SkillbenchError(`Unsupported Codex version response: ${version || "<empty>"}`, {
        code: "CODEX_VERSION_UNSUPPORTED",
      });
    }
    this.logger.debug("codex.version.complete", { executable: this.executable, version });
    return version;
  }

  private async execute(
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<BoundedProcessResult> {
    try {
      return await this.processes.execute(args, cwd, timeoutMs, signal);
    } catch (error) {
      if (!(error instanceof RunnerProcessStartError)) throw error;
      this.logger.debug("codex.process.start_failed", {
        executable: this.executable,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      throw new SkillbenchError(`Cannot start Codex executable: ${this.executable}`, {
        code: "CODEX_NOT_FOUND",
        cause: error,
      });
    }
  }
}

function parseEvents(stdout: string): { events: CodexEvent[]; invalidLines: number } {
  const events: CodexEvent[] = [];
  let invalidLines = 0;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value) && typeof value.type === "string") events.push(value as CodexEvent);
      else invalidLines += 1;
    } catch {
      invalidLines += 1;
    }
  }
  return { events, invalidLines };
}

function findFinalMessage(events: readonly CodexEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "item.completed" || !isRecord(event.item)) continue;
    if (event.item.type === "agent_message" && typeof event.item.text === "string") {
      return event.item.text;
    }
  }
  return "";
}

function findThreadId(events: readonly CodexEvent[]): string | undefined {
  const event = events.find((candidate) => candidate.type === "thread.started");
  return event !== undefined && typeof event.thread_id === "string" ? event.thread_id : undefined;
}

function findUsage(events: readonly CodexEvent[]): { input: number; output: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "turn.completed" || !isRecord(event.usage)) continue;
    const input = event.usage.input_tokens;
    const output = event.usage.output_tokens;
    if (typeof input === "number" && typeof output === "number") return { input, output };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
