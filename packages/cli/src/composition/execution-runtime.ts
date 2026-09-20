import {
  PROMPTFOO_VERSION,
  PromptfooAssertionEngine,
} from "@skillbench/assertions-promptfoo";
import { AssertionEvaluator } from "@skillbench/sdk/assertions";
import type { ComparisonJudge } from "@skillbench/sdk/comparator";
import type { AssertionEngine } from "@skillbench/sdk/evaluator";
import { BlindPairwiseJudge, RunnerBackedJudge } from "@skillbench/sdk/judge";
import type { Logger } from "@skillbench/sdk/logging";
import type { ExecutionProfile, Runner } from "@skillbench/sdk/runners";
import { FINGERPRINT_ALGORITHM, fingerprintFiles, type SkillSnapshot } from "@skillbench/sdk/skills";

import { assetSkillFile, loadProjectRuntimeAssets, type ProjectRuntimeAssets } from "../assets";
import {
  selectionForChoice,
  type ConfiguredRunner,
  type SkillbenchConfig,
} from "../config";
import { createProjectLayout } from "../project";
import { runnerDefinition, type RunnerChoice } from "./runner-registry";

export type ExecutionRuntime = {
  runner: Runner;
  executionProfile: ExecutionProfile;
  assertions: AssertionEngine;
  judge?: ComparisonJudge;
  instructionAssets: ProjectRuntimeAssets;
  configuration: ConfiguredRunner;
};

export async function createExecutionRuntime(
  config: SkillbenchConfig,
  logger: Logger,
  choice: RunnerChoice,
  projectRoot: string,
  configuration?: ConfiguredRunner,
): Promise<ExecutionRuntime> {
  const assertions = createAssertionEngine(config, logger);
  const instructionAssets = loadProjectRuntimeAssets(projectRoot);
  const definition = runnerDefinition(choice.runner);
  const selectedConfiguration = configuration ?? executableConfiguration(config, choice);
  logger.debug("runner.create", {
    runner: choice.runner,
    model: choice.model,
    reasoningEffort: choice.reasoningEffort,
    variant: "variant" in choice ? choice.variant : undefined,
  });
  const runtime = await definition.create(
    {
      executable: selectedConfiguration.executable,
      sandbox: selectedConfiguration.sandbox,
      maxOutputBytes: selectedConfiguration.maxOutputBytes,
      logger,
    },
    choice,
  );
  return definition.capabilities.comparisonJudge
    ? modelRuntime(
        config,
        runtime.runner,
        runtime.executionProfile,
        assertions,
        projectRoot,
        instructionAssets,
        selectedConfiguration,
      )
    : { ...runtime, assertions, instructionAssets, configuration: selectedConfiguration };
}

export function executableForChoice(
  config: SkillbenchConfig,
  choice: RunnerChoice,
): string {
  return executableConfiguration(config, choice).executable;
}

function executableConfiguration(
  config: SkillbenchConfig,
  choice: RunnerChoice,
): ConfiguredRunner {
  return selectionForChoice(config, choice).configuration;
}

function modelRuntime(
  config: SkillbenchConfig,
  runner: Runner,
  executionProfile: ExecutionProfile,
  assertions: AssertionEngine,
  projectRoot: string,
  instructionAssets: ProjectRuntimeAssets,
  configuration: ConfiguredRunner,
): ExecutionRuntime {
  const layout = createProjectLayout(projectRoot);
  return {
    runner,
    executionProfile,
    assertions,
    configuration,
    judge: new BlindPairwiseJudge(
      new RunnerBackedJudge(runner, {
        timeoutMs: config.eval.timeoutMs,
        executionProfile,
        workspaceParent: layout.temporary,
        skillSnapshot: judgeSnapshot(instructionAssets),
      }),
      { timeoutMs: config.eval.timeoutMs },
    ),
    instructionAssets,
  };
}

function judgeSnapshot(assets: ProjectRuntimeAssets): SkillSnapshot {
  const file = assetSkillFile(assets.judgeSkill);
  return {
    id: `project-judge-${assets.judgeSkill.contentHash}`,
    origin: { type: "local", originalInput: assets.judgeSkill.path },
    rootPath: ".skillbench/prompts/judge",
    files: [file],
    fingerprint: fingerprintFiles([file]),
    fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
    fetchedAt: new Date().toISOString(),
  };
}

function createAssertionEngine(config: SkillbenchConfig, logger: Logger): AssertionEvaluator {
  logger.debug("promptfoo.configure", {
    enabled: config.promptfoo.enabled,
    engineVersion: PROMPTFOO_VERSION,
  });
  if (!config.promptfoo.enabled) return new AssertionEvaluator();
  const promptfoo = new PromptfooAssertionEngine(undefined, logger);
  return new AssertionEvaluator({
    handlers: { promptfoo: promptfoo.evaluate.bind(promptfoo) },
  });
}
