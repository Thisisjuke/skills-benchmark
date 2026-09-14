// Registered by the GitHub source provider scenario suite.
import { describe, expect, it } from "vite-plus/test";
import { verifySourceResolverContract } from "@skillbench/test-contracts";

import { inspectResultSchema, inspectSkill } from "@skillbench/sdk/inspect";
import { hashBytes, type ResolvedSkill, type SkillFile } from "@skillbench/sdk/skills";
import { SkillSourceService, type ResolvedSkillStore } from "@skillbench/sdk/sources";
import {
  GitHubSourceResolver,
  type GitHubGateway,
  type GitHubSnapshotCache,
} from "@skillbench/source-github";

const policy = { maxFileSizeBytes: 1_000_000, maxSnapshotSizeBytes: 5_000_000 };
const source = "https://github.com/owner/repository/blob/main/skills/demo/SKILL.md";

function skillFile(): SkillFile {
  const content = new TextEncoder().encode("---\nname: remote\ndescription: portable\n---\n");
  return {
    relativePath: "SKILL.md",
    content,
    contentHash: hashBytes(content),
    sizeBytes: content.byteLength,
  };
}

class MemorySnapshots implements GitHubSnapshotCache, ResolvedSkillStore {
  readonly values: ResolvedSkill[] = [];

  save(resolvedSkill: ResolvedSkill): ResolvedSkill {
    this.values.push(resolvedSkill);
    return resolvedSkill;
  }

  findLatestGitHub(): ResolvedSkill | undefined {
    return this.values.at(-1);
  }

  findGitHubByInput(): ResolvedSkill[] {
    return [...this.values];
  }
}

describe("SkillSourceService ports", () => {
  it("satisfies the reusable source resolver contract", async () => {
    const gateway: GitHubGateway = {
      resolveCommit: async () => "d".repeat(40),
      fetchSkillFiles: async () => [skillFile()],
    };
    await verifySourceResolverContract({
      resolver: new GitHubSourceResolver(
        gateway,
        { findLatestGitHub: () => undefined, findGitHubByInput: () => [] },
        policy,
      ),
      supportedInput: source,
      unsupportedInput: "./local-skill",
      options: { now: new Date(0) },
      expectedOrigin: "github",
    });
  });

  it("resolves GitHub without a persistence adapter", async () => {
    const gateway: GitHubGateway = {
      resolveCommit: async () => "a".repeat(40),
      fetchSkillFiles: async () => [skillFile()],
    };
    const service = new SkillSourceService([
      new GitHubSourceResolver(
        gateway,
        {
          findLatestGitHub: () => undefined,
          findGitHubByInput: () => [],
        },
        policy,
      ),
    ]);

    const resolved = await service.resolve(source, { now: new Date(0) });

    expect(resolved.skill.name).toBe("remote");
    expect(resolved.snapshot.repository?.resolvedCommit).toBe("a".repeat(40));
  });

  it("returns a versioned, serializable inspect result", async () => {
    const gateway: GitHubGateway = {
      resolveCommit: async () => "c".repeat(40),
      fetchSkillFiles: async () => [skillFile()],
    };
    const service = new SkillSourceService([
      new GitHubSourceResolver(
        gateway,
        {
          findLatestGitHub: () => undefined,
          findGitHubByInput: () => [],
        },
        policy,
      ),
    ]);

    const inspected = await inspectSkill(service, source, { now: new Date(0) });

    expect(inspectResultSchema.parse(inspected)).toEqual(inspected);
    expect(inspected).toMatchObject({
      schemaVersion: 1,
      kind: "inspect",
      name: "remote",
      repository: { resolvedCommit: "c".repeat(40) },
    });
    expect(JSON.parse(JSON.stringify(inspected))).toEqual(inspected);
  });

  it("persists only through the injected port", async () => {
    const snapshots = new MemorySnapshots();
    const gateway: GitHubGateway = {
      resolveCommit: async () => "b".repeat(40),
      fetchSkillFiles: async () => [skillFile()],
    };
    const service = new SkillSourceService([new GitHubSourceResolver(gateway, snapshots, policy)], {
      resolvedSkills: snapshots,
    });

    const resolved = await service.resolve(source);

    expect(snapshots.values).toEqual([resolved]);
    await expect(service.addAlias("remote", source)).rejects.toMatchObject({
      code: "SOURCE_STORE_UNAVAILABLE",
    });
  });
});
