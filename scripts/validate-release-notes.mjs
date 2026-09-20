import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (tag === undefined || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
  throw new Error(`Expected a semantic version tag, received: ${tag ?? "(missing)"}`);
}
const cli = JSON.parse(readFileSync(resolve(workspaceRoot, "packages/cli/package.json"), "utf8"));
const web = JSON.parse(readFileSync(resolve(workspaceRoot, "apps/web/package.json"), "utf8"));
if (cli.version !== web.version || tag !== `v${cli.version}`) {
  throw new Error(`Tag ${tag} must match both public package versions (${cli.version}, ${web.version})`);
}
const notesPath = resolve(workspaceRoot, ".github", "releases", `${tag}.md`);
if (!existsSync(notesPath)) throw new Error(`Release notes are missing: .github/releases/${tag}.md`);
const notes = readFileSync(notesPath, "utf8").trim();
if (notes === "") throw new Error(`Release notes are empty: .github/releases/${tag}.md`);
if (!/^##\s+Changelog\s*$/imu.test(notes)) {
  throw new Error("Release notes must contain a '## Changelog' section");
}
if (!/^##\s+(?:Upgrade|Migration|Migrate\b.*)\s*$/imu.test(notes)) {
  throw new Error("Release notes must contain an upgrade or migration section");
}
process.stdout.write(`Validated release notes: .github/releases/${tag}.md\n`);
