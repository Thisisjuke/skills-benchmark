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

import { isClaudeExecutionProfile } from "./execution-profile";

export type ClaudeSandbox = RunnerSandbox;

export type ClaudeRunnerOptions = {
  executable?: string;
  executableArgs?: readonly string[];
  sandbox?: ClaudeSandbox;
  maxOutputBytes?: number;
  versionTimeoutMs?: number;
  environment?: Readonly<Record<string, string>>;
  logger?: Logger;
};

type ClaudeResult = {
  type: "result";
  subtype: string;
  is_error: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
};

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const READ_ONLY_TOOLS = "Read,Glob,Grep,Skill";
const WORKSPACE_WRITE_TOOLS = "Read,Glob,Grep,Skill,Edit,Write,Bash";
const ENVIRONMENT_ALLOWLIST = [
  "ALL_PROXY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_DEFAULT_REGION",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CLOUD_ML_REGION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_PROXY",
  "PATH",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "USER",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

export class ClaudeRunner implements Runner {
  private readonly executable: string;
  private readonly sandbox: ClaudeSandbox;
  private readonly maxOutputBytes: number;
  private readonly versionTimeoutMs: number;
  private readonly logger: Logger;
  private readonly workspaces: WorkspaceManager;
  private readonly processes: BoundedProcessExecutor;
  private readonly versionProbe: CachedVersionProbe;

  constructor(options: ClaudeRunnerOptions = {}, workspaces?: WorkspaceManager) {
    this.executable = options.executable ?? "claude";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
    this.logger = options.logger ?? silentLogger;
    this.workspaces =
      workspaces ?? new WorkspaceManager(undefined, this.logger, { skillRoot: ".claude/skills" });
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1) {
      throw new SkillbenchError("Claude maxOutputBytes must be a positive integer", {
        code: "CLAUDE_CONFIG_INVALID",
      });
    }
    this.processes = new BoundedProcessExecutor({
      executable: this.executable,
      ...(options.executableArgs === undefined ? {} : { executableArgs: options.executableArgs }),
      environment:
        options.environment ??
        selectEnvironment(process.env, ENVIRONMENT_ALLOWLIST, {
          NO_COLOR: "1",
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
          CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
        }),
      maxOutputBytes: this.maxOutputBytes,
    });
    this.versionProbe = new CachedVersionProbe(() => this.loadVersion());
  }

  async run(input: RunInput): Promise<RunResult> {
    if (!isClaudeExecutionProfile(input.executionProfile)) {
      throw new SkillbenchError("ClaudeRunner requires a Claude execution profile", {
        code: "RUNNER_PROFILE_MISMATCH",
      });
    }
    const version = await this.version();
    if (input.executionProfile.runnerVersion !== version) {
      throw new SkillbenchError(
        `Claude version changed after preflight (${input.executionProfile.runnerVersion} -> ${version})`,
        { code: "CLAUDE_VERSION_CHANGED" },
      );
    }
    const sandbox = sandboxFromPermissions(
      runnerPermissionsSchema.parse(input.permissions),
      this.sandbox,
    );
    this.logger.debug("claude.run.start", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      model: input.executionProfile.model,
      effort: input.executionProfile.effort,
      runnerVersion: version,
      sandbox,
      timeoutMs: input.timeoutMs,
    });
    const prepared = await this.workspaces.prepare(input);
    const before = await this.workspaces.captureState(input.workspacePath);
    const settings = {
      autoMemoryEnabled: false,
      sandbox: {
        enabled: sandbox === "workspace-write",
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
      },
    };
    const args = [
      "-p",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--no-chrome",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--model",
      input.executionProfile.model,
      "--effort",
      input.executionProfile.effort,
      "--permission-mode",
      sandbox === "read-only" ? "dontAsk" : "acceptEdits",
      "--tools",
      sandbox === "read-only" ? READ_ONLY_TOOLS : WORKSPACE_WRITE_TOOLS,
      "--settings",
      JSON.stringify(settings),
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
    const parsed = parseResult(processResult.stdout.text);
    const protocolFailure =
      !processResult.timedOut && processResult.exitCode === 0 && parsed.result === undefined;
    const reportedFailure =
      parsed.result?.is_error === true || parsed.result?.subtype !== "success";
    const status = processResult.timedOut
      ? "timed-out"
      : processResult.exitCode === 0 && !protocolFailure && !reportedFailure
        ? "completed"
        : "failed";
    const protocolMessage = protocolFailure
      ? "Claude exited successfully without a valid result JSON object."
      : parsed.invalid
        ? "Claude emitted invalid JSON before its result."
        : "";
    const usage = tokens(parsed.result);
    const output: RunResult = {
      status,
      exitCode: processResult.timedOut ? null : processResult.exitCode,
      stdout: parsed.result?.result ?? "",
      stderr: appendBounded(processResult.stderr.text, protocolMessage, this.maxOutputBytes),
      durationMs,
      artifacts: this.workspaces.diffArtifacts(before, after),
      ...(usage === undefined ? {} : { tokens: usage }),
      trace: createRunnerTrace("claude", "claude-print-json-v1", {
        version,
        executionProfile: structuredClone(input.executionProfile),
        ...(parsed.result?.session_id === undefined ? {} : { sessionId: parsed.result.session_id }),
        ...(parsed.result?.num_turns === undefined ? {} : { numTurns: parsed.result.num_turns }),
        ...(parsed.result?.total_cost_usd === undefined
          ? {}
          : { totalCostUsd: parsed.result.total_cost_usd }),
        skillDirectory: prepared.skillDirectory,
        command: this.processes.command([...args.slice(0, -1), "<prompt>"]),
        stdoutTruncated: processResult.stdout.truncated,
        stderrTruncated: processResult.stderr.truncated,
      }),
    };
    this.logger.debug("claude.run.complete", {
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
    this.logger.debug("claude.version.start", { executable: this.executable });
    const result = await this.execute(["--version"], process.cwd(), this.versionTimeoutMs);
    if (result.timedOut) {
      throw new SkillbenchError(
        `Claude version check timed out after ${this.versionTimeoutMs}ms (${this.executable})`,
        { code: "CLAUDE_VERSION_TIMEOUT" },
      );
    }
    const version = result.stdout.text.trim();
    if (result.exitCode !== 0) {
      throw new SkillbenchError(
        `Claude is unavailable or incompatible (${this.executable}): ${result.stderr.text.trim() || `exit ${result.exitCode}`}`,
        { code: "CLAUDE_UNAVAILABLE" },
      );
    }
    if (
      !/^(?:claude-code\s+)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?:\s+\(Claude Code\))?$/u.test(
        version,
      )
    ) {
      throw new SkillbenchError(`Unsupported Claude version response: ${version || "<empty>"}`, {
        code: "CLAUDE_VERSION_UNSUPPORTED",
      });
    }
    this.logger.debug("claude.version.complete", { executable: this.executable, version });
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
      throw new SkillbenchError(`Cannot start Claude executable: ${this.executable}`, {
        code: "CLAUDE_NOT_FOUND",
        cause: error,
      });
    }
  }
}

function parseResult(stdout: string): { result?: ClaudeResult; invalid: boolean } {
  try {
    const value: unknown = JSON.parse(stdout);
    return isClaudeResult(value) ? { result: value, invalid: false } : { invalid: true };
  } catch {
    return { invalid: stdout.trim() !== "" };
  }
}

function isClaudeResult(value: unknown): value is ClaudeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "result" &&
    "subtype" in value &&
    typeof value.subtype === "string" &&
    "is_error" in value &&
    typeof value.is_error === "boolean"
  );
}

function tokens(result: ClaudeResult | undefined): { input: number; output: number } | undefined {
  const input = result?.usage?.input_tokens;
  const output = result?.usage?.output_tokens;
  return typeof input === "number" && typeof output === "number" ? { input, output } : undefined;
}
