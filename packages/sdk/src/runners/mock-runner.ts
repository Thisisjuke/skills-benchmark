import { SkillbenchError } from "../errors";
import { silentLogger, type Logger } from "../logging";
import { hashBytes } from "../skills";
import { WorkspaceManager } from "./workspace";
import { isMockExecutionProfile } from "./execution-profile";
import {
  parseRunResult,
  type RunArtifact,
  type RunInput,
  type RunResult,
  type Runner,
} from "./runner";
import type { RunnerTrace } from "./trace";

export type MockRunPlan = {
  status?: RunResult["status"];
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  files?: Readonly<Record<string, string | Uint8Array>>;
  tokens?: { input: number; output: number };
  skillActivated?: boolean;
  trace?: RunnerTrace;
};

export type MockRunHandler = (input: RunInput) => MockRunPlan | Promise<MockRunPlan>;

export class MockRunner implements Runner {
  private readonly workspaces: WorkspaceManager;
  private readonly logger: Logger;

  constructor(
    private readonly handler: MockRunHandler = () => ({}),
    workspaces?: WorkspaceManager,
    logger: Logger = silentLogger,
  ) {
    this.logger = logger;
    this.workspaces = workspaces ?? new WorkspaceManager(undefined, logger);
  }

  async run(input: RunInput): Promise<RunResult> {
    input.signal?.throwIfAborted();
    if (!isMockExecutionProfile(input.executionProfile)) {
      throw new SkillbenchError("MockRunner requires a mock execution profile", {
        code: "RUNNER_PROFILE_MISMATCH",
      });
    }
    this.logger.debug("mock.run.start", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
    });
    await this.workspaces.prepare(input);
    input.signal?.throwIfAborted();
    const plan = await this.handler(input);
    const artifacts: RunArtifact[] = [];
    const entries = Object.entries(plan.files ?? {}).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    );
    for (const [relativePath, value] of entries) {
      const content = typeof value === "string" ? new TextEncoder().encode(value) : value;
      await this.workspaces.writeOutput(input.workspacePath, relativePath, content);
      artifacts.push({
        relativePath,
        contentHash: hashBytes(content),
        sizeBytes: content.byteLength,
      });
    }

    const status = plan.status ?? "completed";
    const output: RunResult = {
      status,
      exitCode: plan.exitCode === undefined ? (status === "completed" ? 0 : null) : plan.exitCode,
      stdout: plan.stdout ?? "",
      stderr: plan.stderr ?? "",
      durationMs: plan.durationMs ?? 0,
      artifacts,
      ...(plan.tokens === undefined ? {} : { tokens: plan.tokens }),
      ...(plan.skillActivated === undefined ? {} : { skillActivated: plan.skillActivated }),
      ...(plan.trace === undefined ? {} : { trace: plan.trace }),
    };
    this.logger.debug("mock.run.complete", {
      runId: input.runId,
      evalCaseId: input.evalCaseId,
      repetition: input.repetition,
      status,
      exitCode: output.exitCode,
      durationMs: output.durationMs,
      artifactCount: artifacts.length,
    });
    return parseRunResult(output);
  }
}
