import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporaryRoot = mkdtempSync(join(tmpdir(), "skillbench-web-package-"));
const projectRoot = join(temporaryRoot, "project");
const consumerRoot = projectRoot;
const skillRoot = join(projectRoot, "skill");
const explicitCliTarball = process.env.SKILLBENCH_CLI_TARBALL;
const explicitWebTarball = process.env.SKILLBENCH_WEB_TARBALL;
if (explicitCliTarball === undefined || explicitWebTarball === undefined) {
  throw new Error(
    "SKILLBENCH_CLI_TARBALL and SKILLBENCH_WEB_TARBALL are required; run the root smoke:release task",
  );
}
const cliTarball = resolve(explicitCliTarball);
const webTarball = resolve(explicitWebTarball);
const npmExecutable =
  process.env.SKILLBENCH_NPM_EXECUTABLE ?? (process.platform === "win32" ? "npm.cmd" : "npm");
const npxExecutable =
  process.env.SKILLBENCH_NPX_EXECUTABLE ?? (process.platform === "win32" ? "npx.cmd" : "npx");
const activeServers = new Set();

function npm(arguments_, cwd) {
  execFileSync(npmExecutable, arguments_, { cwd, env: process.env, stdio: "inherit" });
}

function probeNpxEntrypoint() {
  const output = execFileSync(npxExecutable, ["--no-install", "skillbench-web", "--help"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      npm_config_cache: join(temporaryRoot, "npm-cache"),
    },
    encoding: "utf8",
  });
  if (!output.includes("--project") || !output.includes("--port")) {
    throw new Error("Packaged Web NPX entrypoint exposes an unexpected command surface");
  }
}

async function startServer() {
  const executable = join(
    consumerRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "skillbench-web.cmd" : "skillbench-web",
  );
  const child = spawn(
    executable,
    ["--project", projectRoot, "--port", "0", "--no-open"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        npm_config_cache: join(temporaryRoot, "npm-cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeServers.add(child);
  child.once("close", () => activeServers.delete(child));
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const url = await waitFor(
    async () => stdout.match(/Skillbench Web: (http:\/\/127\.0\.0\.1:\d+)/u)?.[1],
  );
  if (url === undefined) throw new Error(`Packaged Web server did not start: ${stderr}`);
  return { child, url };
}

async function stopServer(child) {
  const closed = new Promise((resolveClose) => child.once("close", resolveClose));
  child.kill("SIGTERM");
  await Promise.race([
    closed,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Web server did not stop")), 5_000),
    ),
  ]);
}

async function waitFor(read) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const value = await read();
    if (value !== undefined && value !== false) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return undefined;
}

try {
  mkdirSync(consumerRoot, { recursive: true });
  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "skillbench-web-consumer",
        private: true,
        overrides: { "@thisisjuke/skillbench": `file:${cliTarball}` },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(skillRoot, "SKILL.md"),
    "---\nname: web-package-smoke\ndescription: External Web package smoke fixture.\n---\n",
  );

  if (!existsSync(cliTarball)) {
    throw new Error(`SKILLBENCH_CLI_TARBALL does not exist: ${cliTarball}`);
  }
  if (!existsSync(webTarball)) {
    throw new Error(`SKILLBENCH_WEB_TARBALL does not exist: ${webTarball}`);
  }
  npm(["install", "--package-lock=false", webTarball], consumerRoot);
  probeNpxEntrypoint();

  const first = await startServer();
  const health = await fetch(`${first.url}/api/health`).then((response) => response.json());
  if (health.status !== "ok") throw new Error("Packaged Web health check failed");
  const indexResponse = await fetch(first.url);
  const index = await indexResponse.text();
  if (!indexResponse.ok || !index.includes('<div id="root"></div>')) {
    throw new Error("Packaged Web client entrypoint is missing");
  }
  const assetPath = index.match(/(?:src|href)="(\/assets\/[^"]+)"/u)?.[1];
  if (assetPath === undefined) throw new Error("Packaged Web client asset is missing from HTML");
  const assetResponse = await fetch(`${first.url}${assetPath}`);
  if (!assetResponse.ok) throw new Error("Packaged Web client asset could not be loaded");
  const created = await fetch(`${first.url}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "inspect", source: "./skill" }),
  }).then((response) => response.json());
  const completed = await waitFor(async () => {
    const payload = await fetch(`${first.url}/api/jobs/${created.job.id}`).then((response) =>
      response.json(),
    );
    return payload.job.status === "completed" || payload.job.status === "failed" ? payload : false;
  });
  if (completed?.job?.status !== "completed") {
    throw new Error(`Packaged Web job failed: ${JSON.stringify(completed)}`);
  }
  await stopServer(first.child);

  const second = await startServer();
  const persisted = await fetch(`${second.url}/api/jobs/${created.job.id}`).then((response) =>
    response.json(),
  );
  if (persisted.job.status !== "completed")
    throw new Error("Completed job did not survive restart");
  await stopServer(second.child);

  const installedManifest = JSON.parse(
    readFileSync(
      join(consumerRoot, "node_modules", "@thisisjuke", "skillbench-web", "package.json"),
      "utf8",
    ),
  );
  if (installedManifest.bin?.["skillbench-web"] !== "./dist/server.mjs") {
    throw new Error("Packaged Web binary is missing");
  }
  if (
    Object.values(installedManifest.dependencies ?? {}).some(
      (specifier) => typeof specifier === "string" && specifier.startsWith("workspace:"),
    )
  ) {
    throw new Error("Packaged Web leaked a workspace protocol into its manifest");
  }
  if (
    !existsSync(
      join(
        consumerRoot,
        "node_modules",
        "@thisisjuke",
        "skillbench-web",
        "drizzle",
        "meta",
        "_journal.json",
      ),
    )
  ) {
    throw new Error("Packaged Web migrations are missing");
  }
  if (
    Object.keys(installedManifest.dependencies ?? {}).some((name) =>
      name.startsWith("@skillbench/"),
    ) ||
    existsSync(join(consumerRoot, "node_modules", "@skillbench"))
  ) {
    throw new Error("Packaged Web leaked a private workspace package");
  }
  process.stdout.write("Product-only Web/CLI/persistence/restart smoke passed under Node.\n");
} finally {
  for (const child of activeServers) child.kill("SIGKILL");
  rmSync(temporaryRoot, { recursive: true, force: true });
}
