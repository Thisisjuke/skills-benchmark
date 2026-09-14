import { defineNodeLibraryConfig } from "../../vite.library.config.js";

export default defineNodeLibraryConfig({
  alwaysBundle: ["@skillbench/runner-kit"],
  liveTest: {
    environmentVariable: "SKILLBENCH_CLAUDE_LIVE",
    file: "tests/claude-live.test.ts",
  },
});
