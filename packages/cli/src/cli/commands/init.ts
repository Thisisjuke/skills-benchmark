import type { Command } from "commander";
import type { ExecutionCommandContext } from "../command-context";
import { initializeProjectFlow } from "../initialize-project";
import { getGlobalOptions, validateOutputMode } from "../options";
import { renderInitialization } from "../renderers";

export function registerInitCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("init")
    .description("create a portable Skillbench project in the current directory")
    .option("--force", "replace only the generated starter files")
    .option("--json", "write structured JSON")
    .action(async (options: { force?: boolean; json?: boolean }, command: Command) => {
      const global = getGlobalOptions(command);
      validateOutputMode(options.json === true, global.jsonl === true);
      const session = context.sessionFor(command, options.json === true);
      const result = await initializeProjectFlow({
        context,
        session,
        global,
        force: options.force === true,
      });
      if (options.json === true || global.jsonl === true) {
        context.writeJson("init", result);
        return;
      }
      context.writeStdout(renderInitialization(result, context.cwd()));
    });
}
