import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryRoot = mkdtempSync(join(tmpdir(), "skillbench-cli-package-"));
const projectRoot = join(temporaryRoot, "project");
const consumerRoot = projectRoot;
const skillRoot = join(projectRoot, "skill");
const forbiddenPromptfooRoot = join(temporaryRoot, "outside-project-promptfoo");
const forbiddenHome = join(temporaryRoot, "sentinel-home");
const explicitCliTarball = process.env.SKILLBENCH_CLI_TARBALL;
if (explicitCliTarball === undefined) {
  throw new Error("SKILLBENCH_CLI_TARBALL is required; run the root smoke:release task");
}
const cliTarball = resolve(explicitCliTarball);
const npmExecutable =
  process.env.SKILLBENCH_NPM_EXECUTABLE ?? (process.platform === "win32" ? "npm.cmd" : "npm");
const npxExecutable =
  process.env.SKILLBENCH_NPX_EXECUTABLE ?? (process.platform === "win32" ? "npx.cmd" : "npx");

function npm(arguments_, cwd) {
  execFileSync(npmExecutable, arguments_, { cwd, env: process.env, stdio: "inherit" });
}

function runCli(arguments_) {
  return execFileSync(npxExecutable, ["--no-install", "skillbench", ...arguments_], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      HOME: forbiddenHome,
      USERPROFILE: forbiddenHome,
      XDG_CACHE_HOME: join(forbiddenHome, ".cache"),
      XDG_CONFIG_HOME: join(forbiddenHome, ".config"),
      XDG_DATA_HOME: join(forbiddenHome, ".local", "share"),
      XDG_STATE_HOME: join(forbiddenHome, ".local", "state"),
      PROMPTFOO_CONFIG_DIR: forbiddenPromptfooRoot,
      PROMPTFOO_CACHE_PATH: join(forbiddenPromptfooRoot, "cache"),
      PROMPTFOO_LOG_DIR: join(forbiddenPromptfooRoot, "logs"),
      npm_config_cache: join(temporaryRoot, "npm-cache"),
    },
    encoding: "utf8",
  });
}

function runConsumerModule(source) {
  return execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: consumerRoot,
    env: process.env,
    encoding: "utf8",
  });
}

