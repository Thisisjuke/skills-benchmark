import { Command, CommanderError } from "commander";

import { SkillbenchError } from "@skillbench/sdk/errors";
import { silentLogger, type Logger } from "@skillbench/sdk/logging";
import packageJson from "../../package.json" with { type: "json" };
import type { ApplicationContext } from "../application";
import { writeBundle } from "../bundles";
import { createExecutionRuntime, type ExecutionRuntime } from "../composition/execution-runtime";
import { createSourceService } from "../composition/source-service";
import { loadConfig, type RunnerSelection, type SkillbenchConfig } from "../config";
import { CliHistoryStore } from "../history";
import { shouldRecommendInitialization } from "../init";
import { configurePromptfooEnvironment, createProjectLayout } from "../project";
import type { ExecutionCommandContext } from "./command-context";
import { registerCompareCommand } from "./commands/compare";
import { registerDoctorCommand } from "./commands/doctor";
import { registerEvalCommand } from "./commands/eval";
import { registerHistoryCommand } from "./commands/history";
import { registerInitCommand } from "./commands/init";
import { registerInspectCommand } from "./commands/inspect";
import { registerMergeCommand } from "./commands/merge";
import {
  createClackPromptPort,
  interactiveEnabled,
  PromptSession,
  type PromptPort,
} from "./interactive";
import { renderCliJsonResult, validatedResult, type CliJsonCommand } from "./json-output";
import { CliJsonlWriter } from "./jsonl-output";
import { writeStdout as writeProcessStdout } from "./stdio";
import {
  getGlobalOptions,
  globalArguments,
  nonEmptyString,
  reasoningEffort,
  runnerType,
  type GlobalOptions,
} from "./options";

export type CreateProgramOptions = {
  createId?: () => string;
  jobId?: string;
  now?: () => Date;
  signal?: AbortSignal;
  logger?: Logger;
  prompts?: PromptPort;
  services?: Partial<CliApplicationServices>;
  stdinIsTTY?: boolean;
  stderrIsTTY?: boolean;
  writeStdout?: (value: string) => void;
};

export type CliApplicationServices = {
  cwd: () => string;
  environment: NodeJS.ProcessEnv;
  loadConfig: typeof loadConfig;
  createHistoryStore: (cwd: string, logger: Logger) => CliHistoryStore;
  createSourceService: typeof createSourceService;
  createExecutionRuntime: typeof createExecutionRuntime;
};

