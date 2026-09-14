import * as z from "zod";

export const timestampSchema = z.string().datetime({ offset: true });
export const identifierSchema = z.string().min(1);
export const jsonRecordSchema = z.record(z.string(), z.json());
export const scoreSchema = z.number().min(0).max(1);
export const instructionAssetReferenceSchema = z.strictObject({
  id: identifierSchema,
  path: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  sizeBytes: z.number().int().nonnegative(),
});

export type InstructionAssetReference = z.infer<typeof instructionAssetReferenceSchema>;
