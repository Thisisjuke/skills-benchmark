import { defineConfig } from "vite-plus";

const liveTestFile =
  process.env.SKILLBENCH_CODEX_LIVE === "1"
    ? "tests/integration/codex-live.test.ts"
    : process.env.SKILLBENCH_GITHUB_LIVE === "1"
      ? "tests/integration/github-live.test.ts"
      : undefined;

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
      },
    },
  },
  pack: {
    entry: {
      cli: "src/cli.ts",
      "cli-path": "src/cli-path.ts",
      "contracts/index": "src/contracts/index.ts",
      "contracts/bundles": "src/contracts/bundles.ts",
    },
    deps: {
      alwaysBundle: [
        "@skillbench/assertions-promptfoo",
        "@skillbench/invocation-contract",
        "@skillbench/runner-claude",
        "@skillbench/runner-codex",
        "@skillbench/sdk",
        "@skillbench/source-github",
      ],
      dts: {
        alwaysBundle: ["@skillbench/invocation-contract", "@skillbench/sdk"],
      },
    },
    clean: true,
    dts: true,
    exports: false,
    format: ["esm"],
    platform: "node",
    publint: true,
    target: "node22.22",
  },
  test: {
    include: [liveTestFile ?? "tests/**/*.test.ts"],
    exclude: liveTestFile ? [] : ["tests/**/*-live.test.ts"],
    environment: "node",
    pool: "threads",
  },
});
