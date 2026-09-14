import type { ExecutionProfile, RunResult } from "../runners";

export type EvalPartition = "development" | "holdout";

export type EvalFixture = {
  sourcePath: string;
  destinationPath: string;
};

export type FileExistsAssertion = {
  type: "file-exists";
  value: string;
};

export type ContainsAssertion = {
  type: "contains";
  path: string;
  value: string;
};

export type RegexAssertion = {
  type: "regex";
  path: string;
  pattern: string;
  flags?: string | undefined;
};

export type CommandAssertion = {
  type: "command";
  command: string | string[];
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
  expectedExitCode: number;
};

export type ExitCodeAssertion = {
  type: "exit-code";
  value: number;
};

export type LlmRubricAssertion = {
  type: "llm-rubric";
  rubric: string;
};

export type PromptfooAssertionDefinition = {
  type:
    | "equals"
    | "not-equals"
    | "contains"
    | "not-contains"
    | "icontains"
    | "not-icontains"
    | "contains-all"
    | "contains-any"
    | "starts-with"
    | "regex"
    | "not-regex"
    | "is-json"
    | "contains-json"
    | "is-xml"
    | "contains-xml"
    | "is-html"
    | "contains-html"
    | "is-sql"
    | "contains-sql"
    | "word-count"
    | "levenshtein";
  value?: string | string[] | number | Record<string, unknown> | undefined;
  threshold?: number | undefined;
  weight?: number | undefined;
  metric?: string | undefined;
};

export type PromptfooAssertion = {
  type: "promptfoo";
  assertion: PromptfooAssertionDefinition;
};

export type EvalAssertion =
  | FileExistsAssertion
  | ContainsAssertion
  | RegexAssertion
  | CommandAssertion
  | ExitCodeAssertion
  | LlmRubricAssertion
  | PromptfooAssertion;

export type EvalCase = {
  id: string;
  name: string;
  prompt: string;
  partition: EvalPartition;
  fixtures: EvalFixture[];
  assertions: EvalAssertion[];
  sourcePath: string;
  contentHash: string;
};

export type EvalSuite = {
  id: string;
  partition: EvalPartition;
  rootPath: string;
  cases: EvalCase[];
};

export type AssertionStatus = "passed" | "failed" | "not-evaluated" | "error";

export type AssertionResult = {
  type: EvalAssertion["type"];
  status: AssertionStatus;
  passed: boolean | null;
  score: number | null;
  message: string;
  evidence: Record<string, unknown>;
  durationMs: number;
};

export type EvalAttempt = {
  id: string;
  evalCaseId: string;
  repetition: number;
  status: "completed" | "failed" | "timed-out";
  passed: boolean;
  score: number;
  durationMs: number;
  runnerResult: RunResult;
  assertions: AssertionResult[];
};

export type EvalCaseSummary = {
  evalCaseId: string;
  attempts: number;
  completedAttempts: number;
  passRate: number;
  meanScore: number;
  medianScore: number;
  scoreVariance: number;
  meanDurationMs: number;
  tokens?: {
    input: number;
    output: number;
  };
};

export type EvaluationSummary = {
  runId: string;
  snapshotId: string;
  suiteId: string;
  partition: EvalPartition;
  runnerType: ExecutionProfile["runner"];
  executionProfile: ExecutionProfile;
  repeat: number;
  status: "completed" | "failed";
  passRate: number;
  meanScore: number;
  cases: EvalCaseSummary[];
  attempts: EvalAttempt[];
  workspaceRoot?: string | undefined;
  createdAt: string;
  finishedAt: string;
};
