import { execa } from "execa";

export type CapturedOutput = {
  text: string;
  truncated: boolean;
};

export type BoundedProcessResult = {
  exitCode: number;
  stdout: CapturedOutput;
  stderr: CapturedOutput;
  timedOut: boolean;
};

export type BoundedProcessExecutorOptions = {
  executable: string;
  executableArgs?: readonly string[];
  environment: Readonly<Record<string, string>>;
  maxOutputBytes: number;
};

export class RunnerProcessStartError extends Error {
  constructor(
    readonly executable: string,
    options: { cause: unknown },
  ) {
    super(`Cannot start runner executable: ${executable}`, { cause: options.cause });
    this.name = "RunnerProcessStartError";
  }
}

export class BoundedProcessExecutor {
  private readonly executable: string;
  private readonly executableArgs: readonly string[];
  private readonly environment: Readonly<Record<string, string>>;
  private readonly maxOutputBytes: number;

  constructor(options: BoundedProcessExecutorOptions) {
    this.executable = options.executable;
    this.executableArgs = options.executableArgs ?? [];
    this.environment = options.environment;
    this.maxOutputBytes = options.maxOutputBytes;
  }

  command(args: readonly string[]): string[] {
    return [this.executable, ...this.executableArgs, ...args];
  }

  async execute(
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<BoundedProcessResult> {
    let result;
    try {
      result = await execa(this.executable, [...this.executableArgs, ...args], {
        cwd,
        env: this.environment,
        extendEnv: false,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
        forceKillAfterDelay: 1_000,
        maxBuffer: this.maxOutputBytes,
        reject: false,
        stripFinalNewline: false,
        ...(signal === undefined ? {} : { cancelSignal: signal }),
      });
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason;
      throw new RunnerProcessStartError(this.executable, { cause: error });
    }
    if (
      result.failed &&
      result.exitCode === undefined &&
      !result.timedOut &&
      !result.isTerminated &&
      "code" in result &&
      result.code === "ENOENT"
    ) {
      throw new RunnerProcessStartError(this.executable, { cause: result });
    }
    return {
      exitCode: result.exitCode ?? -1,
      stdout: { text: result.stdout, truncated: result.isMaxBuffer },
      stderr: { text: result.stderr, truncated: result.isMaxBuffer },
      timedOut: result.timedOut,
    };
  }
}
