import * as z from "zod";

import { sourceProviderIdSchema } from "../skills";

export const RUNNER_TRACE_VERSION = 1 as const;

export const runnerTraceSchema = z
  .object({
    schemaVersion: z.literal(RUNNER_TRACE_VERSION),
    provider: sourceProviderIdSchema,
    protocol: z.string().trim().min(1),
    command: z.array(z.string()).optional(),
  })
  .catchall(z.json());

export type RunnerTrace = z.infer<typeof runnerTraceSchema>;
