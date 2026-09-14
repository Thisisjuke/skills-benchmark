import type { Command } from "commander";

import type { SkillbenchConfig } from "../config";
import type { ProjectLayout } from "../project";
import type { PromptSession } from "./interactive";
import type { CliJsonCommand } from "./json-output";
import type { ApplicationContext } from "../application";

export type ExecutionCommandContext = {
  cwd: () => string;
  environment: NodeJS.ProcessEnv;
  writeStdout: (value: string) => void;
  writeJson: (command: CliJsonCommand, data: unknown) => void;
  jsonl: (command: Command) => boolean;
  sessionFor: (command: Command, json: boolean) => PromptSession;
  loadProject: (command: Command) => {
    config: SkillbenchConfig;
    configFile?: string;
    layout: ProjectLayout;
  };
  application: ApplicationContext;
};
