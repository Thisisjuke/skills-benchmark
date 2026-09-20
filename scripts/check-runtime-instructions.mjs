import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = readdirSync(resolve(workspaceRoot, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(workspaceRoot, "packages", entry.name, "src"))
  .filter(existsSync);
const expectedAssets = [
  "skillbench/prompts/judge/SKILL.md",
  "skillbench/templates/merge-candidate.md",
];
const literalAssignment =
  /\b(?:(?:[A-Za-z0-9_]*(?:Prompt|Instruction|Rubric|Template)|[A-Z0-9_]+_(?:PROMPT|INSTRUCTION|RUBRIC|TEMPLATE|SYSTEM_MESSAGE))\s*=|(?:prompt|instruction|rubric|template|systemMessage|systemPrompt)\s*:)\s*([`"'])/gu;

let failed = false;

for (const sourceRoot of sourceRoots) {
  for (const file of sourceFiles(sourceRoot)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(literalAssignment)) {
      const before = content.slice(0, match.index);
      const line = before.split("\n").length;
      fail(
        `${relative(workspaceRoot, file)}:${line} embeds a model-facing prompt, instruction, rubric, or template literal`,
      );
    }
  }
}

const defaultsRoot = resolve(workspaceRoot, "packages/cli/defaults/project");
for (const asset of expectedAssets) {
  const path = resolve(defaultsRoot, asset);
  if (!existsSync(path) || readFileSync(path, "utf8").trim() === "") {
    fail(`required project instruction asset is missing or empty: ${relative(workspaceRoot, path)}`);
  }
}
const manifest = readFileSync(resolve(defaultsRoot, "skillbench/assets.yaml"), "utf8");
for (const asset of expectedAssets) {
  const manifestPath = asset.replace(/^skillbench\//u, "");
  if (!manifest.includes(manifestPath)) {
    fail(`instruction asset manifest does not reference ${manifestPath}`);
  }
}

if (!failed) {
  process.stdout.write("Runtime instructions are explicit project assets.\n");
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if ([".ts", ".tsx", ".mts", ".cts"].includes(extname(path))) files.push(path);
  }
  return files;
}

function fail(message) {
  process.stderr.write(`runtime instruction violation: ${message}\n`);
  failed = true;
  process.exitCode = 1;
}
