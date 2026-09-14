import type * as z from "zod";
import type { SkillbenchOperation } from "@skillbench/invocation-contract";

import { inspectResultSchema } from "../inspect";
import { comparisonResultSchema } from "./comparison";
import { evaluationResultSchema } from "./evaluation";
import { mergeResultSchema } from "./merge";

export const skillbenchOperationResultSchemas = Object.freeze({
  inspect: inspectResultSchema,
  eval: evaluationResultSchema,
  compare: comparisonResultSchema,
  merge: mergeResultSchema,
} satisfies Record<SkillbenchOperation, z.ZodType>);

export type SkillbenchOperationResultCommand = keyof typeof skillbenchOperationResultSchemas;

export function parseSkillbenchOperationResult(
  command: SkillbenchOperationResultCommand,
  data: unknown,
): z.infer<(typeof skillbenchOperationResultSchemas)[SkillbenchOperationResultCommand]> {
  return skillbenchOperationResultSchemas[command].parse(data);
}
