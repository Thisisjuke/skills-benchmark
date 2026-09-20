import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import { loadEvalSuite } from "@skillbench/sdk/evaluator";
import { createComparisonTemplateRenderer } from "@skillbench/sdk/reports";
import { parse as parseYaml } from "yaml";

import { loadProjectFileAsset } from "../assets";
import type { PromptOption, PromptSession } from "./interactive";

type EvalMetadata = { name?: unknown; partition?: unknown };

export async function chooseEvalFile(input: {
  configuredPath: string;
  partition: "development" | "holdout";
  projectRoot: string;
  session: PromptSession;
  supplied?: string | undefined;
}): Promise<string> {
  if (input.supplied !== undefined && input.supplied.trim() !== "") return input.supplied.trim();
  if (!input.session.interactive) return input.configuredPath;
  const root = resolve(input.projectRoot, ".skillbench", "evals");
  const options = discoverFiles(root, [".yaml", ".yml"])
    .map((absolutePath) => evalOption(input.projectRoot, absolutePath))
    .filter((option): option is PromptOption<string> & { partition: string } => option !== undefined)
    .filter((option) => option.partition === input.partition && !option.value.includes("/examples/"))
    .map(({ partition: _partition, ...option }) => option);
  if (options.length === 0) {
    throw new SkillbenchError(
      `No ${input.partition} eval YAML files were found under .skillbench/evals. Add one or pass --evals <file-or-directory>.`,
      { code: "CLI_EVALS_NOT_FOUND" },
    );
  }
  const initialValue = options.some((option) => option.value === input.configuredPath)
    ? input.configuredPath
    : options[0]!.value;
  if (!options.some((option) => option.value === input.configuredPath)) {
    input.session.notice(
      `Configured eval was not found: ${input.configuredPath}\nSelect an available ${input.partition} eval or update eval.path in .skillbench/config.yaml.`,
      "Configured eval unavailable",
    );
  }
  return input.session.choose(
    input.partition === "holdout"
      ? "Which holdout evaluation should be used?"
      : "Which development evaluation should be used?",
    options,
    initialValue,
  );
}

export async function chooseReportTemplate(input: {
  configuredPath: string;
  projectRoot: string;
  session: PromptSession;
  supplied?: string | undefined;
}): Promise<string> {
  if (input.supplied !== undefined && input.supplied.trim() !== "") return input.supplied.trim();
  if (!input.session.interactive) return input.configuredPath;
  const root = resolve(input.projectRoot, ".skillbench", "reports");
  const options = discoverFiles(root, [".md"]).map((absolutePath) => {
    const value = projectPath(input.projectRoot, absolutePath);
    return { value, label: heading(readFileSync(absolutePath, "utf8")) ?? value, hint: value };
  });
  if (options.length === 0) {
    throw new SkillbenchError(
      "No comparison report templates were found under .skillbench/reports. Add one or pass --report-template <path>.",
      { code: "CLI_REPORT_TEMPLATE_NOT_FOUND" },
    );
  }
  const initialValue = options.some((option) => option.value === input.configuredPath)
    ? input.configuredPath
    : options[0]!.value;
  if (!options.some((option) => option.value === input.configuredPath)) {
    input.session.notice(
      `Configured report template was not found: ${input.configuredPath}\nSelect an available template or update reports.template in .skillbench/config.yaml.`,
      "Configured report template unavailable",
    );
  }
  return input.session.choose(
    "Which comparison report template should be used?",
    options,
    initialValue,
  );
}

export function validateEvalInput(input: {
  path: string;
  partition: "development" | "holdout";
  projectRoot: string;
}): void {
  loadEvalSuite(resolve(input.projectRoot, input.path), { partition: input.partition });
}

export function validateReportTemplateInput(projectRoot: string, path: string): void {
  const template = loadProjectFileAsset(projectRoot, "comparison-template", path);
  createComparisonTemplateRenderer(template.text, template.contentHash);
}

function discoverFiles(root: string, extensions: readonly string[]): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function evalOption(
  projectRoot: string,
  absolutePath: string,
): (PromptOption<string> & { partition: string }) | undefined {
  let document: EvalMetadata;
  try {
    document = (parseYaml(readFileSync(absolutePath, "utf8")) ?? {}) as EvalMetadata;
  } catch {
    return undefined;
  }
  const value = projectPath(projectRoot, absolutePath);
  const partition =
    document.partition === "holdout" || document.partition === "development"
      ? document.partition
      : value.includes("/holdout/")
        ? "holdout"
        : "development";
  return {
    value,
    label: typeof document.name === "string" && document.name.trim() !== "" ? document.name : value,
    hint: `${partition} · ${value}`,
    partition,
  };
}

function heading(markdown: string): string | undefined {
  return markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim();
}

function projectPath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}
