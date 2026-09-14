import type { Command } from "commander";

import { executeInspect } from "../../application";
import type { ExecutionCommandContext } from "../command-context";
import { getGlobalOptions, sourceResolveOptions, validateOutputOptions } from "../options";
import { renderInspectResult } from "../renderers";

export function registerInspectCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("inspect")
    .description("resolve and inspect a local or GitHub skill")
    .argument("[skill]", "skill directory, SKILL.md path or GitHub source")
    .option("--skill-path <path>", "repository-relative SKILL.md path for GitHub discovery")
    .option("-o, --output <directory>", "write a portable result bundle")
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        input: string | undefined,
        options: { skillPath?: string; output?: string; force?: boolean; json?: boolean },
        command: Command,
      ) => {
        validateOutputOptions(options);
        const session = context.sessionFor(command, options.json === true);
        const source = await session.requiredText(
          input,
          "skill",
          "Which skill should be inspected (path or GitHub URL)?",
        );
        const { config, layout } = context.loadProject(command);
        const operation = await executeInspect(context.application, {
          config,
          projectRoot: layout.root,
          source,
          resolveOptions: sourceResolveOptions(command, session, options.skillPath),
          events: session,
          ...(options.output === undefined ? {} : { output: options.output }),
          ...(options.force === undefined ? {} : { force: options.force }),
        });
        if (options.json === true || getGlobalOptions(command).jsonl === true) {
          context.writeJson("inspect", operation.result);
          return;
        }
        context.writeStdout(renderInspectResult({ source, operation }));
      },
    );
}
