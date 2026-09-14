// Registered by the CLI protocol scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { CliJsonlWriter } from "../src/cli/jsonl-output";
import { skillbenchEventSchema } from "@skillbench/invocation-contract";

describe("CliJsonlWriter", () => {
  it("writes every V1 event as one independently valid line", () => {
    const lines: string[] = [];
    const writer = new CliJsonlWriter(
      "compare",
      "job-1",
      (value) => lines.push(value),
      () => new Date("2026-09-06T10:00:00.000Z"),
    );

    writer.started();
    writer.phase("resolve");
    writer.progress("attempts", 1, 2);
    writer.artifact("bundle", "/tmp/result");
    writer.completed({ winner: "A" });
    writer.failed({ code: "EXAMPLE", message: "failed", exitCode: 1 });
    writer.cancelled("signal");

    expect(lines).toHaveLength(7);
    expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    expect(lines.map((line) => skillbenchEventSchema.parse(JSON.parse(line)).event)).toEqual([
      "started",
      "phase",
      "progress",
      "artifact",
      "completed",
      "failed",
      "cancelled",
    ]);
  });
});