try {
  mkdirSync(consumerRoot, { recursive: true });
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "skillbench-cli-consumer", private: true }, null, 2)}\n`,
  );
  writeFileSync(
    join(skillRoot, "SKILL.md"),
    "---\nname: package-smoke\ndescription: External CLI package smoke fixture.\n---\n",
  );

  if (!existsSync(cliTarball)) {
    throw new Error(`SKILLBENCH_CLI_TARBALL does not exist: ${cliTarball}`);
  }
  npm(["install", "--ignore-scripts", "--package-lock=false", cliTarball], consumerRoot);

  const publicContract = JSON.parse(
    runConsumerModule(`
      const contracts = await import("@thisisjuke/skillbench/contracts");
      const bundles = await import("@thisisjuke/skillbench/contracts/bundles");
      const cliPath = await import("@thisisjuke/skillbench/cli-path");
      process.stdout.write(JSON.stringify({
        operations: contracts.SKILLBENCH_OPERATIONS,
        source: contracts.sourceProviderIdSchema.parse("github"),
        rejectsBundle: bundles.skillbenchBundleManifestSchema.safeParse({}).success === false,
        cliPath: cliPath.resolveSkillbenchCliPath(),
      }));
    `),
  );
  if (
    publicContract.operations?.join(",") !== "inspect,eval,compare,merge" ||
    publicContract.source !== "github" ||
    publicContract.rejectsBundle !== true ||
    !existsSync(publicContract.cliPath)
  ) {
    throw new Error(`Packaged CLI public contract is invalid: ${JSON.stringify(publicContract)}`);
  }

  const help = runCli(["--help"]);
  if (!help.includes("inspect") || help.includes("source add")) {
    throw new Error("Packaged CLI exposes an unexpected command surface");
  }
  const inspected = JSON.parse(runCli(["inspect", skillRoot, "--json", "--no-input"]));
  if (inspected.command !== "inspect" || inspected.data.name !== "package-smoke") {
    throw new Error(`Unexpected packaged CLI inspect result: ${JSON.stringify(inspected)}`);
  }
  const events = runCli(["inspect", skillRoot, "--jsonl", "--no-input"])
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (events[0]?.event !== "started" || events.at(-1)?.event !== "completed") {
    throw new Error(`Unexpected packaged CLI JSONL stream: ${JSON.stringify(events)}`);
  }
  runCli(["init", "--no-input"]);
  writeFileSync(
    join(projectRoot, ".skillbench", "evals", "development", "example.yaml"),
    [
      "id: package-smoke",
      "name: Packaged Promptfoo smoke",
      "partition: development",
      "prompt: Return any output.",
      "assertions:",
      "  - type: exit-code",
      "    value: 0",
      "  - type: promptfoo",
      "    assertion:",
      "      type: not-contains",
      "      value: forbidden-package-smoke-value",
      "",
    ].join("\n"),
  );
  const evaluated = JSON.parse(
    runCli([
      "--runner",
      "mock",
      "--no-input",
      "--yes",
      "eval",
      skillRoot,
      "--evals",
      ".skillbench/evals/development",
      "--repeat",
      "1",
      "--json",
    ]),
  );
  const promptfooAssertion = evaluated.data.attempts[0]?.assertions?.find(
    (assertion) => assertion.type === "promptfoo",
  );
  if (promptfooAssertion?.evidence?.engine !== "promptfoo") {
    throw new Error("Packaged CLI did not execute its embedded Promptfoo assertion engine");
  }
  const localComparison = JSON.parse(
    runCli([
      "--runner",
      "mock",
      "--no-input",
      "--yes",
      "compare",
      skillRoot,
      skillRoot,
      "--evals",
      ".skillbench/evals/development",
      "--repeat",
      "1",
      "--json",
    ]),
  );
  if (localComparison.data?.verdict?.winner !== "tie") {
    throw new Error("Packaged CLI could not compare two local skills");
  }
  if (process.env.SKILLBENCH_SKIP_GITHUB_SMOKE !== "1") {
    const githubComparison = JSON.parse(
      runCli([
        "--runner",
        "mock",
        "--no-input",
        "--yes",
        "compare",
        skillRoot,
        "https://github.com/openai/skills/tree/main/skills/.system/skill-creator",
        "--evals",
        ".skillbench/evals/development",
        "--repeat",
        "1",
        "--json",
      ]),
    );
    if (
      githubComparison.data?.report?.payload?.sourceB?.repository?.owner !== "openai" ||
      githubComparison.data?.report?.payload?.sourceB?.repository?.resolvedCommit === undefined
    ) {
      throw new Error("Packaged CLI could not compare a local skill with a GitHub HTTPS source");
    }
  }
  if (existsSync(forbiddenPromptfooRoot) || existsSync(forbiddenHome)) {
    throw new Error("Packaged CLI allowed product state to escape the project");
  }
  runCli(["inspect", skillRoot, "--output", "portable-result", "--no-input"]);
  const manifest = JSON.parse(
    readFileSync(join(projectRoot, "portable-result", "manifest.json"), "utf8"),
  );
  if (manifest.kind !== "skillbench-bundle" || manifest.status !== "complete") {
    throw new Error("Packaged CLI did not write a complete bundle");
  }
  const manifestPackage = JSON.parse(
    readFileSync(
      join(consumerRoot, "node_modules", "@thisisjuke", "skillbench", "package.json"),
      "utf8",
    ),
  );
  if (
    Object.values(manifestPackage.devDependencies ?? {}).some(
      (specifier) => typeof specifier === "string" && specifier.startsWith("workspace:"),
    )
  ) {
    throw new Error("Packaged CLI leaked a workspace protocol into its manifest");
  }
  for (const declaration of [
    "dist/cli-path.d.mts",
    "dist/contracts/index.d.mts",
    "dist/contracts/bundles.d.mts",
  ]) {
    const content = readFileSync(
      join(consumerRoot, "node_modules", "@thisisjuke", "skillbench", declaration),
      "utf8",
    );
    if (content.includes("@skillbench/")) {
      throw new Error(`Packaged public declaration leaks a private import: ${declaration}`);
    }
  }
  if (
    manifestPackage.engines?.bun !== undefined ||
    manifestPackage.dependencies?.["drizzle-orm"] !== undefined
  ) {
    throw new Error("Packaged CLI declares Bun or Drizzle as a direct runtime dependency");
  }
  if (
    Object.keys(manifestPackage.dependencies ?? {}).some((name) =>
      name.startsWith("@skillbench/"),
    ) ||
    existsSync(join(consumerRoot, "node_modules", "@skillbench")) ||
    !existsSync(join(consumerRoot, "node_modules", "promptfoo"))
  ) {
    throw new Error("Packaged CLI leaked an internal package or omitted Promptfoo");
  }
  process.stdout.write(
    `One-install CLI local${process.env.SKILLBENCH_SKIP_GITHUB_SMOKE === "1" ? "" : "/GitHub"} compare, Promptfoo, JSONL and bundle smoke passed under Node.\n`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
