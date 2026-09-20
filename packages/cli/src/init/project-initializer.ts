import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SkillbenchError } from "@skillbench/sdk/errors";

import type { RunnerChoice } from "../composition/runner-registry";
import { DEFAULT_RUNS_DIRECTORY } from "../config";
import { findProjectConfig } from "../project";

const GENERATED_IGNORE_RULES = [
  ".skillbench/runs/",
  ".skillbench/tmp/",
  ".skillbench/promptfoo/",
  ".skillbench/cli-history.json",
  ".skillbench/web/",
  ".skillbench/skillbench-web.sqlite",
] as const;

export const INITIALIZED_PROJECT_FILES = Object.freeze([
  {
    path: ".skillbench/config.yaml",
    description: "Project runner, evaluation, and output settings.",
  },
  {
    path: ".skillbench/evals/development/default.yaml",
    description: "The runnable starter development evaluation used by default.",
  },
  {
    path: ".skillbench/evals/examples/example.yaml",
    description: "A richer reference evaluation that is not run by default.",
  },
  {
    path: ".skillbench/assets.yaml",
    description: "The validated map of editable runtime instruction assets.",
  },
  {
    path: ".skillbench/prompts/judge/SKILL.md",
    description: "The local skill used for qualitative blind judging.",
  },
  {
    path: ".skillbench/reports/comparison.md",
    description: "The editable Markdown template used by comparison reports.",
  },
  {
    path: ".skillbench/templates/merge-candidate.md",
    description: "The template used to render generated merge candidates.",
  },
  {
    path: ".gitignore",
    description: "Preserves existing rules and ignores generated Skillbench state.",
  },
] as const);

const PROJECT_TEMPLATES = [
  {
    target: ".skillbench/evals/development/default.yaml",
    source: "evals/development/default.yaml",
  },
  {
    target: ".skillbench/evals/examples/example.yaml",
    source: "evals/examples/example.yaml",
  },
  { target: ".skillbench/assets.yaml", source: "skillbench/assets.yaml" },
  {
    target: ".skillbench/prompts/judge/SKILL.md",
    source: "skillbench/prompts/judge/SKILL.md",
  },
  {
    target: ".skillbench/reports/comparison.md",
    source: "skillbench/reports/comparison.md",
  },
  {
    target: ".skillbench/templates/merge-candidate.md",
    source: "skillbench/templates/merge-candidate.md",
  },
] as const;

export type InitResult = {
  created: string[];
  updated: string[];
  unchanged: string[];
  runner: RunnerChoice["runner"];
  profile: RunnerChoice;
  outputsDirectory: string;
};

export type InitializeProjectOptions = {
  force?: boolean;
  profile?: RunnerChoice;
  outputsDirectory?: string;
};

export function shouldRecommendInitialization(cwd: string): boolean {
  return findProjectConfig(cwd) === undefined;
}

export function initializedProjectConflicts(cwd: string): string[] {
  const root = resolve(cwd);
  return [".skillbench/config.yaml", ...PROJECT_TEMPLATES.map(({ target }) => target)]
    .map((path) => join(root, ...path.split("/")))
    .filter((path) => existsSync(path));
}

export function initializeProject(
  cwd: string,
  options: InitializeProjectOptions = {},
): InitResult {
  const root = resolve(cwd);
  const profile = options.profile ?? { runner: "mock" };
  const outputsDirectory = options.outputsDirectory ?? DEFAULT_RUNS_DIRECTORY;
  const files = [
    {
      path: join(root, ".skillbench", "config.yaml"),
      content: renderConfig(profile, outputsDirectory),
    },
    ...PROJECT_TEMPLATES.map(({ target, source }) => ({
      path: join(root, ...target.split("/")),
      content: readDefault(join("project", ...source.split("/"))),
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
    outputsDirectory,
  };
}

function renderConfig(profile: RunnerChoice, outputsDirectory: string): string {
  const template = readDefault(join("config", `${profile.runner}.yaml`));
  return template
    .replace("{{outputsDirectory}}", JSON.stringify(outputsDirectory))
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
    writeFileSync(path, `${GENERATED_IGNORE_RULES.join("\n")}\n`, "utf8");
    return { path, status: "created" };
  }
  const current = readFileSync(path, "utf8");
  const rules = current.split(/\r?\n/u).map((line) => line.trim());
  const missing = GENERATED_IGNORE_RULES.filter((rule) => !rules.includes(rule));
  if (missing.length === 0) return { path, status: "unchanged" };
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${separator}${missing.join("\n")}\n`, "utf8");
  return { path, status: "updated" };
}
