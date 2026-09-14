import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as z from "zod";

import { createRunnerPermissions, type ExecutionProfile, type Runner } from "../runners";
import type { SkillSnapshot } from "../skills";
import type { Judge, JudgeInput, JudgeResult } from "./judge";

export type RunnerBackedJudgeOptions = {
  executionProfile: ExecutionProfile;
  timeoutMs?: number;
  workspaceParent?: string;
  skillSnapshot: SkillSnapshot;
  instruction: string;
  id?: () => string;
};

const resultSchema = z
  .object({
    winner: z.enum(["X", "Y", "tie"]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()).min(1).max(20),
  })
  .strict();

export class RunnerBackedJudge implements Judge {
  private readonly timeoutMs: number;
  private readonly executionProfile: ExecutionProfile;
  private readonly workspaceParent: string;
  private readonly skillSnapshot: SkillSnapshot;
  private readonly instruction: string;
  private readonly id: () => string;

  constructor(
    private readonly runner: Runner,
    options: RunnerBackedJudgeOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.executionProfile = options.executionProfile;
    this.workspaceParent = options.workspaceParent ?? tmpdir();
    this.skillSnapshot = options.skillSnapshot;
    this.instruction = options.instruction.trim();
    if (this.instruction === "") throw new Error("Judge instruction cannot be empty");
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async compare(input: JudgeInput): Promise<JudgeResult> {
    await mkdir(this.workspaceParent, { recursive: true });
    const root = await mkdtemp(join(this.workspaceParent, "skillbench-judge-"));
    try {
      const runId = this.id();
      const result = await this.runner.run({
        runId,
        evalCaseId: "blind-pairwise",
        repetition: 1,
        snapshot: this.skillSnapshot,
        prompt: JSON.stringify({
          instruction: this.instruction,
          rubric: input.rubric,
          prompt: input.prompt,
          candidates: input.candidates,
        }),
        fixtures: [],
        timeoutMs: this.timeoutMs,
        workspacePath: join(root, "attempt"),
        permissions: createRunnerPermissions("read-only"),
        executionProfile: this.executionProfile,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      input.signal?.throwIfAborted();
      if (result.status !== "completed") {
        throw new Error(
          `Judge runner ${result.status}: ${result.stderr || `exit ${result.exitCode}`}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout);
      } catch (error) {
        throw new Error(
          `Judge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const judged = resultSchema.parse(parsed);
      return {
        ...judged,
        raw: {
          runnerDurationMs: result.durationMs,
          ...(result.tokens === undefined ? {} : { tokens: result.tokens }),
        },
      };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
