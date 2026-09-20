import { relative } from "node:path";

import type { InitResult } from "../../init";

export function renderInitialization(result: InitResult, cwd: string): string {
  const lines = [
    "Skillbench project initialized.",
    "",
    `Default runner: ${result.runner}`,
    `Runs directory: ${result.outputsDirectory}`,
  ];
  for (const [label, paths] of [
    ["Created", result.created],
    ["Updated", result.updated],
    ["Unchanged", result.unchanged],
  ] as const) {
    if (paths.length === 0) continue;
    lines.push("", `${label}:`, ...paths.map((path) => `  - ${relative(cwd, path)}`));
  }
  lines.push(
    "",
    "Next:",
    "  1. Edit .skillbench/evals/development/default.yaml; this is the active task used by default.",
    "     See .skillbench/evals/examples/example.yaml for a richer reference that is not run automatically.",
    "  2. Run: skillbench compare <skill-a> <skill-b>",
  );
  return `${lines.join("\n")}\n`;
}
