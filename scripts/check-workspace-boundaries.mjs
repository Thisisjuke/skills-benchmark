import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const dependencyGroups = {
  terminal: ["@clack/prompts", "commander"],
  github: ["@octokit/request"],
  process: ["execa"],
  assertions: ["promptfoo"],
  web: [
    "@base-ui/react",
    "@hono/node-server",
    "@hono/zod-validator",
    "@tanstack/react-query",
    "better-sqlite3",
    "drizzle-kit",
    "drizzle-orm",
    "hono",
    "react",
    "react-dom",
  ],
};

const products = {
  invocationContract: {
    path: "packages/invocation-contract",
    name: "@skillbench/invocation-contract",
    allowedInternalDependencies: [],
    forbiddenDependencyGroups: ["terminal", "github", "process", "assertions", "web"],
  },
  sdk: {
    path: "packages/sdk",
    name: "@skillbench/sdk",
    allowedInternalDependencies: ["invocationContract"],
    forbiddenDependencyGroups: ["terminal", "github", "assertions", "web"],
  },
  assertionsPromptfoo: {
    path: "packages/assertions-promptfoo",
    name: "@skillbench/assertions-promptfoo",
    allowedInternalDependencies: ["sdk", "testContracts"],
    forbiddenDependencyGroups: ["terminal", "github", "web"],
  },
  runnerKit: {
    path: "packages/runner-kit",
    name: "@skillbench/runner-kit",
    allowedInternalDependencies: ["sdk"],
    forbiddenDependencyGroups: ["terminal", "github", "assertions", "web"],
  },
  runnerCodex: {
    path: "packages/runner-codex",
    name: "@skillbench/runner-codex",
    allowedInternalDependencies: ["invocationContract", "sdk", "runnerKit", "testContracts"],
    forbiddenDependencyGroups: ["terminal", "github", "assertions", "web"],
  },
  runnerClaude: {
    path: "packages/runner-claude",
    name: "@skillbench/runner-claude",
    allowedInternalDependencies: ["invocationContract", "sdk", "runnerKit", "testContracts"],
    forbiddenDependencyGroups: ["terminal", "github", "assertions", "web"],
  },
  runnerOpenCode: {
    path: "packages/runner-opencode",
    name: "@skillbench/runner-opencode",
    allowedInternalDependencies: ["invocationContract", "sdk", "runnerKit", "testContracts"],
    forbiddenDependencyGroups: ["terminal", "github", "assertions", "web"],
  },
  sourceGithub: {
    path: "packages/source-github",
    name: "@skillbench/source-github",
    allowedInternalDependencies: ["sdk", "testContracts"],
    forbiddenDependencyGroups: ["terminal", "assertions", "web"],
  },
  testContracts: {
    path: "packages/test-contracts",
    name: "@skillbench/test-contracts",
    allowedInternalDependencies: ["invocationContract", "sdk"],
    forbiddenDependencyGroups: ["terminal", "github", "process", "assertions", "web"],
  },
  cli: {
    path: "packages/cli",
    name: "@thisisjuke/skillbench",
    allowedInternalDependencies: [
      "sdk",
      "invocationContract",
      "assertionsPromptfoo",
      "runnerClaude",
      "runnerCodex",
      "runnerOpenCode",
      "sourceGithub",
      "testContracts",
    ],
    forbiddenDependencyGroups: ["web"],
  },
  web: {
    path: "apps/web",
    name: "@thisisjuke/skillbench-web",
    allowedInternalDependencies: ["cli"],
    forbiddenDependencyGroups: [],
  },
};

const webPublicCliImports = new Set([
  "@thisisjuke/skillbench/cli-path",
  "@thisisjuke/skillbench/contracts",
  "@thisisjuke/skillbench/contracts/bundles",
]);
const workspaceProtocol = "workspace:*";

function fail(message) {
  process.stderr.write(`workspace boundary violation: ${message}\n`);
  process.exitCode = 1;
}

function readManifest(path) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, path, "package.json"), "utf8"));
}

function packageNameFromSpecifier(specifier) {
  if (!specifier.startsWith("@")) return specifier.split("/", 1)[0];
  return specifier.split("/", 2).join("/");
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if ([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].includes(extname(path))) {
      files.push(path);
    }
  }
  return files;
}

