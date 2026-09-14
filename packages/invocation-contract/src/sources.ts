import * as z from "zod";

export const sourceProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u, "Invalid source provider identifier");

export type SourceProviderId = z.infer<typeof sourceProviderIdSchema>;
