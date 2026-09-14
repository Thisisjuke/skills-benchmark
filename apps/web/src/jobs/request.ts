import {
  skillbenchAutomationRequestSchema,
  type SkillbenchAutomationRequest,
} from "@thisisjuke/skillbench/contracts";

export const webJobRequestSchema = skillbenchAutomationRequestSchema;
export type WebJobRequest = SkillbenchAutomationRequest;

export function buildCliArguments(request: WebJobRequest, output: string): string[] {
  const global = ["--no-input", "--no-history", "--jsonl", "--yes"];
  if (request.config !== undefined) global.push("--config", request.config);
  if (request.debug === true) global.push("--debug");
  if (request.offline === true) global.push("--offline");
  if (request.command !== "inspect") {
    global.push("--runner", request.profile.runner);
    if (request.profile.runner !== "mock") {
      global.push("--model", request.profile.model);
      global.push("--reasoning-effort", request.profile.reasoningEffort);
    }
  }

  switch (request.command) {
    case "inspect":
      return [
        ...global,
        "inspect",
        request.source,
        ...(request.skillPath === undefined ? [] : ["--skill-path", request.skillPath]),
        "--output",
        output,
      ];
    case "eval":
      return [
        ...global,
        "eval",
        request.source,
        "--evals",
        request.evals,
        ...(request.partition === undefined ? [] : ["--partition", request.partition]),
        ...(request.repeat === undefined ? [] : ["--repeat", String(request.repeat)]),
        ...(request.skillPath === undefined ? [] : ["--skill-path", request.skillPath]),
        "--output",
        output,
      ];
    case "compare":
      return [
        ...global,
        "compare",
        request.sourceA,
        request.sourceB,
        "--evals",
        request.evals,
        ...(request.partition === undefined ? [] : ["--partition", request.partition]),
        ...(request.repeat === undefined ? [] : ["--repeat", String(request.repeat)]),
        ...(request.skillPathA === undefined ? [] : ["--skill-path-a", request.skillPathA]),
        ...(request.skillPathB === undefined ? [] : ["--skill-path-b", request.skillPathB]),
        "--output",
        output,
      ];
    case "merge":
      return [
        ...global,
        "merge",
        request.sourceA,
        request.sourceB,
        "--evals",
        request.evals,
        ...(request.holdout === undefined ? [] : ["--holdout", request.holdout]),
        ...(request.comparison === undefined ? [] : ["--comparison", request.comparison]),
        ...(request.repeat === undefined ? [] : ["--repeat", String(request.repeat)]),
        ...(request.skillPathA === undefined ? [] : ["--skill-path-a", request.skillPathA]),
        ...(request.skillPathB === undefined ? [] : ["--skill-path-b", request.skillPathB]),
        "--output",
        output,
      ];
  }
}
