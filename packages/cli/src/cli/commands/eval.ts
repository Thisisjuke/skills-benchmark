import type { Command } from "commander";

import { executeEval } from "../../application";
import type { EvalPartition } from "@skillbench/sdk/evaluator";
import { addConfiguredRunner } from "../../config";
import type { ExecutionCommandContext } from "../command-context";
import {
  getGlobalOptions,
  noOutputOption,
  nonEmptyString,
  partition,
  positiveInteger,
  sourceResolveOptions,
  validateOutputOptions,
} from "../options";
import { ensureInitializedProject } from "../ensure-project";
import { chooseEvalFile, validateEvalInput } from "../project-choices";
import { renderEvalResult } from "../renderers";
import {
  resolveRunOutput,
  withRunOutputReservation,
  type RunOutputOptions,
} from "../run-output";

export function registerEvalCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("eval")
    .description("evaluate a skill against a YAML eval suite")
    .argument("[skill]", "skill directory or GitHub source")
    .option("--skill-path <path>", "repository-relative SKILL.md path for GitHub discovery", nonEmptyString)
    .option("--evals <path>", "YAML scoring tasks and assertions file or directory", nonEmptyString)
    .option("--partition <partition>", "development or holdout", partition)
    .option("--repeat <count>", "override the configured repetition count", positiveInteger)
    .option("--keep-workspaces", "retain temporary workspaces for debugging")
    .option("-o, --output <directory>", "use this exact result bundle directory", nonEmptyString)
    .addOption(noOutputOption())
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        input: string | undefined,
        options: RunOutputOptions & {
          evals?: string;
          skillPath?: string;
          partition?: EvalPartition;
          repeat?: number;
          keepWorkspaces?: boolean;
          json?: boolean;
        },
        command: Command,
      ) => {
        validateOutputOptions(options);
        const session = context.sessionFor(command, options.json === true);
        const { config, configFile, layout, initializationChoice } = await ensureInitializedProject(
          context,
          command,
          options.json === true,
        );
        const global = getGlobalOptions(command);
        const runnerChoice =
          initializationChoice ??
          (await session.runnerChoice(
            config,
            global,
            configFile === undefined
              ? {}
              : {
                  onRunnerAdded: (runner) => addConfiguredRunner(configFile, runner),
                },
          ));
        const source = await session.requiredText(
          input,
          "skill",
          "Which skill should be evaluated (path or GitHub URL)?",
        );
        const evals = await chooseEvalFile({
          supplied: options.evals,
          configuredPath: config.eval.path,
          partition: options.partition ?? "development",
          projectRoot: layout.root,
          session,
        });
        validateEvalInput({
          path: evals,
          partition: options.partition ?? "development",
          projectRoot: layout.root,
        });
        const repeat = await session.count(
          options.repeat,
          "How many repetitions? 1 is fastest; 2-3 reduce variance; 10 costs about 10× per case and skill.",
          config.eval.repeat,
        );
        const output = resolveRunOutput({
          command: "eval",
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
            executeEval(context.application, {
              config,
              projectRoot: layout.root,
              selectRunner: async () => runnerChoice,
              source,
              resolveOptions: sourceResolveOptions(command, session, options.skillPath),
              evals,
              events: session,
              ...(options.partition === undefined ? {} : { partition: options.partition }),
              repeat,
              ...(options.keepWorkspaces === undefined
                ? {}
                : { keepWorkspaces: options.keepWorkspaces }),
              ...(output === undefined ? {} : { output }),
              ...(options.force === undefined ? {} : { force: options.force }),
            }),
        );
        if (options.json === true || context.jsonl(command)) {
          context.writeJson("eval", operation.result);
          return;
        }
        context.writeStdout(renderEvalResult({ source, evals, operation }));
      },
    );
}
