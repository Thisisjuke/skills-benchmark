import assert from "node:assert/strict";
import { isAbsolute } from "node:path";

import {
  executionProfileSchema,
  type ExecutionProfile,
  type RunInput,
  type Runner,
} from "@skillbench/sdk/runners";

export type RunnerContract = {
  runner: Runner;
  runnerName: string;
  executionProfile: ExecutionProfile;
  mismatchedProfile: ExecutionProfile;
  createInput: (profile: ExecutionProfile) => Promise<RunInput>;
};

export async function verifyRunnerContract(contract: RunnerContract): Promise<void> {
  const profile = executionProfileSchema.parse(contract.executionProfile);
  assert.equal(profile.runner, contract.runnerName);

  const result = await contract.runner.run(await contract.createInput(profile));
  assert.ok(["completed", "failed", "timed-out"].includes(result.status));
  assert.ok(result.durationMs >= 0);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(result))), JSON.stringify(result));
  for (const artifact of result.artifacts) {
    assert.equal(isAbsolute(artifact.relativePath), false);
    assert.equal(artifact.relativePath.split("/").includes(".."), false);
    assert.ok(artifact.sizeBytes >= 0);
    assert.match(artifact.contentHash, /^[a-f0-9]{64}$/u);
  }

  await assert.rejects(
    async () => contract.runner.run(await contract.createInput(contract.mismatchedProfile)),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as Error & { code?: string }).code === "RUNNER_PROFILE_MISMATCH",
  );
}
