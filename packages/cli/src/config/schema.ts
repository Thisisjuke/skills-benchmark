import * as z from "zod";

import { runnerSandboxSchema } from "@skillbench/sdk/runners";
import {
  runnerDefinition,
  runnerEffortSchema,
  runnerTypeSchema,
  type RunnerEffort,
  type RunnerType,
} from "../composition/runner-registry";

export { runnerEffortSchema, runnerTypeSchema, type RunnerEffort, type RunnerType };

const runnerSchema = z
  .object({
    type: runnerTypeSchema.default("codex"),
    executable: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    reasoningEffort: runnerEffortSchema.optional(),
    sandbox: runnerSandboxSchema.default("workspace-write"),
    maxOutputBytes: z
      .number()
      .int()
      .min(1)
      .default(1024 * 1024),
  })
  .strict()
  .superRefine((runner, context) => {
    const definition = runnerDefinition(runner.type);
    if (runner.reasoningEffort !== undefined && !definition.acceptsEffort(runner.reasoningEffort)) {
      context.addIssue({
        code: "custom",
        path: ["reasoningEffort"],
        message:
          definition.efforts.length === 0
            ? `${definition.label} does not accept a reasoning effort`
            : `${definition.name} effort must be ${definition.efforts.join(", ")}`,
      });
    }
  })
  .transform((runner) => ({
    ...runner,
    executable: runner.executable ?? runnerDefinition(runner.type).defaultExecutable,
  }));

const evalSchema = z
  .object({
    path: z.string().trim().min(1).default(".skillbench/evals/development/default.yaml"),
    repeat: z.number().int().min(1).max(100).default(3),
    timeoutMs: z.number().int().min(1).default(180_000),
  })
  .strict();

const comparisonWeightsSchema = z
  .object({
    functionalCorrectness: z.number().min(0).max(1).default(0.4),
    outputQuality: z.number().min(0).max(1).default(0.2),
    edgeCases: z.number().min(0).max(1).default(0.15),
    skillTriggering: z.number().min(0).max(1).default(0.1),
    instructionFollowing: z.number().min(0).max(1).default(0.05),
    tokenEfficiency: z.number().min(0).max(1).default(0.05),
    latency: z.number().min(0).max(1).default(0.05),
  })
  .strict()
  .superRefine((weights, context) => {
    const entries = Object.entries(weights);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({ code: "custom", message: `weights must sum to 1 (received ${total})` });
    }
    const strongestAlternative = Math.max(
      weights.outputQuality,
      weights.edgeCases,
      weights.skillTriggering,
      weights.instructionFollowing,
      weights.tokenEfficiency,
      weights.latency,
    );
    if (weights.functionalCorrectness <= strongestAlternative) {
      context.addIssue({
        code: "custom",
        path: ["functionalCorrectness"],
        message: "must be strictly greater than every other dimension weight",
      });
    }
  });

const comparisonSchema = z
  .object({
    tieThreshold: z.number().min(0).max(1).default(0.01),
    weights: comparisonWeightsSchema.default({
      functionalCorrectness: 0.4,
      outputQuality: 0.2,
      edgeCases: 0.15,
      skillTriggering: 0.1,
      instructionFollowing: 0.05,
      tokenEfficiency: 0.05,
      latency: 0.05,
    }),
  })
  .strict();

const judgeSchema = z
  .object({
    blind: z.boolean().default(true),
    reversePairwise: z.boolean().default(true),
  })
  .strict();

const promptfooSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .strict();

const mergeSchema = z
  .object({
    candidates: z.number().int().min(1).max(10).default(3),
    requireImprovement: z.boolean().default(true),
    minimumImprovement: z.number().min(0).max(1).default(0),
  })
  .strict();

export const DEFAULT_COMPARISON_REPORT_PATH = ".skillbench/reports/comparison.md";

const reportsSchema = z
  .object({
    markdown: z.boolean().default(true),
    template: z.string().trim().min(1).default(DEFAULT_COMPARISON_REPORT_PATH),
  })
  .strict();

export const DEFAULT_RUNS_DIRECTORY = ".skillbench/runs";

const outputsSchema = z
  .object({
    directory: z.string().trim().min(1).default(DEFAULT_RUNS_DIRECTORY),
  })
  .strict();

const sourcesSchema = z
  .object({
    timeoutMs: z.number().int().min(1).default(30_000),
    maxFileSizeBytes: z
      .number()
      .int()
      .min(1)
      .default(2 * 1024 * 1024),
    maxSnapshotSizeBytes: z
      .number()
      .int()
      .min(1)
      .default(25 * 1024 * 1024),
  })
  .strict()
  .refine((value) => value.maxSnapshotSizeBytes >= value.maxFileSizeBytes, {
    message: "maxSnapshotSizeBytes must be greater than or equal to maxFileSizeBytes",
  });

export const skillbenchConfigSchema = z
  .object({
    runner: runnerSchema.default({
      type: "codex",
      executable: "codex",
      sandbox: "workspace-write",
      maxOutputBytes: 1024 * 1024,
    }),
    eval: evalSchema.default({
      path: ".skillbench/evals/development/default.yaml",
      repeat: 3,
      timeoutMs: 180_000,
    }),
    comparison: comparisonSchema.default({
      tieThreshold: 0.01,
      weights: {
        functionalCorrectness: 0.4,
        outputQuality: 0.2,
        edgeCases: 0.15,
        skillTriggering: 0.1,
        instructionFollowing: 0.05,
        tokenEfficiency: 0.05,
        latency: 0.05,
      },
    }),
    judge: judgeSchema.default({ blind: true, reversePairwise: true }),
    promptfoo: promptfooSchema.default({ enabled: true }),
    merge: mergeSchema.default({ candidates: 3, requireImprovement: true, minimumImprovement: 0 }),
    reports: reportsSchema.default({
      markdown: true,
      template: DEFAULT_COMPARISON_REPORT_PATH,
    }),
    outputs: outputsSchema.default({ directory: DEFAULT_RUNS_DIRECTORY }),
    sources: sourcesSchema.default({
      timeoutMs: 30_000,
      maxFileSizeBytes: 2 * 1024 * 1024,
      maxSnapshotSizeBytes: 25 * 1024 * 1024,
    }),
  })
  .strict();

export type SkillbenchConfig = z.infer<typeof skillbenchConfigSchema>;

export function resolveConfigPaths(config: SkillbenchConfig, _cwd: string): SkillbenchConfig {
  return config;
}
