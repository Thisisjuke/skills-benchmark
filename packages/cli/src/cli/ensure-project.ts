import type { Command } from "commander";

import { SkillbenchError } from "@skillbench/sdk/errors";

import { loadProjectRuntimeAssets } from "../assets";
import { selectionForConfiguredRunner, type RunnerSelection } from "../config";
import type { ExecutionCommandContext } from "./command-context";
import { initializeProjectFlow } from "./initialize-project";
import { getGlobalOptions } from "./options";
type EnsuredProject = ReturnType<ExecutionCommandContext["loadProject"]> & {
  initializationChoice?: RunnerSelection;
};

export async function ensureInitializedProject(
  context: ExecutionCommandContext,
  command: Command,
  json: boolean,
): Promise<EnsuredProject> {
  let project = context.loadProject(command);
  let initializationChoice: RunnerSelection | undefined;
  if (project.configFile === undefined) {
    const session = context.sessionFor(command, json);
    if (!session.interactive) {
      throw new SkillbenchError(
        `Project is not initialized at ${project.layout.root}. Run: skillbench init --no-input`,
        { code: "CLI_PROJECT_REQUIRED" },
      );
    }
    await initializeProjectFlow({
      context,
      session,
      global: getGlobalOptions(command),
      force: false,
    });
    project = context.loadProject(command);
    initializationChoice = selectionForConfiguredRunner(project.config.runners[0]!);
  }
  loadProjectRuntimeAssets(project.layout.root);
  return {
    ...project,
    ...(initializationChoice === undefined ? {} : { initializationChoice }),
  };
}
