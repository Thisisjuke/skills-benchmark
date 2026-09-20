import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const artifactRoot = join(workspaceRoot, "artifacts");
const artifactManifestPath = join(artifactRoot, "release-artifacts.json");
const pnpmExecutable =
  process.env.SKILLBENCH_PNPM_EXECUTABLE ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");

const products = [
  {
    id: "cli",
    root: join(workspaceRoot, "packages", "cli"),
    allowedFiles: new Set(["package.json", "README.md", "LICENSE", "skillbench.example.yaml"]),
    allowedDirectories: ["dist/", "defaults/"],
  },
  {
    id: "web",
    root: join(workspaceRoot, "apps", "web"),
    allowedFiles: new Set(["package.json", "README.md", "LICENSE"]),
    allowedDirectories: ["dist/", "drizzle/"],
  },
];

function run(executable, arguments_, options = {}) {
  return execFileSync(executable, arguments_, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...options.env },
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function inspectPack(product) {
  const output = run(pnpmExecutable, ["pack", "--dry-run", "--json"], {
    cwd: product.root,
    capture: true,
  });
  const parsed = JSON.parse(output);
  const inspection = Array.isArray(parsed) ? parsed[0] : parsed;
  const manifest = readManifest(product.root);

  if (inspection.name !== manifest.name || inspection.version !== manifest.version) {
    throw new Error(`Pack inspection does not match ${manifest.name}@${manifest.version}`);
  }
  const packedPaths = new Set();
  for (const entry of inspection.files ?? []) {
    const path = String(entry.path).replaceAll("\\", "/");
    packedPaths.add(path);
    const allowed =
      product.allowedFiles.has(path) ||
      product.allowedDirectories.some((directory) => path.startsWith(directory));
    if (!allowed) {
      throw new Error(`${manifest.name} contains a release-unrelated file: ${path}`);
    }
  }
  if ((inspection.files ?? []).length === 0) {
    throw new Error(`${manifest.name} pack inspection returned no files`);
  }
  if (!packedPaths.has("LICENSE")) {
    throw new Error(`${manifest.name} pack is missing its LICENSE`);
  }

  return { inspection, manifest };
}

function pack(product, inspection) {
  run(pnpmExecutable, ["pack", "--pack-destination", artifactRoot], { cwd: product.root });
  const tarballPath = join(artifactRoot, inspection.filename);
  if (!existsSync(tarballPath) || statSync(tarballPath).size === 0) {
    throw new Error(`Expected tarball was not created: ${tarballPath}`);
  }
  sanitizePackedManifest(tarballPath);
  return tarballPath;
}

function sanitizePackedManifest(tarballPath) {
  const staging = mkdtempSync(join(tmpdir(), "skillbench-pack-"));
  try {
    run("tar", ["-xzf", tarballPath, "-C", staging]);
    const manifestPath = join(staging, "package", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.devDependencies;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    run("tar", ["-czf", tarballPath, "-C", staging, "package"]);
    const publishedManifest = JSON.parse(
      run("tar", ["-xOzf", tarballPath, "package/package.json"], { capture: true }),
    );
    const dependencyNames = Object.keys({
      ...publishedManifest.dependencies,
      ...publishedManifest.devDependencies,
      ...publishedManifest.optionalDependencies,
      ...publishedManifest.peerDependencies,
    });
    const privateDependencies = dependencyNames.filter((name) => name.startsWith("@skillbench/"));
    if (privateDependencies.length > 0) {
      throw new Error(
        `${publishedManifest.name} exposes private workspaces: ${privateDependencies.join(", ")}`,
      );
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function findPublishableWorkspacePackages() {
  const manifests = [];
  for (const parentName of ["apps", "packages"]) {
    const parent = join(workspaceRoot, parentName);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(parent, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private !== true) manifests.push(manifest.name);
    }
  }
  return manifests.sort();
}

function integrity(path) {
  const digest = createHash("sha512").update(readFileSync(path)).digest("base64");
  return `sha512-${digest}`;
}

mkdirSync(artifactRoot, { recursive: true });

const expectedPublicPackages = products.map(({ root }) => readManifest(root).name).sort();
const actualPublicPackages = findPublishableWorkspacePackages();
if (JSON.stringify(actualPublicPackages) !== JSON.stringify(expectedPublicPackages)) {
  throw new Error(
    `Unexpected publishable workspace packages: ${actualPublicPackages.join(", ") || "(none)"}`,
  );
}

const prepared = products.map((product) => {
  const { inspection, manifest } = inspectPack(product);
  return {
    ...product,
    inspection,
    manifest,
    tarballPath: pack(product, inspection),
  };
});

const cli = prepared.find(({ id }) => id === "cli");
const web = prepared.find(({ id }) => id === "web");
if (cli === undefined || web === undefined) throw new Error("Both public products must be packed");

run(process.execPath, [join(import.meta.dirname, "smoke-cli-package.mjs")], {
  env: { SKILLBENCH_CLI_TARBALL: cli.tarballPath },
});
run(process.execPath, [join(import.meta.dirname, "smoke-web-package.mjs")], {
  env: {
    SKILLBENCH_CLI_TARBALL: cli.tarballPath,
    SKILLBENCH_WEB_TARBALL: web.tarballPath,
  },
});

const releaseArtifacts = {
  schemaVersion: 1,
  artifacts: prepared.map(({ id, manifest, tarballPath }) => ({
    product: id,
    name: manifest.name,
    version: manifest.version,
    path: relative(workspaceRoot, tarballPath).split(sep).join("/"),
    integrity: integrity(tarballPath),
    size: statSync(tarballPath).size,
  })),
};
writeFileSync(artifactManifestPath, `${JSON.stringify(releaseArtifacts, null, 2)}\n`);

process.stdout.write(
  `Validated release artifacts: ${relative(workspaceRoot, artifactManifestPath)}\n`,
);
for (const artifact of releaseArtifacts.artifacts) {
  process.stdout.write(
    `${artifact.product}.path=${artifact.path}\n${artifact.product}.integrity=${artifact.integrity}\n`,
  );
}