const rootManifest = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const changesetsConfig = JSON.parse(
  readFileSync(resolve(workspaceRoot, ".changeset", "config.json"), "utf8"),
);
if (!existsSync(resolve(workspaceRoot, "README.md"))) {
  fail("workspace root must contain README.md");
}
const expectedWorkspaces = ["apps/*", "packages/*"];
const actualWorkspaces = [...(rootManifest.workspaces ?? [])].sort();
if (JSON.stringify(actualWorkspaces) !== JSON.stringify(expectedWorkspaces)) {
  fail(`root workspaces must be ${expectedWorkspaces.join(", ")}`);
}

const manifests = Object.fromEntries(
  Object.entries(products).map(([key, product]) => [key, readManifest(product.path)]),
);
const publicProductNames = [products.cli.name, products.web.name].sort();
const fixedReleaseGroups = (changesetsConfig.fixed ?? []).map((group) => [...group].sort());
if (
  fixedReleaseGroups.length !== 1 ||
  JSON.stringify(fixedReleaseGroups[0]) !== JSON.stringify(publicProductNames)
) {
  fail("Changesets must contain one fixed release group with the CLI and Web products");
}
if (
  changesetsConfig.privatePackages?.version !== false ||
  changesetsConfig.privatePackages?.tag !== false
) {
  fail("Changesets must exclude private workspaces from versioning and tagging");
}
if (changesetsConfig.access !== "public" || changesetsConfig.baseBranch !== "main") {
  fail("Changesets must target public packages from the main branch");
}
const productKeysByName = new Map(
  Object.entries(products).map(([key, product]) => [product.name, key]),
);
const declaredPaths = new Set(Object.values(products).map((product) => product.path));
for (const parent of ["apps", "packages"]) {
  if (!existsSync(resolve(workspaceRoot, parent))) continue;
  for (const entry of readdirSync(resolve(workspaceRoot, parent), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `${parent}/${entry.name}`;
    if (!existsSync(resolve(workspaceRoot, path, "package.json"))) continue;
    if (!declaredPaths.has(path))
      fail(`workspace package ${path} is missing from the boundary graph`);
  }
}

for (const [key, product] of Object.entries(products)) {
  const manifest = manifests[key];
  if (!existsSync(resolve(workspaceRoot, product.path, "README.md"))) {
    fail(`${product.path} must contain README.md`);
  }
  if (manifest.name !== product.name) fail(`${product.path} must be named ${product.name}`);
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const group of product.forbiddenDependencyGroups) {
    for (const dependency of dependencyGroups[group]) {
      if (dependency in dependencies) fail(`${product.name} must not depend on ${dependency}`);
    }
  }
  for (const dependency of Object.keys(dependencies)) {
    const dependencyKey = productKeysByName.get(dependency);
    if (dependencyKey !== undefined && dependencies[dependency] !== workspaceProtocol) {
      fail(`${product.name} must declare internal dependency ${dependency} as ${workspaceProtocol}`);
    }
    if (
      dependencyKey !== undefined &&
      !product.allowedInternalDependencies.includes(dependencyKey)
    ) {
      fail(`${product.name} has an undeclared internal dependency on ${dependency}`);
    }
  }

  const packageRoot = resolve(workspaceRoot, product.path);
  const checkedFiles = [
    ...sourceFiles(resolve(packageRoot, "src")),
    ...sourceFiles(resolve(packageRoot, "tests")),
  ];
  for (const file of checkedFiles) {
    const content = readFileSync(file, "utf8");
    if ((key === "sdk" || key === "cli") && /(?:\bBun\b|["']bun:)/u.test(content)) {
      fail(`${relative(workspaceRoot, file)} uses a Bun runtime API inside ${product.name}`);
    }
    const relativeFile = relative(packageRoot, file);
    if (
      key === "cli" &&
      relativeFile.startsWith(`src${sep}application${sep}`) &&
      /(?:from\s+|import\s*\()\s*["'](?:commander|@clack\/prompts|\.\.\/cli(?:\/|["']))/u.test(
        content,
      )
    ) {
      fail(`${relative(workspaceRoot, file)} crosses from application into the terminal layer`);
    }
    if (
      key === "cli" &&
      relativeFile.startsWith(`src${sep}cli${sep}commands${sep}`) &&
      /\bnew\s+(?:EvaluationService|ComparisonService|ComparisonReportService|MergePlanningService|MergeGenerationService|DevelopmentTournamentService)\b|\b(?:loadEvalSuite|createRunnerPermissions|inspectSkill)\s*\(/u.test(
        content,
      )
    ) {
      fail(`${relative(workspaceRoot, file)} contains application orchestration in a CLI handler`);
    }
    if (
      key === "cli" &&
      relativeFile.startsWith(`src${sep}cli${sep}renderers${sep}`) &&
      /(?:writeJson|writeJsonl|CliJsonlWriter|process\.stdout|command-context|\.\.\/options)/u.test(
        content,
      )
    ) {
      fail(`${relative(workspaceRoot, file)} crosses from human rendering into machine output`);
    }
    const specifiers = content.matchAll(
      /(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/g,
    );
    for (const match of specifiers) {
      const specifier = match[1];
      if (!specifier) continue;
      const importedPackageName = packageNameFromSpecifier(specifier);
      const importedKey = productKeysByName.get(importedPackageName);
      if (importedKey !== undefined) {
        if (importedKey !== key && !(importedPackageName in dependencies)) {
          fail(
            `${relative(workspaceRoot, file)} imports undeclared workspace package ${importedPackageName}`,
          );
        }
        const exportKey =
          specifier === importedPackageName
            ? "."
            : `.${specifier.slice(importedPackageName.length)}`;
        if (manifests[importedKey].exports?.[exportKey] === undefined) {
          fail(
            `${relative(workspaceRoot, file)} imports unexported workspace subpath ${specifier}`,
          );
        }
      }
      if (
        (key === "cli" ||
          key === "assertionsPromptfoo" ||
          key === "runnerKit" ||
          key === "runnerClaude" ||
          key === "runnerCodex" ||
          key === "runnerOpenCode" ||
          key === "sourceGithub" ||
          key === "testContracts") &&
        specifier === "@skillbench/sdk"
      ) {
        fail(
          `${relative(workspaceRoot, file)} imports the SDK root barrel instead of a public subpath`,
        );
      }
      if (/^(?:@skillbench\/sdk|@thisisjuke\/skillbench)\/src(?:\/|$)/.test(specifier)) {
        fail(`${relative(workspaceRoot, file)} imports a private package path: ${specifier}`);
      }
      if (key === "web" && specifier.startsWith("@skillbench/")) {
        fail(`${relative(workspaceRoot, file)} imports private workspace package ${specifier}`);
      }
      if (
        key === "web" &&
        specifier.startsWith("@thisisjuke/skillbench/") &&
        !webPublicCliImports.has(specifier)
      ) {
        fail(`${relative(workspaceRoot, file)} imports unsupported CLI subpath ${specifier}`);
      }
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier);
      if (target !== packageRoot && !target.startsWith(`${packageRoot}${sep}`)) {
        fail(`${relative(workspaceRoot, file)} escapes its package with ${specifier}`);
      }
    }
  }
}

for (const key of [
  "assertionsPromptfoo",
  "runnerKit",
  "runnerClaude",
  "runnerCodex",
  "runnerOpenCode",
  "sourceGithub",
  "testContracts",
]) {
  if (manifests[key].dependencies?.["@skillbench/sdk"] !== workspaceProtocol) {
    fail(`${products[key].name} must depend on the local @skillbench/sdk workspace`);
  }
}
if (manifests.cli.devDependencies?.[products.sdk.name] !== workspaceProtocol) {
  fail("@thisisjuke/skillbench must build against the private SDK workspace");
}
if (manifests.cli.dependencies?.[products.sdk.name] !== undefined) {
  fail("@thisisjuke/skillbench must bundle the private SDK");
}
for (const key of ["runnerClaude", "runnerCodex", "runnerOpenCode"]) {
  if (manifests[key].devDependencies?.[products.runnerKit.name] !== workspaceProtocol) {
    fail(
      `${products[key].name} must build against the local ${products.runnerKit.name} workspace`,
    );
  }
  if (manifests[key].dependencies?.[products.runnerKit.name] !== undefined) {
    fail(
      `${products[key].name} must bundle private ${products.runnerKit.name}, not publish it as a runtime dependency`,
    );
  }
}
for (const key of [
  "assertionsPromptfoo",
  "runnerClaude",
  "runnerCodex",
  "runnerOpenCode",
  "sourceGithub",
]) {
  if (manifests.cli.devDependencies?.[products[key].name] !== workspaceProtocol) {
    fail(`@thisisjuke/skillbench must build against local ${products[key].name}`);
  }
  if (manifests.cli.dependencies?.[products[key].name] !== undefined) {
    fail(`@thisisjuke/skillbench must bundle private ${products[key].name}`);
  }
}
const promptfooVersion = manifests.assertionsPromptfoo.dependencies?.promptfoo;
if (typeof promptfooVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(promptfooVersion)) {
  fail("@skillbench/assertions-promptfoo must pin an exact Promptfoo version");
}
if (manifests.cli.dependencies?.promptfoo !== promptfooVersion) {
  fail("@thisisjuke/skillbench and its assertion adapter must use the same Promptfoo version");
}
for (const key of [
  "assertionsPromptfoo",
  "runnerClaude",
  "runnerCodex",
  "runnerOpenCode",
  "sourceGithub",
]) {
  if (
    manifests[key].devDependencies?.["@skillbench/test-contracts"] !== workspaceProtocol
  ) {
    fail(
      `${products[key].name} must test against the local @skillbench/test-contracts workspace`,
    );
  }
}
for (const key of [
  "invocationContract",
  "sdk",
  "assertionsPromptfoo",
  "runnerKit",
  "runnerClaude",
  "runnerCodex",
  "runnerOpenCode",
  "sourceGithub",
  "testContracts",
]) {
  if (manifests[key].private !== true) fail(`${products[key].name} must remain private`);
  if (manifests[key].publishConfig !== undefined) {
    fail(`${products[key].name} must not declare publishConfig`);
  }
}
for (const key of ["sdk", "runnerClaude", "runnerCodex", "runnerOpenCode", "testContracts"]) {
  if (
    manifests[key].dependencies?.[products.invocationContract.name] !== workspaceProtocol
  ) {
    fail(
      `${products[key].name} must depend on the local ${products.invocationContract.name} workspace`,
    );
  }
}
if (
  manifests.cli.devDependencies?.[products.invocationContract.name] !== workspaceProtocol
) {
  fail(`@thisisjuke/skillbench must build against local ${products.invocationContract.name}`);
}
if (manifests.cli.dependencies?.[products.invocationContract.name] !== undefined) {
  fail(`@thisisjuke/skillbench must bundle private ${products.invocationContract.name}`);
}
for (const key of ["cli", "web"].filter((key) => manifests[key] !== undefined)) {
  if (manifests[key].private === true) fail(`${products[key].name} must be publishable`);
  if (manifests[key].engines?.node !== ">=22.22.2") {
    fail(`${products[key].name} must declare the V1 Node baseline >=22.22.2`);
  }
  if (manifests[key].publishConfig?.provenance !== true) {
    fail(`${products[key].name} must request npm provenance on publication`);
  }
  if (manifests[key].publishConfig?.access !== "public") {
    fail(`${products[key].name} must publish its npm scope with public access`);
  }
  for (const field of ["license", "repository", "homepage", "bugs"]) {
    if (manifests[key][field] === undefined) {
      fail(`${products[key].name} must declare ${field} metadata`);
    }
  }
}
if (manifests.cli.version !== manifests.web.version) {
  fail("CLI and Web product versions must remain identical");
}
if (manifests.web !== undefined) {
  if (manifests.web.dependencies?.[products.cli.name] !== workspaceProtocol) {
    fail("@thisisjuke/skillbench-web must depend on the local CLI workspace");
  }
  for (const dependency of Object.keys({
    ...manifests.web.dependencies,
    ...manifests.web.devDependencies,
  })) {
    if (dependency.startsWith("@skillbench/")) {
      fail(`@thisisjuke/skillbench-web must not declare private workspace package ${dependency}`);
    }
  }
}
if (manifests.cli.bin?.skillbench !== "./dist/cli.mjs") {
  fail("the CLI workspace must reserve the skillbench binary");
}
const requiredCliExports = {
  "./cli-path": "./dist/cli-path.mjs",
  "./contracts": "./dist/contracts/index.mjs",
  "./contracts/bundles": "./dist/contracts/bundles.mjs",
  "./package.json": "./package.json",
};
for (const [subpath, target] of Object.entries(requiredCliExports)) {
  if (manifests.cli.exports?.[subpath] !== target) {
    fail(`@thisisjuke/skillbench must export ${subpath} from ${target}`);
  }
}
for (const subpath of Object.keys(manifests.cli.exports ?? {})) {
  if (!(subpath in requiredCliExports)) {
    fail(`@thisisjuke/skillbench exposes unsupported public subpath ${subpath}`);
  }
}
if (manifests.web !== undefined && manifests.web.bin?.["skillbench-web"] !== "./dist/server.mjs") {
  fail("@thisisjuke/skillbench-web must expose the skillbench-web binary");
}

if (process.exitCode === undefined) {
  process.stdout.write("Workspace boundaries are valid.\n");
}
