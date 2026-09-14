import { defineConfig } from "vite-plus";

/**
 * @typedef {{
 *   alwaysBundle?: string[];
 *   liveTest?: { environmentVariable: string; file: string };
 * }} NodeLibraryConfigOptions
 */

/**
 * @param {NodeLibraryConfigOptions} [options]
 */
export function defineNodeLibraryConfig(options = {}) {
  const alwaysBundle = options.alwaysBundle ?? [];
  const liveTestFile =
    options.liveTest && process.env[options.liveTest.environmentVariable] === "1"
      ? options.liveTest.file
      : undefined;
  return defineConfig({
    run: {
      tasks: {
        build: {
          command: "vp pack",
          dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        },
      },
    },
    pack: {
      entry: ["src/index.ts"],
      deps: {
        neverBundle: true,
        ...(alwaysBundle.length === 0 ? {} : { alwaysBundle }),
        dts: {
          neverBundle: true,
          ...(alwaysBundle.length === 0 ? {} : { alwaysBundle }),
        },
      },
      clean: true,
      dts: true,
      exports: true,
      format: ["esm"],
      platform: "node",
      publint: true,
      target: "node22.22",
      tsconfig: "tsconfig.build.json",
    },
    test: {
      include: [liveTestFile ?? "tests/**/*.test.ts"],
      exclude: liveTestFile ? [] : ["tests/**/*-live.test.ts"],
      environment: "node",
      pool: "threads",
    },
  });
}
