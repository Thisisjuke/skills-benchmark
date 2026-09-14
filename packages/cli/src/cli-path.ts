import { fileURLToPath } from "node:url";

/** Resolve the executable shipped by the installed Skillbench package. */
export function resolveSkillbenchCliPath(): string {
  return fileURLToPath(new URL("./cli.mjs", import.meta.url));
}
