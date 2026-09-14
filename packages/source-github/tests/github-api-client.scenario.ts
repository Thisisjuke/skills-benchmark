// Registered by the GitHub source provider scenario suite.
import { describe, expect, it } from "vite-plus/test";

import {
  GitHubApiClient,
  parseGitHubSource,
  type FetchLike,
  type GitHubSourceDescriptor,
} from "@skillbench/source-github";

const commit = "a".repeat(40);
const source: GitHubSourceDescriptor = {
  owner: "owner",
  repository: "repo",
  requestedRef: "main",
  skillRoot: "skills/demo",
  skillPath: "skills/demo/SKILL.md",
};
const policy = { maxFileSizeBytes: 1_000, maxSnapshotSizeBytes: 5_000 };

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

describe("GitHubApiClient", () => {
  it("resolves a ref and downloads the complete skill root recursively", async () => {
    const requested: string[] = [];
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/commits/main")) return json({ sha: commit });
      if (url.includes("/contents/skills/demo?")) {
        return json([
          { type: "file", name: "SKILL.md", path: "skills/demo/SKILL.md", size: 45 },
          { type: "dir", name: "references", path: "skills/demo/references", size: 0 },
        ]);
      }
      if (url.includes("/contents/skills/demo/references?")) {
        return json([
          { type: "file", name: "guide.md", path: "skills/demo/references/guide.md", size: 5 },
        ]);
      }
      if (url.endsWith("/skills/demo/SKILL.md")) {
        return new Response("---\nname: demo\ndescription: demo\n---\nbody\n");
      }
      if (url.endsWith("/skills/demo/references/guide.md")) return new Response("guide");
      throw new Error(`Unexpected URL: ${url}`);
    };
    const client = new GitHubApiClient({ fetcher });

    expect(await client.resolveCommit(source)).toBe(commit);
    const files = await client.fetchSkillFiles(source, commit, policy);

    expect(files.map((file) => file.relativePath)).toEqual(["references/guide.md", "SKILL.md"]);
    expect(requested).toHaveLength(5);
    expect(requested.every((url) => !url.includes("main/skills"))).toBe(true);
    expect(requested.filter((url) => url.includes("raw.githubusercontent.com"))).toHaveLength(2);
  });

  it("reports rate limiting distinctly", async () => {
    const client = new GitHubApiClient({
      fetcher: async () =>
        new Response("rate limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    });
    await expect(client.resolveCommit(source)).rejects.toMatchObject({
      code: "GITHUB_RATE_LIMITED",
    });
  });

  it("resolves the longest valid ref when a copied URL contains slashes", async () => {
    const requested: string[] = [];
    const client = new GitHubApiClient({
      fetcher: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/commits/feature%2Fref")) return json({ sha: commit });
        return json({ message: "No commit found" }, { status: 422 });
      },
    });
    const resolved = await client.resolveSource(
      parseGitHubSource("https://github.com/owner/repo/tree/feature/ref/skills/demo"),
    );

    expect(resolved).toMatchObject({
      resolvedCommit: commit,
      source: { requestedRef: "feature/ref", skillRoot: "skills/demo", discover: true },
    });
    expect(requested.at(-1)).toContain("feature%2Fref");
  });

  it("loads the default branch and discovers SKILL.md files without downloading them", async () => {
    const requested: string[] = [];
    const client = new GitHubApiClient({
      fetcher: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.endsWith("/repos/owner/repo")) return json({ default_branch: "trunk" });
        if (url.endsWith("/commits/trunk")) return json({ sha: commit });
        if (url.includes("/contents?")) {
          return json([
            { type: "dir", name: "skills", path: "skills", size: 0 },
            { type: "file", name: "README.md", path: "README.md", size: 10 },
          ]);
        }
        if (url.includes("/contents/skills?")) {
          return json([
            { type: "dir", name: "a", path: "skills/a", size: 0 },
            { type: "dir", name: "b", path: "skills/b", size: 0 },
          ]);
        }
        if (url.includes("/contents/skills/a?")) {
          return json([{ type: "file", name: "SKILL.md", path: "skills/a/SKILL.md", size: 1 }]);
        }
        if (url.includes("/contents/skills/b?")) {
          return json([{ type: "file", name: "SKILL.md", path: "skills/b/SKILL.md", size: 1 }]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    const resolved = await client.resolveSource(parseGitHubSource("owner/repo"));
    expect(resolved).toMatchObject({
      resolvedCommit: commit,
      source: { requestedRef: "trunk", skillRoot: ".", discover: true },
    });
    expect(await client.discoverSkillPaths(resolved.source, commit)).toEqual([
      "skills/a/SKILL.md",
      "skills/b/SKILL.md",
    ]);
    expect(requested.some((url) => url.includes("raw.githubusercontent.com"))).toBe(false);
  });

  it("rejects symlinks returned inside the skill root", async () => {
    const client = new GitHubApiClient({
      fetcher: async (input) => {
        const url = String(input);
        if (url.includes("/contents/")) {
          return json([{ type: "symlink", name: "outside", path: "skills/demo/outside", size: 0 }]);
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    await expect(client.fetchSkillFiles(source, commit, policy)).rejects.toMatchObject({
      code: "GITHUB_ENTRY_UNSUPPORTED",
    });
  });
});
