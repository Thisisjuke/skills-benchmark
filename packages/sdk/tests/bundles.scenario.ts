// Registered by the SDK artifact scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  bundleRelativePathSchema,
  skillbenchBundleDocumentSchema,
  skillbenchBundleManifestSchema,
} from "../src/bundles";

const manifest = {
  schemaVersion: 1,
  kind: "skillbench-bundle",
  status: "complete",
  command: "compare",
  jobId: "job-1",
  createdAt: "2026-09-06T10:00:00.000Z",
  result: { path: "result.json", contentHash: "1".repeat(64), sizeBytes: 42 },
  sources: [
    {
      role: "A",
      snapshotId: "snapshot-a",
      origin: "local",
      originalInput: "./skill-a",
      rootPath: ".",
      fingerprint: "2".repeat(64),
      fingerprintAlgorithm: "sha256-tree-v1",
      files: [
        {
          path: "sources/A/SKILL.md",
          contentHash: "3".repeat(64),
          sizeBytes: 100,
        },
      ],
    },
    {
      role: "B",
      snapshotId: "snapshot-b",
      origin: "github",
      originalInput: "https://github.com/example/skill-b",
      rootPath: ".",
      fingerprint: "6".repeat(64),
      fingerprintAlgorithm: "sha256-tree-v1",
      files: [
        {
          path: "sources/B/SKILL.md",
          contentHash: "7".repeat(64),
          sizeBytes: 120,
        },
      ],
    },
  ],
  reports: [
    {
      id: "summary",
      path: "report.md",
      contentHash: "8".repeat(64),
      sizeBytes: 180,
      mediaType: "text/markdown",
    },
    {
      id: "report-1",
      path: "reports/comparison.md",
      contentHash: "4".repeat(64),
      sizeBytes: 200,
      mediaType: "text/markdown",
    },
  ],
  artifacts: [],
  instructions: [],
} as const;

describe("Skillbench bundle contract", () => {
  it("validates a complete portable manifest and matching result", () => {
    expect(skillbenchBundleManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      skillbenchBundleDocumentSchema.parse({
        manifest,
        result: {
          schemaVersion: 1,
          type: "result",
          command: "compare",
          data: { winner: "A" },
        },
      }),
    ).toBeDefined();
  });

  it.each(["/absolute", "../escape", "a/../b", "windows\\path", "."])(
    "rejects unsafe bundle path %s",
    (path) => {
      expect(bundleRelativePathSchema.safeParse(path).success).toBe(false);
    },
  );

  it("rejects duplicate paths and mismatched result commands", () => {
    const duplicate = {
      ...manifest,
      artifacts: [
        {
          kind: "file",
          path: "reports/comparison.md",
          contentHash: "5".repeat(64),
          sizeBytes: 1,
        },
      ],
    };
    expect(skillbenchBundleManifestSchema.safeParse(duplicate).success).toBe(false);
    expect(
      skillbenchBundleDocumentSchema.safeParse({
        manifest,
        result: {
          schemaVersion: 1,
          type: "result",
          command: "eval",
          data: {},
        },
      }).success,
    ).toBe(false);
  });

  it("accepts bundles only for portable business operations", () => {
    expect(
      skillbenchBundleManifestSchema.safeParse({ ...manifest, command: "history" }).success,
    ).toBe(false);
  });

  it("requires one root summary report", () => {
    expect(
      skillbenchBundleManifestSchema.safeParse({
        ...manifest,
        reports: manifest.reports.filter((report) => report.path !== "report.md"),
      }).success,
    ).toBe(false);
  });
});
