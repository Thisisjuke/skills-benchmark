import type { Command } from "commander";

import { executeMerge } from "../../application";
import type { ExecutionCommandContext } from "../command-context";
import {
  getGlobalOptions,
  positiveInteger,
  sourceResolveOptions,
  validateOutputOptions,
} from "../options";
import { ensureInitializedProject } from "../ensure-project";
import { renderMergeResult } from "../renderers";

export function registerMergeCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("merge")
    .description("generate three candidates from a development comparison")
    .argument("[skill-a]", "first skill directory or GitHub source")
    .argument("[skill-b]", "second skill directory or GitHub source")
    .option("--evals <path>", "development eval YAML file or directory")
    .option("--holdout <path>", "holdout eval YAML file or directory")
    .option("--comparison <path>", "reuse a compatible compare result or bundle")
    .option("--repeat <count>", "override the configured repetition count", positiveInteger)
    .option("--skill-path-a <path>", "repository-relative SKILL.md path for the first source")
    .option("--skill-path-b <path>", "repository-relative SKILL.md path for the second source")
    .option("-o, --output <directory>", "write a portable result bundle")
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        inputA: string | undefined,
        inputB: string | undefined,
        options: {
          evals?: string;
          holdout?: string;
          comparison?: string;
          repeat?: number;
          skillPathA?: string;
          skillPathB?: string;
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
        const runnerChoice =
          initializationChoice ??
          (await session.runnerChoice(config, getGlobalOptions(command)));
        const sourceA = await session.requiredText(
          inputA,
          "skill-a",
          "What is the first source to merge?",
        );
        const sourceB = await session.requiredText(
          inputB,
          "skill-b",
          "What is the second source to merge?",
        );
        const evals = await session.value(
          options.evals,
          "Which development evaluation file or directory should be used?",
          "evals/development",
        );
        const repeat = await session.count(options.repeat, "How many repetitions?", config.eval.repeat);
        const output = await session.output(options.output, "results/merge.skillbench");
        validateOutputOptions({
          ...(output === undefined ? {} : { output }),
          ...(options.force === undefined ? {} : { force: options.force }),
        });
        const operation = await executeMerge(context.application, {
          config,
          projectRoot: layout.root,
          selectRunner: async () => runnerChoice,
          sourceA,
          sourceB,
          resolveOptionsA: sourceResolveOptions(command, session, options.skillPathA),
          resolveOptionsB: sourceResolveOptions(command, session, options.skillPathB),
          evals,
          events: session,
          ...(options.holdout === undefined ? {} : { holdout: options.holdout }),
          ...(options.comparison === undefined ? {} : { comparison: options.comparison }),
          repeat,
          ...(output === undefined ? {} : { output }),
          ...(options.force === undefined ? {} : { force: options.force }),
        });
        if (options.json === true || context.jsonl(command)) {
          context.writeJson("merge", operation.result);
          return;
        }
        context.writeStdout(renderMergeResult({ sourceA, sourceB, evals, operation }));
      },
    );
}
