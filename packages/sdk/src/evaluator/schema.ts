import * as z from "zod";

const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\"), "must be relative")
  .refine(
    (value) => !value.split(/[\\/]/).some((segment) => segment === ".."),
    "must not escape its root",
  );

const fileExistsSchema = z
  .object({
    type: z.literal("file-exists"),
    value: safeRelativePath,
  })
  .strict();

const containsSchema = z
  .object({
    type: z.literal("contains"),
    path: safeRelativePath,
    value: z.string().min(1),
  })
  .strict();

const regexSchema = z
  .object({
    type: z.literal("regex"),
    path: safeRelativePath,
    pattern: z.string().min(1),
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      new RegExp(value.pattern, value.flags);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["pattern"],
        message: error instanceof Error ? error.message : "invalid regular expression",
      });
    }
  });

const commandSchema = z
  .object({
    type: z.literal("command"),
    command: z.union([z.string().trim().min(1), z.array(z.string().min(1)).min(1)]),
    cwd: safeRelativePath.optional(),
    timeoutMs: z.number().int().min(1).optional(),
    expectedExitCode: z.number().int().min(0).max(255).default(0),
  })
  .strict();

const exitCodeSchema = z
  .object({
    type: z.literal("exit-code"),
    value: z.number().int().min(0).max(255),
  })
  .strict();

const llmRubricSchema = z
  .object({
    type: z.literal("llm-rubric"),
    rubric: z.string().trim().min(1),
  })
  .strict();

const promptfooAssertionTypeSchema = z.enum([
  "equals",
  "not-equals",
  "contains",
  "not-contains",
  "icontains",
  "not-icontains",
  "contains-all",
  "contains-any",
  "starts-with",
  "regex",
  "not-regex",
  "is-json",
  "contains-json",
  "is-xml",
  "contains-xml",
  "is-html",
  "contains-html",
  "is-sql",
  "contains-sql",
  "word-count",
  "levenshtein",
]);

const promptfooAssertionSchema = z
  .object({
    type: z.literal("promptfoo"),
    assertion: z
      .object({
        type: promptfooAssertionTypeSchema,
        value: z
          .union([z.string(), z.array(z.string()), z.number(), z.record(z.string(), z.unknown())])
          .optional(),
        threshold: z.number().min(0).optional(),
        weight: z.number().positive().optional(),
        metric: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const evalAssertionSchema = z.discriminatedUnion("type", [
  fileExistsSchema,
  containsSchema,
  regexSchema,
  commandSchema,
  exitCodeSchema,
  llmRubricSchema,
  promptfooAssertionSchema,
]);

export const evalCaseDocumentSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    name: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    partition: z.enum(["development", "holdout"]).optional(),
    fixtures: z
      .array(
        z
          .object({
            source: safeRelativePath,
            destination: safeRelativePath.default("."),
          })
          .strict(),
      )
      .default([]),
    assertions: z.array(evalAssertionSchema).min(1),
  })
  .strict();

export type EvalCaseDocument = z.infer<typeof evalCaseDocumentSchema>;