function loadConfiguredProject(
  command: Command,
  logger: Logger,
  services: Pick<CliApplicationServices, "cwd" | "loadConfig">,
): {
  config: SkillbenchConfig;
  configFile?: string;
  layout: ReturnType<typeof createProjectLayout>;
} {
  const options = getGlobalOptions(command);
  logger.debug("config.load.start", { explicitConfig: options.config !== undefined });
  const loaded = services.loadConfig({
    cwd: services.cwd(),
    ...(options.config === undefined ? {} : { configPath: options.config }),
  });
  logger.debug("config.load.complete", {
    configFile: loaded.configFile,
    projectRoot: loaded.projectRoot,
    runner: loaded.config.runners[0]?.type,
  });
  return {
    config: loaded.config,
    ...(loaded.configFile === undefined ? {} : { configFile: loaded.configFile }),
    layout: createProjectLayout(loaded.projectRoot),
  };
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();
  const logger = options.logger ?? silentLogger;
  const promptPort = options.prompts ?? createClackPromptPort(process.stdin, process.stderr);
  const writeStdout = options.writeStdout ?? writeProcessStdout;
  const jobId = options.jobId ?? crypto.randomUUID();
  const jsonlWriter = (command: CliJsonCommand) => new CliJsonlWriter(command, jobId, writeStdout);
  const writeJson = (command: CliJsonCommand, data: unknown) => {
    if (program.opts<GlobalOptions>().jsonl === true) {
      jsonlWriter(command).completed(validatedResult(command, data));
      return;
    }
    writeStdout(renderCliJsonResult(command, data));
  };
  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY === true;
  const stderrIsTTY = options.stderrIsTTY ?? process.stderr.isTTY === true;
  const services: CliApplicationServices = {
    cwd: options.services?.cwd ?? (() => process.cwd()),
    environment: options.services?.environment ?? process.env,
    loadConfig: options.services?.loadConfig ?? loadConfig,
    createHistoryStore:
      options.services?.createHistoryStore ??
      ((cwd, historyLogger) => new CliHistoryStore(cwd, historyLogger)),
    createSourceService: options.services?.createSourceService ?? createSourceService,
    createExecutionRuntime: options.services?.createExecutionRuntime ?? createExecutionRuntime,
  };
  const loadProjectFor = (command: Command) => {
    const project = loadConfiguredProject(command, logger, services);
    configurePromptfooEnvironment(project.layout, services.environment);
    return project;
  };
  const sourceServiceFor = (config: SkillbenchConfig, projectRoot: string) =>
    services.createSourceService(config, logger, services.environment, projectRoot);
  const historyStore = (projectRoot: string) =>
    services.createHistoryStore(projectRoot, logger);
  const executionRuntimeFor = (
    config: SkillbenchConfig,
    selection: RunnerSelection,
    projectRoot: string,
  ): Promise<ExecutionRuntime> =>
    services.createExecutionRuntime(
      config,
      logger,
      selection.choice,
      projectRoot,
      selection.configuration,
    );
  const sessionFor = (command: Command, json: boolean): PromptSession => {
    const global = getGlobalOptions(command);
    if (json && global.jsonl === true) {
      throw new SkillbenchError("--json and --jsonl cannot be used together", {
        code: "CLI_OUTPUT_CONFLICT",
      });
    }
    return new PromptSession({
      interactive: interactiveEnabled({
        stdinIsTTY,
        stderrIsTTY,
        json: json || global.jsonl === true,
        inputEnabled: global.input !== false,
      }),
      yes: global.yes === true,
      prompts: promptPort,
      ...(global.jsonl === true
        ? {
            onProgress: (message: string) =>
              jsonlWriter(command.name() as CliJsonCommand).phase(message),
            onStatus: (message: string, current?: number, total?: number) =>
              jsonlWriter(command.name() as CliJsonCommand).progress(message, current, total),
          }
        : {}),
    });
  };

  program
    .exitOverride()
    .configureOutput({ writeOut: writeStdout, writeErr: () => undefined })
    .allowExcessArguments(false);
  program
    .name("skillbench")
    .description("Benchmark, compare and merge Agent Skills locally")
    .version(packageJson.version)
    .option(
      "-c, --config <path>",
      "configuration file (canonical project path: .skillbench/config.yaml)",
      nonEmptyString,
    )
    .option("--debug", "write diagnostic events and stacktraces to stderr")
    .option("--offline", "forbid network access and reject remote GitHub sources")
    .option("--runner <runner>", "registered execution runner identifier", runnerType)
    .option("--model <model>", "runner model identifier", nonEmptyString)
    .option(
      "--reasoning-effort <effort>",
      "runner reasoning effort: minimal, low, medium, high, xhigh or max",
      reasoningEffort,
    )
    .option("--variant <variant>", "OpenCode provider-specific model variant", nonEmptyString)
    .option("--no-input", "disable all interactive questions")
    .option("--no-history", "disable the local comparison history")
    .option("--jsonl", "stream versioned machine-readable events")
    .option("-y, --yes", "accept the determined preflight");
  program.configureHelp({ showGlobalOptions: true });

  program.action(async (_options, command: Command) => {
    const unknown = program.args[0];
    if (unknown !== undefined) {
      throw new CommanderError(
        1,
        "commander.unknownCommand",
        `error: unknown command '${unknown}'`,
      );
    }
    const global = getGlobalOptions(command);
    const interactive = interactiveEnabled({
      stdinIsTTY,
      stderrIsTTY,
      json: false,
      inputEnabled: global.input !== false,
    });
    if (!interactive) {
      program.outputHelp();
      return;
    }
    const recommendInitialization = shouldRecommendInitialization(services.cwd());
    const selected = await promptPort.select({
      message: "What would you like to do?",
      options: [
        { value: "inspect", label: "Inspect a skill" },
        {
          value: "init",
          label: "Initialize a project",
          ...(recommendInitialization
            ? { hint: "Recommended: create a config and starter eval suite" }
            : {}),
        },
        { value: "eval", label: "Evaluate a skill" },
        { value: "compare", label: "Compare two skills" },
        { value: "merge", label: "Merge two skills" },
        { value: "history", label: "Rerun a recent comparison" },
        { value: "doctor", label: "Check the local environment" },
      ],
      initialValue: recommendInitialization ? "init" : "compare",
    });
    await program.parseAsync(["node", "skillbench", ...globalArguments(global), selected]);
  });

  const application: ApplicationContext = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    logger,
    now: options.now ?? (() => new Date()),
    createId: options.createId ?? (() => crypto.randomUUID()),
    sourceService: sourceServiceFor,
    executionRuntime: executionRuntimeFor,
    recordComparison: (entry) => historyStore(entry.cwd).record(entry),
    writeBundle: (input) => {
      const bundle = writeBundle({ ...input, jobId });
      if (program.opts<GlobalOptions>().jsonl === true) {
        jsonlWriter(input.command).artifact("bundle", bundle.path);
      }
      return bundle;
    },
  };
  const executionContext: ExecutionCommandContext = {
    cwd: services.cwd,
    environment: services.environment,
    writeStdout,
    writeJson,
    jsonl: (command) => getGlobalOptions(command).jsonl === true,
    sessionFor,
    loadProject: loadProjectFor,
    application,
  };

  registerInitCommand(program, executionContext);
  registerDoctorCommand(program, executionContext);
  registerHistoryCommand(program, executionContext, {
    stdinIsTTY,
    stderrIsTTY,
    historyStore,
    prompts: promptPort,
  });
  registerInspectCommand(program, executionContext);
  registerEvalCommand(program, executionContext);
  registerCompareCommand(program, executionContext);
  registerMergeCommand(program, executionContext);

  // Keep the root action able to report an unknown command while subcommands retain
  // Commander's strict positional-argument validation inherited during registration.
  program.allowExcessArguments();

  program.addHelpText(
    "after",
    `\nExamples:\n  $ skillbench init\n  $ skillbench inspect ./skills/my-skill\n  $ skillbench eval ./skills/my-skill\n  $ skillbench compare ./skill-a https://github.com/owner/repository/tree/main/skill-b\n  $ skillbench merge ./skill-a ./skill-b\n  $ skillbench history\n  $ skillbench doctor\n  $ skillbench inspect github:owner/repository/path/to/skill@main --json\n`,
  );
  return program;
}
