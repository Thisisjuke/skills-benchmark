// Registered by the CLI project lifecycle scenario suite.
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  configurePromptfooEnvironment,
  createProjectLayout,
} from "../src/project";

describe("project layout", () => {
  it("roots generated and Promptfoo state inside the project", () => {
    const layout = createProjectLayout("/workspace/example");
    const environment: NodeJS.ProcessEnv = {};

    configurePromptfooEnvironment(layout, environment);

    expect(layout.state).toBe(join(layout.root, ".skillbench"));
    expect(environment).toMatchObject({
      PROMPTFOO_CONFIG_DIR: join(layout.root, ".skillbench", "promptfoo"),
      PROMPTFOO_CACHE_PATH: join(layout.root, ".skillbench", "promptfoo", "cache"),
      PROMPTFOO_LOG_DIR: join(layout.root, ".skillbench", "promptfoo", "logs"),
      PROMPTFOO_DISABLE_REMOTE_GENERATION: "1",
      PROMPTFOO_DISABLE_SHARING: "1",
      PROMPTFOO_DISABLE_TELEMETRY: "1",
      PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS: "1",
      PROMPTFOO_DISABLE_UPDATE: "1",
    });
  });
});
