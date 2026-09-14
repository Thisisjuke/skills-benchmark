// Registered by the Web job lifecycle scenario suite.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { JobManager } from "../src/jobs";
import { WebDatabase, WebRepository } from "../src/storage";

const databases: WebDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("JobManager", () => {
  it("parses strict CLI JSONL, validates the bundle and persists the completed run", async () => {
    const projectPath = mkdtempSync(join(tmpdir(), "skillbench-web-job-"));
    const cliPath = join(projectPath, "fake-cli.mjs");
    writeFileSync(cliPath, fakeCliSource);
    const database = new WebDatabase(projectPath);
    databases.push(database);
    const repository = new WebRepository(database);
    const manager = new JobManager({
      projectPath,
      repository,
      cliPath,
      id: () => "web-job-1",
    });

    manager.create({ command: "inspect", source: "./skill" });
    const completed = await waitForTerminal(repository, "web-job-1");

    expect(completed).toMatchObject({ status: "completed", error: null });
    expect(repository.listEvents("web-job-1").map((event) => event.event)).toEqual([
      "started",
      "completed",
    ]);
    expect(existsSync(join(projectPath, ".skillbench", "web", "bundles", "web-job-1"))).toBe(true);
    await manager.shutdown();
  });
});

async function waitForTerminal(repository: WebRepository, id: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = repository.requireJob(id);
    if (["completed", "failed", "cancelled", "interrupted"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for job");
}

const fakeCliSource = String.raw`
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
const output = process.argv.at(-1);
mkdirSync(join(output, "sources", "skill"), { recursive: true });
const result = { schemaVersion: 1, type: "result", command: "inspect", data: { name: "demo" } };
const resultBytes = Buffer.from(JSON.stringify(result));
const skillBytes = Buffer.from("---\nname: demo\ndescription: demo\n---\n");
writeFileSync(join(output, "result.json"), resultBytes);
writeFileSync(join(output, "sources", "skill", "SKILL.md"), skillBytes);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const timestamp = new Date().toISOString();
const manifest = {
  schemaVersion: 1,
  kind: "skillbench-bundle",
  status: "complete",
  command: "inspect",
  jobId: "cli-job-1",
  createdAt: timestamp,
  result: { path: "result.json", contentHash: hash(resultBytes), sizeBytes: resultBytes.byteLength },
  sources: [{
    role: "skill",
    snapshotId: "snapshot-1",
    origin: "local",
    originalInput: "./skill",
    rootPath: ".",
    fingerprint: hash(skillBytes),
    fingerprintAlgorithm: "sha256-tree-v1",
    files: [{ path: "sources/skill/SKILL.md", contentHash: hash(skillBytes), sizeBytes: skillBytes.byteLength }],
  }],
  reports: [],
  artifacts: [],
};
writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest));
for (const event of [
  { schemaVersion: 1, event: "started", command: "inspect", jobId: "cli-job-1", timestamp, data: {} },
  { schemaVersion: 1, event: "completed", command: "inspect", jobId: "cli-job-1", timestamp, data: { result: result.data } },
]) writeSync(process.stdout.fd, JSON.stringify(event) + "\n");
`;
