// Registered by the Web job lifecycle scenario suite.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { WebDatabase, WebRepository } from "../src/storage";

describe("WebDatabase", () => {
  it("applies the V1 migration and marks unfinished jobs interrupted on restart", () => {
    const project = mkdtempSync(join(tmpdir(), "skillbench-web-storage-"));
    const first = new WebDatabase(project);
    new WebRepository(first).createJob(
      "job-1",
      { command: "inspect", source: "./skill" },
      "2026-09-06T00:00:00.000Z",
    );
    first.close();

    const second = new WebDatabase(project, { now: () => new Date("2026-09-06T01:00:00.000Z") });
    expect(new WebRepository(second).requireJob("job-1")).toMatchObject({
      status: "interrupted",
      finishedAt: "2026-09-06T01:00:00.000Z",
    });
    second.close();
  });
});
