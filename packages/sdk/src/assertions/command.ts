import { SkillbenchError } from "../errors";

export function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const character of command) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaping || quote !== undefined) {
    throw new SkillbenchError(`Command contains an unfinished escape or quote: ${command}`, {
      code: "ASSERTION_COMMAND_INVALID",
    });
  }
  if (current !== "") args.push(current);
  if (args.length === 0) {
    throw new SkillbenchError("Command cannot be empty", { code: "ASSERTION_COMMAND_INVALID" });
  }
  return args;
}
