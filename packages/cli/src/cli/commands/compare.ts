import type { Command } from "commander";

import { executeCompare } from "../../application";
import { addConfiguredRunner } from "../../config";
import type { EvalPartition } from "@skillbench/sdk/evaluator";
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
import {
  chooseEvalFile,
  chooseReportTemplate,
  validateEvalInput,
  validateReportTemplateInput,
} from "../project-choices";
import { renderCompareResult } from "../renderers";
import {
  resolveRunOutput,
  withRunOutputReservation,
  type RunOutputOptions,
} from "../run-output";

export function registerCompareCommand(program: Command, context: ExecutionCommandContext): void {
  program
    .command("compare")
    .description("compare two skills against the same YAML eval suite")
    .argument("[skill-a]", "first skill directory or GitHub source")
    .argument("[skill-b]", "second skill directory or GitHub source")
    .option("--evals <path>", "YAML scoring tasks and assertions file or directory", nonEmptyString)
    .option("--partition <partition>", "development or holdout", partition)
    .option("--repeat <count>", "override the configured repetition count", positiveInteger)
    .option("--report-template <path>", "Markdown template used to render report.md", nonEmptyString)
    .option("--skill-path-a <path>", "repository-relative SKILL.md path for the first source", nonEmptyString)
    .option("--skill-path-b <path>", "repository-relative SKILL.md path for the second source", nonEmptyString)
    .option("--keep-workspaces", "retain temporary workspaces for debugging")
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
          partition?: EvalPartition;
          repeat?: number;
          reportTemplate?: string;
          skillPathA?: string;
          skillPathB?: string;
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
        const globalOptions = getGlobalOptions(command);
        const runnerChoice =
          initializationChoice ??
          (await session.runnerChoice(
            config,
            globalOptions,
            configFile === undefined
              ? {}
              : {
                  onRunnerAdded: (runner) => addConfiguredRunner(configFile, runner),
                },
          ));
        const sourceA = await session.requiredText(
          inputA,
          "skill-a",
          "What is the first source (path or GitHub URL)?",
        );
        const sourceB = await session.requiredText(
          inputB,
          "skill-b",
          "What is the second source (path or GitHub URL)?",
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
        const reportTemplate = await chooseReportTemplate({
          supplied: options.reportTemplate,
          configuredPath: config.reports.template,
          projectRoot: layout.root,
          session,
        });
        validateReportTemplateInput(layout.root, reportTemplate);
        const repeat = await session.count(
          options.repeat,
          "How many repetitions? 1 is fastest; 2-3 reduce variance; 10 costs about 10× per case and skill.",
          config.eval.repeat,
        );
        const output = resolveRunOutput({
          command: "compare",
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
            executeCompare(context.application, {
              config,
              projectRoot: layout.root,
              selectRunner: async () => runnerChoice,
              sourceA,
              sourceB,
              resolveOptionsA: sourceResolveOptions(command, session, options.skillPathA),
              resolveOptionsB: sourceResolveOptions(command, session, options.skillPathB),
              evals,
              reportTemplate,
              recordHistory: session.interactive && globalOptions.history !== false,
              ...(options.output === undefined ? {} : { historyOutput: options.output }),
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
          context.writeJson("compare", operation.result);
          return;
        }
        context.writeStdout(renderCompareResult({ sourceA, sourceB, evals, operation }));
      },
    );
}
