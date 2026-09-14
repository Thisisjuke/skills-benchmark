import * as z from "zod";

import { skillbenchCommandSchema } from "./commands";

export const SKILLBENCH_PROTOCOL_VERSION = 1 as const;

export const skillbenchProtocolErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
  exitCode: z.number().int(),
});

export type SkillbenchProtocolError = z.infer<typeof skillbenchProtocolErrorSchema>;

export const skillbenchResultEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(SKILLBENCH_PROTOCOL_VERSION),
  type: z.literal("result"),
  command: skillbenchCommandSchema,
  data: z.json(),
});

export const skillbenchErrorEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(SKILLBENCH_PROTOCOL_VERSION),
  type: z.literal("error"),
  command: skillbenchCommandSchema,
  error: skillbenchProtocolErrorSchema,
});

export const skillbenchEnvelopeSchema = z.discriminatedUnion("type", [
  skillbenchResultEnvelopeSchema,
  skillbenchErrorEnvelopeSchema,
]);

export type SkillbenchResultEnvelope = z.infer<typeof skillbenchResultEnvelopeSchema>;
export type SkillbenchErrorEnvelope = z.infer<typeof skillbenchErrorEnvelopeSchema>;
export type SkillbenchEnvelope = z.infer<typeof skillbenchEnvelopeSchema>;

const timestampSchema = z.string().datetime({ offset: true });
const jobIdSchema = z.string().min(1);

function eventSchema<const Event extends string, Schema extends z.ZodType>(
  event: Event,
  data: Schema,
) {
  return z.strictObject({
    schemaVersion: z.literal(SKILLBENCH_PROTOCOL_VERSION),
    event: z.literal(event),
    command: skillbenchCommandSchema,
    jobId: jobIdSchema,
    timestamp: timestampSchema,
    data,
  });
}

export const skillbenchStartedEventSchema = eventSchema("started", z.strictObject({}));
export const skillbenchPhaseEventSchema = eventSchema(
  "phase",
  z.strictObject({ name: z.string().min(1) }),
);
export const skillbenchProgressEventSchema = eventSchema(
  "progress",
  z
    .strictObject({
      message: z.string().min(1),
      current: z.number().nonnegative().optional(),
      total: z.number().positive().optional(),
    })
    .refine(
      ({ current, total }) => current === undefined || total === undefined || current <= total,
      { message: "Progress current cannot exceed total" },
    ),
);
export const skillbenchArtifactEventSchema = eventSchema(
  "artifact",
  z.strictObject({
    kind: z.enum(["bundle", "report", "skill", "workspace"]),
    path: z.string().min(1),
  }),
);
export const skillbenchCompletedEventSchema = eventSchema(
  "completed",
  z.strictObject({ result: z.json() }),
);
export const skillbenchFailedEventSchema = eventSchema(
  "failed",
  z.strictObject({ error: skillbenchProtocolErrorSchema }),
);
export const skillbenchCancelledEventSchema = eventSchema(
  "cancelled",
  z.strictObject({ reason: z.string().min(1).optional() }),
);

export const skillbenchEventSchema = z.discriminatedUnion("event", [
  skillbenchStartedEventSchema,
  skillbenchPhaseEventSchema,
  skillbenchProgressEventSchema,
  skillbenchArtifactEventSchema,
  skillbenchCompletedEventSchema,
  skillbenchFailedEventSchema,
  skillbenchCancelledEventSchema,
]);

export type SkillbenchEvent = z.infer<typeof skillbenchEventSchema>;

export function createSkillbenchResultEnvelope(
  command: z.infer<typeof skillbenchCommandSchema>,
  data: unknown,
): SkillbenchResultEnvelope {
  return skillbenchResultEnvelopeSchema.parse({
    schemaVersion: SKILLBENCH_PROTOCOL_VERSION,
    type: "result",
    command,
    data,
  });
}

export function createSkillbenchErrorEnvelope(
  command: z.infer<typeof skillbenchCommandSchema>,
  error: SkillbenchProtocolError,
): SkillbenchErrorEnvelope {
  return skillbenchErrorEnvelopeSchema.parse({
    schemaVersion: SKILLBENCH_PROTOCOL_VERSION,
    type: "error",
    command,
    error,
  });
}
