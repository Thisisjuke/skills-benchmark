// Registered by the SDK source scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { bundleSourceSnapshotSchema } from "@skillbench/sdk/bundles";
import { inspectSkill } from "@skillbench/sdk/inspect";
import type { ResolvedSkill } from "@skillbench/sdk/skills";
import { SkillSourceService, type SkillSourceResolver } from "@skillbench/sdk/sources";

const digest = "a".repeat(64);
const resolved: ResolvedSkill = {
  snapshot: {
    id: "fixture-snapshot",
    origin: { type: "artifact-store", originalInput: "artifact:demo" },
    rootPath: "skills/demo",
    files: [
      {
        relativePath: "SKILL.md",
        content: new TextEncoder().encode("fixture"),
        contentHash: digest,
        sizeBytes: 7,
      },
    ],
    fingerprint: digest,
    fingerprintAlgorithm: "sha256-tree-v1",
    fetchedAt: new Date(0).toISOString(),
  },
  skill: {
    name: "fixture",
    description: "Third-party source fixture",
    metadata: {},
    markdown: "fixture",
    relativeReferences: [],
  },
};

const resolver: SkillSourceResolver = {
  capabilities: { provider: "artifact-store", locality: "remote" },
  supports: (input) => input.startsWith("artifact:"),
  resolve: async () => structuredClone(resolved),
};

describe("source provider extension", () => {
  it("carries a third provider through resolution, inspection and bundle metadata", async () => {
    const service = new SkillSourceService([resolver]);
    const snapshot = await service.resolve("artifact:demo");
    const inspected = await inspectSkill(service, "artifact:demo");
    const bundled = bundleSourceSnapshotSchema.parse({
      role: "skill",
      snapshotId: snapshot.snapshot.id,
      origin: snapshot.snapshot.origin.type,
      originalInput: snapshot.snapshot.origin.originalInput,
      rootPath: snapshot.snapshot.rootPath,
      fingerprint: snapshot.snapshot.fingerprint,
      fingerprintAlgorithm: snapshot.snapshot.fingerprintAlgorithm,
      files: snapshot.snapshot.files.map((file) => ({
        path: `sources/skill/${file.relativePath}`,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
      })),
    });

    expect(service.capabilities("artifact:demo")).toEqual({
      provider: "artifact-store",
      locality: "remote",
    });
    expect(inspected.origin.type).toBe("artifact-store");
    expect(bundled.origin).toBe("artifact-store");
  });
});
