import type { Command } from "commander";

import { SkillbenchError } from "@skillbench/sdk/errors";
import { CLI_HISTORY_VERSION, type CliHistoryStore } from "../../history";
import type { ExecutionCommandContext } from "../command-context";
import { findHistoryEntry, historyArguments, validateHistoryPaths } from "../history-replay";
import { interactiveEnabled, type PromptPort } from "../interactive";
import { getGlobalOptions, globalArguments, nonEmptyString, validateOutputMode } from "../options";
import { historyHint, renderHistory } from "../renderers";

export type HistoryCommandEnvironment = {
  stdinIsTTY: boolean;
  stderrIsTTY: boolean;
  historyStore: (projectRoot: string) => CliHistoryStore;
  prompts: PromptPort;
};

export function registerHistoryCommand(
  program: Command,
  context: ExecutionCommandContext,
  environment: HistoryCommandEnvironment,
): void {
  program
    .command("history")
    .description("list or rerun the ten most recent interactive comparisons")
    .option("--rerun <id>", "rerun one history entry", nonEmptyString)
    .option("--json", "write structured JSON")
    .action(async (options: { rerun?: string; json?: boolean }, command: Command) => {
      const global = getGlobalOptions(command);
      validateOutputMode(options.json === true, global.jsonl === true);
      if (global.history === false) {
        throw new SkillbenchError("CLI history is disabled by --no-history", {
          code: "CLI_HISTORY_DISABLED",
        });
      }
      const { config, layout } = context.loadProject(command);
      const entries = environment.historyStore(layout.root).list();
      if (options.rerun !== undefined) {
        const entry = findHistoryEntry(entries, options.rerun);
        validateHistoryPaths(
          entry,
          context.application.sourceService(config, layout.root),
        );
        await program.parseAsync([
          "node",
          "skillbench",
          ...globalArguments(global, { includeProfile: false }),
          ...historyArguments(entry),
        ]);
        return;
      }
      if (options.json === true || global.jsonl === true) {
        context.writeJson("history", { schemaVersion: CLI_HISTORY_VERSION, entries });
        return;
      }
      const interactive = interactiveEnabled({
        stdinIsTTY: environment.stdinIsTTY,
        stderrIsTTY: environment.stderrIsTTY,
        json: false,
        inputEnabled: global.input !== false,
      });
      if (!interactive || entries.length === 0) {
        context.writeStdout(renderHistory(entries));
        return;
      }
      const selected = await environment.prompts.select({
        message: "Which comparison should be rerun?",
        options: entries.map((entry) => ({
          value: entry.id,
          label: `${entry.sourceA} vs ${entry.sourceB}`,
          hint: historyHint(entry),
        })),
        initialValue: entries[0]!.id,
      });
      const entry = findHistoryEntry(entries, selected);
      validateHistoryPaths(
        entry,
        context.application.sourceService(config, layout.root),
      );
      await program.parseAsync([
        "node",
        "skillbench",
        ...globalArguments(global, { includeProfile: false }),
        ...historyArguments(entry),
      ]);
    });
}
