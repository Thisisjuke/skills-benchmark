// Registered by the Web request scenario suite.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { createWebApp } from "../src/app";
import { JobManager } from "../src/jobs";
import { WebDatabase, WebRepository } from "../src/storage";

const databases: WebDatabase[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function fixture(assetsRoot?: string) {
  const projectPath = mkdtempSync(join(tmpdir(), "skillbench-web-app-"));
  const database = new WebDatabase(projectPath);
  databases.push(database);
  const repository = new WebRepository(database);
  const jobs = new JobManager({ projectPath, repository, cliPath: process.execPath });
  return {
    app: createWebApp({
      jobs,
      repository,
      ...(assetsRoot === undefined ? {} : { assetsRoot }),
    }),
    projectPath,
    repository,
  };
}

describe("Web API", () => {
  it("is healthy and rejects non-loopback browser origins", async () => {
    const { app } = fixture();
    expect((await app.request("/api/health")).status).toBe(200);
    expect(
      (
        await app.request("/api/health", {
          headers: { origin: "https://malicious.example" },
        })
      ).status,
    ).toBe(403);
  });

  it("validates and persists favorite sources", async () => {
    const { app } = fixture();
    const created = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4173" },
      body: JSON.stringify({ label: "Local", kind: "local", source: "./skill" }),
    });
    expect(created.status).toBe(201);
    const listed = await (await app.request("/api/sources")).json();
    expect(listed).toMatchObject({ sources: [{ label: "Local", input: "./skill" }] });
  });

  it("rejects an argv-shaped job payload", async () => {
    const { app } = fixture();
    const response = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "inspect", source: "./skill", argv: ["--debug"] }),
    });
    expect(response.status).toBe(400);
  });

  it("serves packaged client files with immutable asset caching", async () => {
    const assetsRoot = mkdtempSync(join(tmpdir(), "skillbench-web-assets-"));
    mkdirSync(join(assetsRoot, "assets"));
    writeFileSync(join(assetsRoot, "index.html"), '<div id="root"></div>');
    writeFileSync(join(assetsRoot, "assets", "client.js"), "export {};");
    const { app } = fixture(assetsRoot);

    expect(await (await app.request("/")).text()).toContain('id="root"');
    const asset = await app.request("/assets/client.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
