import { describe, expect, it } from "vite-plus/test";

import { GitHubApiClient, GitHubSourceResolver } from "@skillbench/source-github";
import { SkillSourceService } from "@skillbench/sdk/sources";

const liveEnabled = process.env.SKILLBENCH_GITHUB_LIVE === "1";
const source =
  process.env.SKILLBENCH_GITHUB_SOURCE ??
  "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const policy = { maxFileSizeBytes: 2 * 1024 * 1024, maxSnapshotSizeBytes: 25 * 1024 * 1024 };

describe.skipIf(!liveEnabled)("GitHub source live", () => {
  it("pins a copied URL without creating a persistent cache", async () => {
    const service = new SkillSourceService([
      new GitHubSourceResolver(
        new GitHubApiClient(token === undefined ? {} : { token }),
        { findLatestGitHub: () => undefined, findGitHubByInput: () => [] },
        policy,
        false,
      ),
    ]);
    const options =
      process.env.SKILLBENCH_GITHUB_SKILL_PATH === undefined
        ? {}
        : { skillPath: process.env.SKILLBENCH_GITHUB_SKILL_PATH };
    const online = await service.resolve(source, options);

    expect(online.snapshot.repository?.resolvedCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(online.snapshot.origin.originalInput).toBe(source);
  }, 60_000);
});
