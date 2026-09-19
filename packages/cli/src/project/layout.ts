import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export const PROJECT_CONFIG_RELATIVE_PATH = ".skillbench/config.yaml";

export type ProjectLayout = {
  root: string;
  state: string;
  config: string;
  runs: string;
  evals: {
    development: string;
  };
  temporary: string;
  promptfoo: {
    root: string;
    cache: string;
    logs: string;
  };
};

export function findProjectConfig(startDirectory: string): string | undefined {
  let directory = resolve(startDirectory);
  const filesystemRoot = parse(directory).root;
  while (true) {
    const candidate = join(directory, ".skillbench", "config.yaml");
    if (existsSync(candidate)) return candidate;
    if (directory === filesystemRoot) return undefined;
    directory = dirname(directory);
  }
}

export function createProjectLayout(projectRoot: string): ProjectLayout {
  const root = resolve(projectRoot);
  const state = join(root, ".skillbench");
  const promptfoo = join(state, "promptfoo");
  return {
    root,
    state,
    config: join(state, "config.yaml"),
    runs: join(state, "runs"),
    evals: {
      development: join(state, "evals", "development"),
    },
    temporary: join(state, "tmp"),
    promptfoo: {
      root: promptfoo,
      cache: join(promptfoo, "cache"),
      logs: join(promptfoo, "logs"),
    },
  };
}

export function configurePromptfooEnvironment(
  layout: ProjectLayout,
  environment: NodeJS.ProcessEnv,
): void {
  Object.assign(environment, {
    PROMPTFOO_CONFIG_DIR: layout.promptfoo.root,
    PROMPTFOO_CACHE_PATH: layout.promptfoo.cache,
    PROMPTFOO_LOG_DIR: layout.promptfoo.logs,
    PROMPTFOO_DISABLE_REMOTE_GENERATION: "1",
    PROMPTFOO_DISABLE_SHARING: "1",
    PROMPTFOO_DISABLE_TELEMETRY: "1",
    PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS: "1",
    PROMPTFOO_DISABLE_UPDATE: "1",
  });
}
