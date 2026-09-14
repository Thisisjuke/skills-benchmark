import type { SkillbenchAutomationRequest } from "@thisisjuke/skillbench/contracts";

export const AUTOMATION_REQUEST_FIXTURES = Object.freeze([
  {
    name: "inspect-local",
    request: { command: "inspect", source: "./skills/local" },
  },
  {
    name: "eval-mock",
    request: {
      command: "eval",
      source: "./skills/local",
      evals: "./evals/development",
      profile: { runner: "mock" },
    },
  },
  {
    name: "compare-codex",
    request: {
      command: "compare",
      sourceA: "./skills/local",
      sourceB: "https://github.com/acme/skills/tree/main/remote",
      evals: "./evals/development",
      profile: { runner: "codex", model: "gpt-test", reasoningEffort: "low" },
    },
  },
  {
    name: "merge-claude",
    request: {
      command: "merge",
      sourceA: "./skills/a",
      sourceB: "./skills/b",
      evals: "./evals/development",
      profile: {
        runner: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "max",
      },
    },
  },
] satisfies ReadonlyArray<{ name: string; request: SkillbenchAutomationRequest }>);
