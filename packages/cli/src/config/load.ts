import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import * as z from "zod";

import { SkillbenchError, toErrorMessage } from "@skillbench/sdk/errors";
import { findProjectConfig } from "../project";
import { resolveConfigPaths, skillbenchConfigSchema, type SkillbenchConfig } from "./schema";

export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
};

export type LoadedConfig = {
  config: SkillbenchConfig;
  configFile?: string;
  projectRoot: string;
};

function findConfigFile(cwd: string, explicitPath?: string): string | undefined {
  if (explicitPath !== undefined) {
    const path = resolve(cwd, explicitPath);
    if (!existsSync(path)) {
      throw new SkillbenchError(`Configuration file not found: ${path}`, { code: "CONFIG_NOT_FOUND" });
    }
    return path;
  }

  return findProjectConfig(cwd);
}

export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configFile = findConfigFile(cwd, options.configPath);
  const projectRoot = configFile === undefined ? cwd : dirname(configFile);
  let input: unknown = {};

  if (configFile !== undefined) {
    try {
      input = parseYaml(readFileSync(configFile, "utf8")) ?? {};
    } catch (error) {
      throw new SkillbenchError(`Cannot parse configuration ${configFile}: ${toErrorMessage(error)}`, {
        code: "CONFIG_PARSE_ERROR",
        cause: error,
      });
    }
  }

  try {
    const config = resolveConfigPaths(skillbenchConfigSchema.parse(input), projectRoot);
    return configFile === undefined
      ? { config, projectRoot }
      : { config, configFile, projectRoot };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues
        .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
        .join("; ");
      throw new SkillbenchError(`Invalid configuration: ${details}`, {
        code: "CONFIG_VALIDATION_ERROR",
        cause: error,
      });
    }
    throw error;
  }
}
