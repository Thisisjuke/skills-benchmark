import type { ComparisonJudge } from "@skillbench/sdk/comparator";
import type { EvalSuite } from "@skillbench/sdk/evaluator";
import type { ExecutionProfile, RunInput, Runner } from "@skillbench/sdk/runners";

import type { OperationEvents } from "./context";

export function runnerWithProgress(input: {
  runner: Runner;
  events: OperationEvents;
  executionProfile: ExecutionProfile;
  suite: EvalSuite;
  totalRuns: number;
  snapshotLabels?: ReadonlyMap<string, string>;
}): Runner {
  const caseNames = new Map(input.suite.cases.map((evalCase) => [evalCase.id, evalCase.name]));
  let current = 0;
  return {
    run: async (runInput) => {
      current += 1;
      const description = runDescription(runInput, caseNames, input.snapshotLabels);
      input.events.status(
        `Sending ${description} to ${runnerName(input.executionProfile)}…`,
        current,
        input.totalRuns,
      );
      try {
        const result = await input.runner.run(runInput);
        input.events.status(
          `Checking results for ${description}…`,
          current,
          input.totalRuns,
        );
        return result;
      } catch (error) {
        input.events.status(
          `Runner failed for ${description}.`,
          current,
          input.totalRuns,
        );
        throw error;
      }
    },
  };
}

export function judgeWithProgress(input: {
  judge: ComparisonJudge;
  events: OperationEvents;
  totalJudgments: number;
}): ComparisonJudge {
  let current = 0;
  return {
    compare: async (judgeInput) => {
      current += 1;
      input.events.status(
        "Running qualitative judgment in both candidate orders…",
        current,
        input.totalJudgments,
      );
      const result = await input.judge.compare(judgeInput);
      input.events.status(
        "Qualitative judgment completed.",
        current,
        input.totalJudgments,
      );
      return result;
    },
  };
}

export function evaluationRunCount(suite: EvalSuite, repeat: number, skillCount = 1): number {
  return suite.cases.length * repeat * skillCount;
}

export function qualitativeJudgmentCount(suite: EvalSuite): number {
  return suite.cases.reduce(
    (total, evalCase) =>
      total + evalCase.assertions.filter((assertion) => assertion.type === "llm-rubric").length,
    0,
  );
}

function runDescription(
  input: RunInput,
  caseNames: ReadonlyMap<string, string>,
  snapshotLabels: ReadonlyMap<string, string> | undefined,
): string {
  const skill = snapshotLabels?.get(input.snapshot.id) ?? inferredSnapshotLabel(input);
  const evalCase = caseNames.get(input.evalCaseId) ?? input.evalCaseId;
  return `${skill}, “${evalCase}”, iteration ${input.repetition}`;
}

function inferredSnapshotLabel(input: RunInput): string {
  const mergePrefix = "skillbench:merge/";
  if (input.snapshot.origin.originalInput.startsWith(mergePrefix)) {
    return `merge candidate ${input.snapshot.origin.originalInput.split("/").at(-1) ?? input.snapshot.id}`;
  }
  return "skill";
}

function runnerName(profile: ExecutionProfile): string {
  return `${profile.runner.charAt(0).toUpperCase()}${profile.runner.slice(1)}`;
}
