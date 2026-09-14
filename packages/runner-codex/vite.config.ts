import { defineNodeLibraryConfig } from "../../vite.library.config.js";

export default defineNodeLibraryConfig({
  alwaysBundle: ["@skillbench/runner-kit"],
});
