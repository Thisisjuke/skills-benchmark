import { defineConfig } from "vite-plus";

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
    entry: [
      "src/index.ts",
      "src/assertions/index.ts",
      "src/bundles/index.ts",
      "src/comparator/index.ts",
      "src/evaluator/index.ts",
      "src/errors.ts",
      "src/holdout/index.ts",
      "src/inspect.ts",
      "src/judge/index.ts",
      "src/logging/index.ts",
      "src/merger/index.ts",
      "src/reports/index.ts",
      "src/results/index.ts",
      "src/runners/index.ts",
      "src/skills/index.ts",
      "src/sources/index.ts",
      "src/sources/local.ts",
    ],
    clean: true,
    dts: true,
    exports: true,
    format: ["esm"],
    platform: "node",
    publint: true,
    target: "node22.22",
  },
});
