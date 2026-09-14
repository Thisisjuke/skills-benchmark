import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
  },
});
