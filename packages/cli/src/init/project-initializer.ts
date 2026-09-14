import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SkillbenchError } from "@skillbench/sdk/errors";

import type { RunnerChoice } from "../composition/runner-registry";

const STATE_IGNORE_RULE = ".skillbench/";

export const INITIALIZED_PROJECT_FILES = Object.freeze([
  {
    path: "skillbench.yaml",
    description: "Project runner, evaluation, and Promptfoo settings.",
  },
  {
    path: "evals/development/example.yaml",
    description: "A starter development evaluation to replace or extend.",
  },
  {
    path: "skillbench/assets.yaml",
    description: "The validated map of editable runtime instruction assets.",
  },
  {
    path: "skillbench/judge/SKILL.md",
    description: "The local skill used for qualitative blind judging.",
  },
  {
    path: "skillbench/prompts/judge-instruction.txt",
    description: "The instruction sent to the qualitative judge runner.",
  },
  {
    path: "skillbench/templates/merge-candidate.md",
    description: "The template used to render generated merge candidates.",
  },
  {
    path: ".gitignore",
    description: "Preserves existing rules and ignores generated .skillbench state.",
  },
] as const);

const PROJECT_TEMPLATES = [
  "evals/development/example.yaml",
  "skillbench/assets.yaml",
  "skillbench/judge/SKILL.md",
  "skillbench/prompts/judge-instruction.txt",
  "skillbench/templates/merge-candidate.md",
] as const;

export type InitResult = {
  created: string[];
  updated: string[];
  unchanged: string[];
  runner: RunnerChoice["runner"];
  profile: RunnerChoice;
};

export type InitializeProjectOptions = {
  force?: boolean;
  profile?: RunnerChoice;
};

export function shouldRecommendInitialization(cwd: string): boolean {
  return !existsSync(join(cwd, "skillbench.yaml")) && !existsSync(join(cwd, "skillbench.yml"));
}

export function initializedProjectConflicts(cwd: string): string[] {
  const root = resolve(cwd);
  return ["skillbench.yaml", "skillbench.yml", ...PROJECT_TEMPLATES]
    .map((path) => join(root, ...path.split("/")))
    .filter((path) => existsSync(path));
}

export function initializeProject(
  cwd: string,
  options: InitializeProjectOptions = {},
): InitResult {
  const root = resolve(cwd);
  const alternateConfig = join(root, "skillbench.yml");
  if (existsSync(alternateConfig)) {
    throw new SkillbenchError(
      `A project configuration already exists at ${alternateConfig}; move or remove it before initialization.`,
      { code: "CLI_INIT_EXISTS" },
    );
  }
  const profile = options.profile ?? { runner: "mock" };
  const files = [
    { path: join(root, "skillbench.yaml"), content: renderConfig(profile) },
    ...PROJECT_TEMPLATES.map((path) => ({
      path: join(root, ...path.split("/")),
      content: readDefault(join("project", ...path.split("/"))),
    })),
  ];
  const existing = files.filter((file) => existsSync(file.path));
  if (existing.length > 0 && options.force !== true) {
    throw new SkillbenchError(
      `Initialization would overwrite existing files: ${existing.map((file) => file.path).join(", ")}`,
      { code: "CLI_INIT_EXISTS" },
    );
  }

  const created: string[] = [];
  const updated: string[] = [];
  for (const file of files) {
    const existed = existsSync(file.path);
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, "utf8");
    (existed ? updated : created).push(file.path);
  }
  const gitignore = updateGitignore(root);
  if (gitignore.status === "created") created.push(gitignore.path);
  if (gitignore.status === "updated") updated.push(gitignore.path);
  return {
    created,
    updated,
    unchanged: gitignore.status === "unchanged" ? [gitignore.path] : [],
    runner: profile.runner,
    profile,
  };
}

function renderConfig(profile: RunnerChoice): string {
  const template = readDefault(join("config", `${profile.runner}.yaml`));
  if (profile.runner === "mock") return template;
  return template
    .replace("{{model}}", JSON.stringify(profile.model))
    .replace("{{reasoningEffort}}", JSON.stringify(profile.reasoningEffort));
}

function readDefault(relativePath: string): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDirectory, "..", "defaults", relativePath),
    resolve(moduleDirectory, "..", "..", "defaults", relativePath),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) {
    throw new SkillbenchError(`Packaged initialization default is missing: ${relativePath}`, {
      code: "CLI_INIT_DEFAULT_MISSING",
    });
  }
  return readFileSync(path, "utf8");
}

function updateGitignore(root: string): {
  path: string;
  status: "created" | "updated" | "unchanged";
} {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) {
    writeFileSync(path, `${STATE_IGNORE_RULE}\n`, "utf8");
    return { path, status: "created" };
  }
  const current = readFileSync(path, "utf8");
  const rules = current.split(/\r?\n/u).map((line) => line.trim());
  if (rules.includes(STATE_IGNORE_RULE) || rules.includes(".skillbench")) {
    return { path, status: "unchanged" };
  }
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${separator}${STATE_IGNORE_RULE}\n`, "utf8");
  return { path, status: "updated" };
}
