import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  type BoundedProcessResult,
} from "@skillbench/runner-kit";

import { isOpenCodeExecutionProfile } from "./execution-profile";

export type OpenCodeSandbox = RunnerSandbox;

export type OpenCodeRunnerOptions = {
  executable?: string;
  executableArgs?: readonly string[];
  sandbox?: OpenCodeSandbox;
  maxOutputBytes?: number;
  versionTimeoutMs?: number;
  environment?: Readonly<Record<string, string>>;
  logger?: Logger;
};

type OpenCodeEvent = {
  type?: unknown;
  sessionID?: unknown;
  part?: unknown;
  error?: unknown;
};

type ParsedProtocol = {
  text: string;
  sessionId?: string;
  errors: string[];
  invalidLines: number;
  tokens?: { input: number; output: number };
  totalCost?: number;
};

type CleanupResult = { status: "deleted" | "not-found" | "failed"; message?: string };

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_VERSION_TIMEOUT_MS = 5_000;
const MINIMUM_VERSION = [1, 18, 12] as const;
export const OPENCODE_VERSION_RANGE = ">=1.18.12 <2.0.0";

export class OpenCodeRunner implements Runner {
  private readonly executable: string;
  private readonly sandbox: OpenCodeSandbox;
  private readonly maxOutputBytes: number;
  private readonly versionTimeoutMs: number;
  private readonly logger: Logger;
  private readonly workspaces: WorkspaceManager;
  private readonly processes: BoundedProcessExecutor;
  private readonly versionProbe: CachedVersionProbe;

