import type { Command } from "commander";

import { executeMerge } from "../../application";
import type { ExecutionCommandContext } from "../command-context";
import {
  getGlobalOptions,
  noOutputOption,
  nonEmptyString,
  positiveInteger,
  sourceResolveOptions,
  validateOutputOptions,
} from "../options";
import { ensureInitializedProject } from "../ensure-project";
import { chooseEvalFile, validateEvalInput } from "../project-choices";
import { renderMergeResult } from "../renderers";
import {
  resolveRunOutput,
  withRunOutputReservation,
  type RunOutputOptions,
} from "../run-output";

export function registerMergeCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("merge")
    .description("generate and rank merge candidates from a development comparison")
    .argument("[skill-a]", "first skill directory or GitHub source")
    .argument("[skill-b]", "second skill directory or GitHub source")
    .option("--evals <path>", "development YAML scoring tasks and assertions", nonEmptyString)
    .option("--holdout <path>", "holdout YAML tasks for final candidate validation", nonEmptyString)
    .option("--comparison <path>", "reuse a compatible compare result or bundle", nonEmptyString)
    .option("--repeat <count>", "override the configured repetition count", positiveInteger)
    .option("--skill-path-a <path>", "repository-relative SKILL.md path for the first source", nonEmptyString)
    .option("--skill-path-b <path>", "repository-relative SKILL.md path for the second source", nonEmptyString)
    .option("-o, --output <directory>", "use this exact result bundle directory", nonEmptyString)
    .addOption(noOutputOption())
    .option("--force", "replace the exact bundle at --output")
    .option("--json", "write structured JSON")
    .action(
      async (
        inputA: string | undefined,
        inputB: string | undefined,
        options: RunOutputOptions & {
          evals?: string;
          holdout?: string;
          comparison?: string;
          repeat?: number;
          skillPathA?: string;
          skillPathB?: string;
          json?: boolean;
        },
        command: Command,
      ) => {
        validateOutputOptions(options);
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
        const evals = await chooseEvalFile({
          supplied: options.evals,
          configuredPath: config.eval.path,
          partition: "development",
          projectRoot: layout.root,
          session,
        });
        validateEvalInput({ path: evals, partition: "development", projectRoot: layout.root });
        if (options.holdout !== undefined) {
          validateEvalInput({
            path: options.holdout,
            partition: "holdout",
            projectRoot: layout.root,
          });
        }
        const repeat = await session.count(
          options.repeat,
          "How many repetitions? 1 is fastest; 2-3 reduce variance; 10 costs about 10× per case and skill.",
          config.eval.repeat,
        );
        const output = resolveRunOutput({
          command: "merge",
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
            executeMerge(context.application, {
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
            }),
        );
        if (options.json === true || context.jsonl(command)) {
          context.writeJson("merge", operation.result);
          return;
        }
        const rendered = renderMergeResult({ sourceA, sourceB, evals, operation });
        if (!("runId" in operation.result) && session.interactive) {
          session.notice(rendered.trim(), "Merge skipped");
          return;
        }
        context.writeStdout(rendered);
      },
    );
}
