import { defineNodeLibraryConfig } from "../../vite.library.config.js";

export default defineNodeLibraryConfig({
  alwaysBundle: ["@skillbench/runner-kit"],
  liveTest: {
    environmentVariable: "SKILLBENCH_OPENCODE_LIVE",
    file: "tests/opencode-live.test.ts",
  },
});
