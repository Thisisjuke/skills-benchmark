import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ComparisonSummary } from "@skillbench/sdk/comparator";
import { SkillbenchError, toErrorMessage } from "@skillbench/sdk/errors";
import { skillbenchResultEnvelopeSchema } from "@skillbench/invocation-contract";
import { comparisonResultSchema } from "@skillbench/sdk/results";
import type { ResolvedSkill } from "@skillbench/sdk/skills";

const MAX_COMPARISON_BYTES = 100 * 1024 * 1024;

export type LoadedComparison = {
  summary: ComparisonSummary;
  fingerprintA: string;
  fingerprintB: string;
};

export function loadComparisonInput(
  input: string,
  cwd: string,
  skillA: ResolvedSkill,
  skillB: ResolvedSkill,
): LoadedComparison {
  try {
    const requested = resolve(cwd, input);
    const path = statSync(requested).isDirectory() ? join(requested, "result.json") : requested;
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_COMPARISON_BYTES) {
      throw new Error("comparison input is not a bounded regular file");
    }
    const envelope = skillbenchResultEnvelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (envelope.command !== "compare") throw new Error("result command is not compare");
    const data = comparisonResultSchema.parse(envelope.data);
    const fingerprintA = data.sources.A.fingerprint;
    const fingerprintB = data.sources.B.fingerprint;
    if (
      fingerprintA !== skillA.snapshot.fingerprint ||
      fingerprintB !== skillB.snapshot.fingerprint
    ) {
      throw new SkillbenchError(
        "Comparison input fingerprints do not match the resolved skill sources",
        { code: "CLI_COMPARISON_SOURCE_MISMATCH" },
      );
    }
    const summary = data as unknown as ComparisonSummary;
    return {
      summary: {
        ...summary,
        snapshotAId: skillA.snapshot.id,
        snapshotBId: skillB.snapshot.id,
        evaluationA: { ...summary.evaluationA, snapshotId: skillA.snapshot.id },
        evaluationB: { ...summary.evaluationB, snapshotId: skillB.snapshot.id },
      },
      fingerprintA,
      fingerprintB,
    };
  } catch (error) {
    if (error instanceof SkillbenchError) throw error;
    throw new SkillbenchError(`Cannot load comparison input: ${toErrorMessage(error)}`, {
      code: "CLI_COMPARISON_INVALID",
      cause: error,
    });
  }
}
