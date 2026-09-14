import * as z from "zod";

export const SKILLBENCH_COMMAND = Object.freeze({
  init: "init",
  history: "history",
  doctor: "doctor",
  inspect: "inspect",
  eval: "eval",
  compare: "compare",
  merge: "merge",
} as const);

export const SKILLBENCH_CLI_COMMANDS = Object.freeze([
  SKILLBENCH_COMMAND.init,
  SKILLBENCH_COMMAND.doctor,
  SKILLBENCH_COMMAND.history,
  SKILLBENCH_COMMAND.inspect,
  SKILLBENCH_COMMAND.eval,
  SKILLBENCH_COMMAND.compare,
  SKILLBENCH_COMMAND.merge,
] as const);

export const SKILLBENCH_OPERATIONS = Object.freeze([
  SKILLBENCH_COMMAND.inspect,
  SKILLBENCH_COMMAND.eval,
  SKILLBENCH_COMMAND.compare,
  SKILLBENCH_COMMAND.merge,
] as const);

export const skillbenchCliCommandSchema = z.enum(SKILLBENCH_CLI_COMMANDS);
export const skillbenchOperationSchema = z.enum(SKILLBENCH_OPERATIONS);
export const skillbenchCommandSchema = z.enum(["cli", ...SKILLBENCH_CLI_COMMANDS]);

export type SkillbenchCliCommand = z.infer<typeof skillbenchCliCommandSchema>;
export type SkillbenchOperation = z.infer<typeof skillbenchOperationSchema>;
export type SkillbenchCommand = z.infer<typeof skillbenchCommandSchema>;
