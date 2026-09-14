import type { Command } from "commander";

import { SkillbenchError } from "@skillbench/sdk/errors";

import { loadProjectRuntimeAssets } from "../assets";
import type { ExecutionCommandContext } from "./command-context";
import { initializeProjectFlow } from "./initialize-project";
import { getGlobalOptions } from "./options";
import type { RunnerChoice } from "./interactive";

type EnsuredProject = ReturnType<ExecutionCommandContext["loadProject"]> & {
  initializationChoice?: RunnerChoice;
};

export async function ensureInitializedProject(
  context: ExecutionCommandContext,
  command: Command,
  json: boolean,
): Promise<EnsuredProject> {
  let project = context.loadProject(command);
  let initializationChoice: RunnerChoice | undefined;
  if (project.configFile === undefined) {
    const session = context.sessionFor(command, json);
    if (!session.interactive) {
      throw new SkillbenchError(
        `Project is not initialized at ${project.layout.root}. Run: skillbench init --no-input`,
        { code: "CLI_PROJECT_REQUIRED" },
      );
    }
    const initialized = await initializeProjectFlow({
      context,
      session,
      global: getGlobalOptions(command),
      force: false,
    });
    initializationChoice = initialized.profile;
    project = context.loadProject(command);
  }
  loadProjectRuntimeAssets(project.layout.root);
  return {
    ...project,
    ...(initializationChoice === undefined ? {} : { initializationChoice }),
  };
}
