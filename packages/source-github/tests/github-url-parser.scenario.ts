// Registered by the GitHub source provider scenario suite.
import { describe, expect, it } from "vite-plus/test";

import { parseGitHubSource, supportsGitHubSource } from "@skillbench/source-github";

describe("parseGitHubSource", () => {
  it.each([
    [
      "https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md",
      {
        owner: "vercel-labs",
        repository: "agent-skills",
        requestedRef: "main",
        skillRoot: "skills/react-best-practices",
        skillPath: "skills/react-best-practices/SKILL.md",
      },
    ],
    [
      "https://raw.githubusercontent.com/owner/repository/v1/skill/SKILL.md",
      {
        owner: "owner",
        repository: "repository",
        requestedRef: "v1",
        skillRoot: "skill",
        skillPath: "skill/SKILL.md",
      },
    ],
    [
      "github:owner/repository/path/to/skill@feature/ref",
      {
        owner: "owner",
        repository: "repository",
        requestedRef: "feature/ref",
        skillRoot: "path/to/skill",
        skillPath: "path/to/skill/SKILL.md",
      },
    ],
    [
      "github:owner/repository@main",
      {
        owner: "owner",
        repository: "repository",
        requestedRef: "main",
        skillRoot: ".",
        skillPath: "SKILL.md",
      },
    ],
  ])("normalizes %s", (input, expected) => {
    expect(parseGitHubSource(input)).toMatchObject(expected);
  });

  it("accepts repository, tree and unqualified shorthand inputs", () => {
    expect(parseGitHubSource("owner/repository")).toMatchObject({
      owner: "owner",
      repository: "repository",
      requestedRef: "HEAD",
      skillRoot: ".",
      discover: true,
      defaultBranch: true,
    });
    expect(parseGitHubSource("https://github.com/owner/repository")).toMatchObject({
      owner: "owner",
      repository: "repository",
      defaultBranch: true,
    });
    expect(parseGitHubSource("github:owner/repository/skills")).toMatchObject({
      requestedRef: "HEAD",
      skillRoot: "skills",
      discover: true,
    });
    expect(parseGitHubSource("https://github.com/owner/repository/tree/feature/ref/skills/demo"))
      .toMatchObject({
        requestedRef: "feature",
        skillRoot: "ref/skills/demo",
        discover: true,
        alternatives: expect.arrayContaining([
          expect.objectContaining({ requestedRef: "feature/ref", skillRoot: "skills/demo" }),
        ]),
      });
  });

  it.each([
    "https://github.example/owner/repo/blob/main/skill/SKILL.md",
    "https://github.com/owner/repo/blob/main/skill/README.md",
    "https://github.com/owner/repo/tree",
    "https://raw.githubusercontent.com/owner/repo/main/../SKILL.md",
    "github:owner/repo/../skill@main",
  ])("rejects invalid or unsafe input %s", (input) => {
    expect(() => parseGitHubSource(input)).toThrow(/Invalid GitHub skill source/);
  });

  it("does not claim lookalike hosts", () => {
    expect(supportsGitHubSource("https://github.com.evil.test/owner/repo/blob/main/SKILL.md")).toBe(false);
  });
});
