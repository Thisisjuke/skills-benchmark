import { defineConfig, type PluginOption } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const plugins = [...react(), ...tailwindcss()] as unknown as PluginOption[];

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp build && vp pack",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      dev: {
        command: "vp dev",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      typecheck: {
        command: "tsc --noEmit",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
    },
  },
  plugins,
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: "dist/client", emptyOutDir: true },
  pack: {
    clean: false,
    entry: { server: "src/server.ts" },
    platform: "node",
    target: "node22.22",
    publint: true,
  },
});
