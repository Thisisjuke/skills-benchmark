import type { Command } from "commander";

import { executeEval } from "../../application";
import type { EvalPartition } from "@skillbench/sdk/evaluator";
import type { ExecutionCommandContext } from "../command-context";
import {
  getGlobalOptions,
  partition,
  positiveInteger,
  sourceResolveOptions,
  validateOutputOptions,
} from "../options";
import { ensureInitializedProject } from "../ensure-project";
import { renderEvalResult } from "../renderers";

export function registerEvalCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("eval")
    .description("evaluate a skill against a YAML eval suite")
    .argument("[skill]", "skill directory or GitHub source")
    .option("--skill-path <path>", "repository-relative SKILL.md path for GitHub discovery")
    .option("--evals <path>", "eval YAML file or directory")
    .option("--partition <partition>", "development or holdout", partition)
    .option("--repeat <count>", "override the configured repetition count", positiveInteger)
    .option("--keep-workspaces", "retain temporary workspaces for debugging")
    .option("-o, --output <directory>", "write a portable result bundle")
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        input: string | undefined,
        options: {
          evals?: string;
          skillPath?: string;
          partition?: EvalPartition;
          repeat?: number;
          keepWorkspaces?: boolean;
          output?: string;
          force?: boolean;
          json?: boolean;
        },
        command: Command,
      ) => {
        const session = context.sessionFor(command, options.json === true);
        const { config, layout, initializationChoice } = await ensureInitializedProject(
          context,
          command,
          options.json === true,
        );
        const global = getGlobalOptions(command);
        const runnerChoice = initializationChoice ?? (await session.runnerChoice(config, global));
        const source = await session.requiredText(
          input,
          "skill",
          "Which skill should be evaluated (path or GitHub URL)?",
        );
        const evals = await session.value(
          options.evals,
          "Which evaluation file or directory should be used?",
          "evals/development",
        );
        const repeat = await session.count(options.repeat, "How many repetitions?", config.eval.repeat);
        const output = await session.output(options.output, "results/evaluation.skillbench");
        validateOutputOptions({
          ...(output === undefined ? {} : { output }),
          ...(options.force === undefined ? {} : { force: options.force }),
        });
        const operation = await executeEval(context.application, {
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
        });
        if (options.json === true || context.jsonl(command)) {
          context.writeJson("eval", operation.result);
          return;
        }
        context.writeStdout(renderEvalResult({ source, evals, operation }));
      },
    );
}