  constructor(options: OpenCodeRunnerOptions = {}, workspaces?: WorkspaceManager) {
    this.executable = options.executable ?? "opencode";
    this.sandbox = options.sandbox ?? "workspace-write";
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
    this.logger = options.logger ?? silentLogger;
    this.workspaces =
      workspaces ?? new WorkspaceManager(undefined, this.logger, { skillRoot: ".opencode/skills" });
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1) {
      throw new SkillbenchError("OpenCode maxOutputBytes must be a positive integer", {
        code: "OPENCODE_CONFIG_INVALID",
      });
    }
    this.processes = new BoundedProcessExecutor({
      executable: this.executable,
      ...(options.executableArgs === undefined ? {} : { executableArgs: options.executableArgs }),
      environment: options.environment ?? inheritedEnvironment(process.env),
      maxOutputBytes: this.maxOutputBytes,
    });
    this.versionProbe = new CachedVersionProbe(() => this.loadVersion());
  }

  async run(input: RunInput): Promise<RunResult> {
    if (!isOpenCodeExecutionProfile(input.executionProfile)) {
      throw new SkillbenchError("OpenCodeRunner requires an OpenCode execution profile", {
        code: "RUNNER_PROFILE_MISMATCH",
      });
    }
    const version = await this.version();
    if (input.executionProfile.runnerVersion !== version) {
      throw new SkillbenchError(
        `OpenCode version changed after preflight (${input.executionProfile.runnerVersion} -> ${version})`,
        { code: "OPENCODE_VERSION_CHANGED" },
      );
    }
    const sandbox = sandboxFromPermissions(
      runnerPermissionsSchema.parse(input.permissions),
      this.sandbox,
    );
    const prepared = await this.workspaces.prepare(input);
    await this.writeAgent(input.workspacePath, prepared.skillDirectoryName, sandbox);
    const before = await this.workspaces.captureState(input.workspacePath);
    const title = `skillbench-${input.runId}-${input.evalCaseId}-${input.repetition}-${randomUUID()}`;
    const args = [
      "run",
      "--format",
      "json",
      "--pure",
      "--title",
      title,
      ...(input.executionProfile.model === undefined
        ? []
        : ["--model", input.executionProfile.model]),
      "--agent",
      "skillbench",
      ...(input.executionProfile.variant === undefined
        ? []
        : ["--variant", input.executionProfile.variant]),
      input.prompt,
    ];
    this.logger.debug("opencode.run.start", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      model: input.executionProfile.model,
      variant: input.executionProfile.variant,
      runnerVersion: version,
      sandbox,
      timeoutMs: input.timeoutMs,
    });
    const startedAt = performance.now();
    let processResult: BoundedProcessResult;
    let parsed: ParsedProtocol | undefined;
    let cleanup: CleanupResult = { status: "not-found" };
    try {
      processResult = await this.execute(args, input.workspacePath, input.timeoutMs, input.signal);
      parsed = parseProtocol(processResult.stdout.text);
      cleanup = await this.cleanupSession(parsed.sessionId, title, input.workspacePath);
    } catch (error) {
      cleanup = await this.cleanupSession(undefined, title, input.workspacePath);
      if (cleanup.status === "failed") {
        this.logger.debug("opencode.session.cleanup.failed", { title, message: cleanup.message });
      }
      throw error;
    }
    input.signal?.throwIfAborted();
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const after = await this.workspaces.captureState(input.workspacePath);
    const protocolFailure =
      !processResult.timedOut &&
      processResult.exitCode === 0 &&
      (parsed.text.trim() === "" || parsed.errors.length > 0);
    const status = processResult.timedOut
      ? "timed-out"
      : processResult.exitCode === 0 && !protocolFailure
        ? "completed"
        : "failed";
    const protocolMessage =
      parsed.errors.length > 0
        ? `OpenCode reported errors: ${parsed.errors.join("; ")}`
        : protocolFailure
          ? "OpenCode exited successfully without a final text JSONL event."
          : parsed.invalidLines > 0
            ? `OpenCode emitted ${parsed.invalidLines} invalid JSONL line(s).`
            : "";
    const cleanupMessage =
      cleanup.status === "failed"
        ? `OpenCode session cleanup failed: ${cleanup.message ?? "unknown error"}`
        : "";
    const output: RunResult = {
      status,
      exitCode: processResult.timedOut ? null : processResult.exitCode,
      stdout: parsed.text,
      stderr: appendBounded(
        appendBounded(processResult.stderr.text, protocolMessage, this.maxOutputBytes),
        cleanupMessage,
        this.maxOutputBytes,
      ),
      durationMs,
      artifacts: this.workspaces.diffArtifacts(before, after),
      ...(parsed.tokens === undefined ? {} : { tokens: parsed.tokens }),
      trace: createRunnerTrace("opencode", "opencode-run-jsonl-v1", {
        version,
        executionProfile: structuredClone(input.executionProfile),
        ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
        ...(parsed.totalCost === undefined ? {} : { totalCost: parsed.totalCost }),
        skillDirectory: prepared.skillDirectory,
        sessionCleanup: cleanup.status,
        inheritedConfiguration: true,
        command: this.processes.command([...args.slice(0, -1), "<prompt>"]),
        stdoutTruncated: processResult.stdout.truncated,
        stderrTruncated: processResult.stderr.truncated,
      }),
    };
    this.logger.debug("opencode.run.complete", {
      runId: input.runId,
      status,
      exitCode: output.exitCode,
      durationMs,
      sessionCleanup: cleanup.status,
      artifactCount: output.artifacts.length,
    });
    return parseRunResult(output);
  }

  async version(): Promise<string> {
    return this.versionProbe.get();
  }

  private async loadVersion(): Promise<string> {
    const result = await this.execute(["--version"], process.cwd(), this.versionTimeoutMs);
    if (result.timedOut) {
      throw new SkillbenchError(
        `OpenCode version check timed out after ${this.versionTimeoutMs}ms (${this.executable})`,
        { code: "OPENCODE_VERSION_TIMEOUT" },
      );
    }
    const version = result.stdout.text.trim();
    if (result.exitCode !== 0) {
      throw new SkillbenchError(
        `OpenCode is unavailable or incompatible (${this.executable}): ${result.stderr.text.trim() || `exit ${result.exitCode}`}`,
        { code: "OPENCODE_UNAVAILABLE" },
      );
    }
    if (!isSupportedOpenCodeVersion(version)) {
      throw new SkillbenchError(
        `Unsupported OpenCode version: ${version || "<empty>"} (requires ${OPENCODE_VERSION_RANGE})`,
        { code: "OPENCODE_VERSION_UNSUPPORTED" },
      );
    }
    return version;
  }

  private async writeAgent(
    workspacePath: string,
    skillName: string,
    sandbox: RunnerSandbox,
  ): Promise<void> {
    const directory = join(workspacePath, ".opencode", "agents");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "skillbench.md"),
      agentDefinition(skillName, sandbox),
      "utf8",
    );
  }

  private async cleanupSession(
    sessionId: string | undefined,
    title: string,
    cwd: string,
  ): Promise<CleanupResult> {
    try {
      const resolvedId = sessionId ?? (await this.findSession(title, cwd));
      if (resolvedId === undefined) return { status: "not-found" };
      const result = await this.execute(
        ["session", "delete", resolvedId, "--pure"],
        cwd,
        this.versionTimeoutMs,
      );
      return result.exitCode === 0
        ? { status: "deleted" }
        : {
            status: "failed",
            message: result.stderr.text.trim() || `exit ${result.exitCode}`,
          };
    } catch (error) {
      return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async findSession(title: string, cwd: string): Promise<string | undefined> {
    const result = await this.execute(
      ["session", "list", "--format", "json", "--max-count", "50", "--pure"],
      cwd,
      this.versionTimeoutMs,
    );
    if (result.exitCode !== 0) return undefined;
    const value: unknown = JSON.parse(result.stdout.text);
    if (!Array.isArray(value)) return undefined;
    const match = value.find(
      (entry): entry is { id: string; title: string } =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        typeof entry.id === "string" &&
        "title" in entry &&
        entry.title === title,
    );
    return match?.id;
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
      throw new SkillbenchError(`Cannot start OpenCode executable: ${this.executable}`, {
        code: "OPENCODE_NOT_FOUND",
        cause: error,
      });
    }
  }
}

