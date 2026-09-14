import { PROMPTFOO_VERSION } from "@skillbench/assertions-promptfoo";
import { execa } from "execa";

import { loadProjectRuntimeAssets } from "../assets";

const MINIMUM_NODE = "22.22.2";

export type DoctorRequest = {
  projectRoot: string;
  configFile?: string;
  stateDirectory: string;
  temporaryDirectory: string;
  promptfooDirectory: string;
  runner?: string;
  executable?: string;
  environment: NodeJS.ProcessEnv;
};

export type DoctorResult = Awaited<ReturnType<typeof executeDoctor>>;

export async function executeDoctor(request: DoctorRequest) {
  const initialized = request.configFile !== undefined;
  return {
    node: {
      version: process.versions.node,
      minimum: MINIMUM_NODE,
      supported: versionAtLeast(process.versions.node, MINIMUM_NODE),
    },
    project: {
      root: request.projectRoot,
      initialized,
      configFile: request.configFile ?? null,
      stateDirectory: request.stateDirectory,
      temporaryDirectory: request.temporaryDirectory,
      promptfooDirectory: request.promptfooDirectory,
    },
    assets: inspectAssets(request.projectRoot, initialized),
    runner:
      request.runner === undefined || request.executable === undefined
        ? {
            configured: false as const,
            runner: null,
            executable: null,
            available: null,
            version: null,
            remediation: "Run: skillbench init",
          }
        : {
            configured: true as const,
            ...(await inspectRunner(request.runner, request.executable)),
          },
    promptfoo: { version: PROMPTFOO_VERSION, embedded: true },
    github: {
      authenticated: Boolean(request.environment.GITHUB_TOKEN ?? request.environment.GH_TOKEN),
      tokenEnvironment: request.environment.GITHUB_TOKEN
        ? "GITHUB_TOKEN"
        : request.environment.GH_TOKEN
          ? "GH_TOKEN"
          : null,
    },
  };
}

async function inspectRunner(runner: string, executable: string) {
  if (runner === "mock") return { runner, executable, available: true, version: "built-in" };
  try {
    const probe = await execa(executable, ["--version"], { reject: false, timeout: 10_000 });
    const version = (probe.stdout || probe.stderr).trim();
    return {
      runner,
      executable,
      available: probe.exitCode === 0,
      version: version || null,
      ...(probe.exitCode === 0 ? {} : { remediation: `Install or configure ${runner}.` }),
    };
  } catch (error) {
    return {
      runner,
      executable,
      available: false,
      version: null,
      remediation: `Cannot execute ${executable}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function inspectAssets(root: string, initialized: boolean) {
  if (!initialized) {
    return { valid: false, remediation: "Run: skillbench init --no-input", assets: [] };
  }
  try {
    const assets = loadProjectRuntimeAssets(root);
    return { valid: true, remediation: null, assets: assets.references };
  } catch (error) {
    return {
      valid: false,
      remediation: error instanceof Error ? error.message : String(error),
      assets: [],
    };
  }
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
