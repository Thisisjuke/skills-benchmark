// Registered by the CLI protocol scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { renderCliError, renderDebugError } from "../src/cli/error-renderer";
import { SkillbenchError } from "@skillbench/sdk/errors";
import { createDebugLogger, runtimeRedactions } from "@skillbench/sdk/logging";

const GITHUB_TOKEN = "github-token-sentinel";
const OPENAI_TOKEN = "openai-token-sentinel";
const ANTHROPIC_TOKEN = "anthropic-token-sentinel";
const AWS_SECRET = "aws-secret-sentinel";
const PROMPT = "prompt-sentinel";
const HOLDOUT = "holdout-sentinel";

describe("debug diagnostics", () => {
  it("is silent by default and emits bounded, sanitized records only when enabled", () => {
    const quiet: string[] = [];
    createDebugLogger({ enabled: false, write: (value) => quiet.push(value) }).debug("test", {
      safe: true,
    });
    expect(quiet).toEqual([]);

    const output: string[] = [];
    const logger = createDebugLogger({
      enabled: true,
      write: (value) => output.push(value),
      redactions: [GITHUB_TOKEN, OPENAI_TOKEN],
    });
    logger.debug("boundary.failed", {
      authorization: GITHUB_TOKEN,
      apiToken: OPENAI_TOKEN,
      prompt: PROMPT,
      holdoutContent: HOLDOUT,
      environment: { SAFE: "no", OPENAI_API_KEY: OPENAI_TOKEN },
      safe: `before-${GITHUB_TOKEN}-after`,
      long: "x".repeat(1_000),
    });

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("[debug]");
    expect(output[0]).toContain("[redacted]");
    expect(output[0]).toContain("[truncated]");
    for (const secret of [GITHUB_TOKEN, OPENAI_TOKEN, PROMPT, HOLDOUT]) {
      expect(output[0]).not.toContain(secret);
    }
  });

  it("discovers secrets forwarded to every runner provider", () => {
    expect(
      runtimeRedactions({
        OPENAI_API_KEY: OPENAI_TOKEN,
        ANTHROPIC_API_KEY: ANTHROPIC_TOKEN,
        AWS_SECRET_ACCESS_KEY: AWS_SECRET,
        SAFE_VALUE: "visible",
      }),
    ).toEqual([OPENAI_TOKEN, ANTHROPIC_TOKEN, AWS_SECRET]);
  });

  it("shows nested stacktraces only in the debug rendering and redacts causes", () => {
    const underlying = new Error(`network failed with ${OPENAI_TOKEN}`);
    const error = new SkillbenchError("GitHub resolution failed", {
      code: "GITHUB_NETWORK_ERROR",
      cause: underlying,
    });

    const concise = renderCliError(error);
    expect(concise).toBe("skillbench: GitHub resolution failed [GITHUB_NETWORK_ERROR]\n");
    expect(concise).not.toContain("Cause 0");
    expect(concise).not.toContain("at ");

    const debug = renderDebugError(error, {
      phase: "inspect",
      redactions: [OPENAI_TOKEN],
    });
    expect(debug).toContain('"phase":"inspect"');
    expect(debug).toContain("Cause 0");
    expect(debug).toContain("Cause 1");
    expect(debug).toContain("[redacted]");
    expect(debug).not.toContain(OPENAI_TOKEN);

    expect(renderCliError(underlying, { redactions: [OPENAI_TOKEN] })).not.toContain(OPENAI_TOKEN);
  });
});
