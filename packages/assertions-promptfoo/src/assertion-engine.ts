import type { Assertion, GradingResult } from "promptfoo";

import type { AssertionContext } from "@skillbench/sdk/assertions";
import type { AssertionResult, PromptfooAssertion } from "@skillbench/sdk/evaluator";
import { silentLogger, type Logger } from "@skillbench/sdk/logging";
import packageJson from "../package.json" with { type: "json" };

export const PROMPTFOO_VERSION = packageJson.dependencies.promptfoo;

export type PromptfooRunAssertion = (input: {
  prompt?: string;
  assertion: Assertion;
  test: { vars: Record<string, never>; assert: Assertion[] };
  providerResponse: {
    output: string;
    tokenUsage?: { prompt: number; completion: number; total: number };
  };
  latencyMs?: number;
}) => Promise<GradingResult>;

export class PromptfooAssertionEngine {
  constructor(
    private readonly runAssertion: PromptfooRunAssertion = defaultRunAssertion,
    private readonly logger: Logger = silentLogger,
  ) {}

  async evaluate(
    assertion: PromptfooAssertion,
    context: AssertionContext,
  ): Promise<AssertionResult> {
    const startedAt = performance.now();
    const definition = assertion.assertion as Assertion;
    this.logger.debug("promptfoo.assertion.start", {
      assertionType: assertion.assertion.type,
      engineVersion: PROMPTFOO_VERSION,
    });
    try {
      const tokens = context.runnerResult.tokens;
      const grade = await this.runAssertion({
        prompt: context.prompt,
        assertion: definition,
        test: { vars: {}, assert: [definition] },
        providerResponse: {
          output: context.runnerResult.stdout,
          ...(tokens === undefined
            ? {}
            : {
                tokenUsage: {
                  prompt: tokens.input,
                  completion: tokens.output,
                  total: tokens.input + tokens.output,
                },
              }),
        },
        latencyMs: context.runnerResult.durationMs,
      });
      const passed = grade.pass === true;
      const score =
        typeof grade.score === "number" && Number.isFinite(grade.score)
          ? Math.max(0, Math.min(1, grade.score))
          : passed
            ? 1
            : 0;
      const result: AssertionResult = {
        type: "promptfoo",
        status: passed ? "passed" : "failed",
        passed,
        score,
        message:
          grade.reason ?? (passed ? "Promptfoo assertion passed" : "Promptfoo assertion failed"),
        evidence: {
          engine: "promptfoo",
          version: PROMPTFOO_VERSION,
          assertionType: assertion.assertion.type,
          ...(assertion.assertion.metric === undefined
            ? {}
            : { metric: assertion.assertion.metric }),
        },
        durationMs: performance.now() - startedAt,
      };
      this.logger.debug("promptfoo.assertion.complete", {
        assertionType: assertion.assertion.type,
        status: result.status,
        durationMs: Math.round(result.durationMs),
      });
      return result;
    } catch (error) {
      const result: AssertionResult = {
        type: "promptfoo",
        status: "error",
        passed: false,
        score: 0,
        message: error instanceof Error ? error.message : String(error),
        evidence: {
          engine: "promptfoo",
          version: PROMPTFOO_VERSION,
          assertionType: assertion.assertion.type,
        },
        durationMs: performance.now() - startedAt,
      };
      this.logger.debug("promptfoo.assertion.complete", {
        assertionType: assertion.assertion.type,
        status: result.status,
        durationMs: Math.round(result.durationMs),
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return result;
    }
  }
}

async function defaultRunAssertion(
  input: Parameters<PromptfooRunAssertion>[0],
): Promise<GradingResult> {
  const { assertions } = await import("promptfoo");
  return assertions.runAssertion(input);
}
