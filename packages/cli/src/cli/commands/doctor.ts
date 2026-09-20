import type { Command } from "commander";

import { executeDoctor } from "../../application";
import { runnerDefinition } from "../../composition/runner-registry";
import type { ExecutionCommandContext } from "../command-context";
import { getGlobalOptions, validateOutputMode } from "../options";
import { renderDoctor } from "../renderers";

export function registerDoctorCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("doctor")
    .description("inspect the local Skillbench environment without running a model")
    .option("--json", "write structured JSON")
    .action(async (options: { json?: boolean }, command: Command) => {
      const global = getGlobalOptions(command);
      validateOutputMode(options.json === true, global.jsonl === true);
      const project = context.loadProject(command);
      const defaultRunner = project.config.runners[0];
      const runner =
        global.runner ??
        (project.configFile === undefined ? undefined : defaultRunner?.type);
      const executable =
        runner === undefined
          ? undefined
          : runner === defaultRunner?.type
            ? defaultRunner.executable
            : runnerDefinition(runner).defaultExecutable;
      const result = await executeDoctor({
        projectRoot: project.layout.root,
        ...(project.configFile === undefined ? {} : { configFile: project.configFile }),
        stateDirectory: project.layout.state,
        temporaryDirectory: project.layout.temporary,
        promptfooDirectory: project.layout.promptfoo.root,
        ...(runner === undefined ? {} : { runner }),
        ...(executable === undefined ? {} : { executable }),
        environment: context.environment,
      });
      if (options.json === true || global.jsonl === true) {
        context.writeJson("doctor", result);
        return;
      }
      context.writeStdout(renderDoctor(result));
    });
}