export function isSupportedOpenCodeVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(version.trim());
  return match !== null && supportedVersion(match.slice(1, 4).map(Number));
}

function inheritedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...environment, NO_COLOR: "1" }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function supportedVersion(parts: number[]): boolean {
  const [major = 0, minor = 0, patch = 0] = parts;
  if (major !== 1) return false;
  return (
    minor > MINIMUM_VERSION[1] ||
    (minor === MINIMUM_VERSION[1] && patch >= MINIMUM_VERSION[2])
  );
}

function agentDefinition(skillName: string, sandbox: RunnerSandbox): string {
  return `---\ndescription: Skillbench evaluation runner\nmode: primary\npermission:\n  "*": deny\n  read:\n    "*": allow\n    "*.env": deny\n    "*.env.*": deny\n    "*.env.example": allow\n  glob: allow\n  grep: allow\n  list: allow\n  skill:\n    "*": deny\n    "${skillName}": allow\n  edit: ${sandbox === "workspace-write" ? "allow" : "deny"}\n  bash: deny\n  task: deny\n  external_directory: deny\n  webfetch: deny\n  websearch: deny\n  question: deny\n---\nUse the available Skillbench skill when it applies. Stay inside the current workspace.\n`;
}

function parseProtocol(stdout: string): ParsedProtocol {
  const texts: string[] = [];
  const errors: string[] = [];
  let sessionId: string | undefined;
  let invalidLines = 0;
  let input = 0;
  let output = 0;
  let hasTokens = false;
  let totalCost = 0;
  let hasCost = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    let event: OpenCodeEvent;
    try {
      event = JSON.parse(line) as OpenCodeEvent;
    } catch {
      invalidLines += 1;
      continue;
    }
    if (typeof event.sessionID === "string") sessionId ??= event.sessionID;
    if (event.type === "text" && isRecord(event.part) && typeof event.part.text === "string") {
      texts.push(event.part.text);
    }
    if (event.type === "error") errors.push(errorMessage(event.error));
    if (event.type === "step_finish" && isRecord(event.part)) {
      if (isRecord(event.part.tokens)) {
        const eventInput = numeric(event.part.tokens.input);
        const eventOutput = numeric(event.part.tokens.output);
        if (eventInput !== undefined && eventOutput !== undefined) {
          input += eventInput;
          output += eventOutput;
          hasTokens = true;
        }
      }
      const cost = numeric(event.part.cost);
      if (cost !== undefined) {
        totalCost += cost;
        hasCost = true;
      }
    }
  }
  return {
    text: texts.join("\n"),
    ...(sessionId === undefined ? {} : { sessionId }),
    errors,
    invalidLines,
    ...(hasTokens ? { tokens: { input, output } } : {}),
    ...(hasCost ? { totalCost } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function errorMessage(value: unknown): string {
  if (isRecord(value) && isRecord(value.data) && typeof value.data.message === "string") {
    return value.data.message;
  }
  if (isRecord(value) && typeof value.name === "string") return value.name;
  return typeof value === "string" ? value : "unknown OpenCode error";
}
