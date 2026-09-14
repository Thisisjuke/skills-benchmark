import assert from "node:assert/strict";

import {
  AssertionEvaluator,
  type AssertionContext,
  type AssertionHandler,
} from "@skillbench/sdk/assertions";
import type { EvalAssertion } from "@skillbench/sdk/evaluator";

export type AssertionHandlerContract<Type extends EvalAssertion["type"]> = {
  type: Type;
  handler: AssertionHandler<Type>;
  assertion: Extract<EvalAssertion, { type: Type }>;
  context: AssertionContext;
};

export async function verifyAssertionHandlerContract<Type extends EvalAssertion["type"]>(
  contract: AssertionHandlerContract<Type>,
): Promise<void> {
  const evaluator = new AssertionEvaluator({ handlers: { [contract.type]: contract.handler } });
  const result = await evaluator.evaluate(contract.assertion, contract.context);
  assert.equal(result.type, contract.type);
  assert.ok(["passed", "failed", "error"].includes(result.status));
  assert.equal(result.passed, result.status === "passed");
  if (result.score !== null) assert.ok(result.score >= 0 && result.score <= 1);
  assert.ok(result.durationMs >= 0);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(result))), JSON.stringify(result));
}
