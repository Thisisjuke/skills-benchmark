import type { Command } from "commander";

import { executeInspect } from "../../application";
import type { ExecutionCommandContext } from "../command-context";
import {
  getGlobalOptions,
  noOutputOption,
  sourceResolveOptions,
  validateOutputOptions,
} from "../options";
import { renderInspectResult } from "../renderers";
import { ensureInitializedProject } from "../ensure-project";
import {
  resolveRunOutput,
  withRunOutputReservation,
  type RunOutputOptions,
} from "../run-output";

export function registerInspectCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("inspect")
    .description("resolve and inspect a local or GitHub skill")
    .argument("[skill]", "skill directory, SKILL.md path or GitHub source")
    .option("--skill-path <path>", "repository-relative SKILL.md path for GitHub discovery")
    .option("-o, --output <directory>", "use this exact result bundle directory")
    .addOption(noOutputOption())
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        input: string | undefined,
        options: RunOutputOptions & { skillPath?: string; json?: boolean },
        command: Command,
      ) => {
        validateOutputOptions(options);
        const session = context.sessionFor(command, options.json === true);
        let project = context.loadProject(command);
        if (project.configFile === undefined && session.interactive) {
          project = await ensureInitializedProject(context, command, options.json === true);
        }
        const source = await session.requiredText(
          input,
          "skill",
          "Which skill should be inspected (path or GitHub URL)?",
        );
        const { config, layout } = project;
        const output = resolveRunOutput({
          command: "inspect",
          config,
          createId: context.application.createId,
          interactive: session.interactive,
          now: context.application.now,
          options,
          projectRoot: layout.root,
        });
        const operation = await withRunOutputReservation(
          output,
          output !== undefined && options.output === undefined,
          () =>
            executeInspect(context.application, {
              config,
              projectRoot: layout.root,
              source,
              resolveOptions: sourceResolveOptions(command, session, options.skillPath),
              events: session,
              ...(output === undefined ? {} : { output }),
              ...(options.force === undefined ? {} : { force: options.force }),
            }),
        );
        if (options.json === true || getGlobalOptions(command).jsonl === true) {
          context.writeJson("inspect", operation.result);
          return;
        }
        context.writeStdout(renderInspectResult({ source, operation }));
      },
    );
}
