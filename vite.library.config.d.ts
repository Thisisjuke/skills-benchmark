import type { UserConfig } from "vite-plus";

export type NodeLibraryConfigOptions = {
  alwaysBundle?: string[];
  liveTest?: {
    environmentVariable: string;
    file: string;
  };
};

export declare function defineNodeLibraryConfig(options?: NodeLibraryConfigOptions): UserConfig;
