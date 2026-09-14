import { describe, expect, it } from "vite-plus/test";

import { verifyAssertionHandlerContract } from "@skillbench/test-contracts";

describe("adapter contracts", () => {
  it("rejects a handler result outside the common score contract", async () => {
    await expect(
      verifyAssertionHandlerContract({
        type: "promptfoo",
        assertion: { type: "promptfoo", assertion: { type: "contains", value: "ok" } },
        context: {
          workspacePath: process.cwd(),
          prompt: "contract",
          runnerResult: {
            status: "completed",
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 0,
            artifacts: [],
          },
          defaultCommandTimeoutMs: 1_000,
        },
        handler: async () => ({
          type: "promptfoo",
          status: "passed",
          passed: true,
          score: 2,
          message: "invalid",
          evidence: {},
          durationMs: 0,
        }),
      }),
    ).rejects.toThrow();
  });
});
