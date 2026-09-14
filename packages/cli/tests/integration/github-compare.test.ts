import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createProgram } from "../../src/cli/program";
import { initializeProject } from "../../src/init";
import { GitHubApiClient, GitHubSourceResolver, type FetchLike } from "@skillbench/source-github";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  hashBytes,
  parseSkill,
  type SkillFile,
} from "@skillbench/sdk/skills";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import {
  SkillSourceService,
  type ResolveOptions,
  type SkillSourceResolver,
} from "@skillbench/sdk/sources";

const commit = "e".repeat(40);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function skillFile(content: string): SkillFile {
  const bytes = new TextEncoder().encode(content);
  return {
    relativePath: "SKILL.md",
    content: bytes,
    contentHash: hashBytes(bytes),
    sizeBytes: bytes.byteLength,
  };
}

describe("CLI GitHub comparison", () => {
  it("compares an absolute local path with a copied GitHub tree URL hermetically", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skillbench-fake-github-"));
    initializeProject(cwd);
    const requested: string[] = [];
    const fetcher: FetchLike = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/commits/main%2Fskills")) return json({ message: "missing" }, 422);
      if (url.endsWith("/commits/main")) return json({ sha: commit });
      if (url.includes(`/contents/skills?ref=${commit}`)) {
        return json([
          { type: "dir", name: "remote", path: "skills/remote", size: 0 },
          { type: "dir", name: "unused", path: "skills/unused", size: 0 },
        ]);
      }
      if (url.includes(`/contents/skills/remote?ref=${commit}`)) {
        return json([{ type: "file", name: "SKILL.md", path: "skills/remote/SKILL.md", size: 64 }]);
      }
      if (url.includes(`/contents/skills/unused?ref=${commit}`)) {
        return json([{ type: "file", name: "SKILL.md", path: "skills/unused/SKILL.md", size: 64 }]);
      }
      if (url.endsWith(`/${commit}/skills/remote/SKILL.md`)) {
        return new Response(
          "---\nname: remote-skill\ndescription: Hermetic GitHub fixture.\n---\n\n# Remote\n",
          { headers: { "content-type": "text/plain" } },
        );
      }
      throw new Error(`Unexpected network request: ${url}`);
    };
    const output: string[] = [];

    await createProgram({
      stdinIsTTY: false,
      stderrIsTTY: false,
      writeStdout: (value) => output.push(value),
      services: {
        cwd: () => cwd,
        createSourceService: (config, logger) => {
          const policy = {
            maxFileSizeBytes: config.sources.maxFileSizeBytes,
            maxSnapshotSizeBytes: config.sources.maxSnapshotSizeBytes,
          };
          return new SkillSourceService(
            [
              new GitHubSourceResolver(
                new GitHubApiClient({ fetcher, logger }),
                { findLatestGitHub: () => undefined, findGitHubByInput: () => [] },
                policy,
                false,
              ),
              new LocalSourceResolver(policy),
            ],
            { logger },
          );
        },
      },
    }).parseAsync([
      "node",
      "skillbench",
      "compare",
      resolve("tests/fixtures/skills/basic"),
      "https://github.com/owner/repo/tree/main/skills",
      "--evals",
      resolve("tests/fixtures/evals/development"),
      "--repeat",
      "1",
      "--skill-path-b",
      "skills/remote",
      "--runner",
      "mock",
      "--no-input",
      "--json",
    ]);

    const envelope = JSON.parse(output.join("")) as {
      schemaVersion: number;
      type: string;
      command: string;
      data: {
        evaluationB: { snapshotId: string };
        report: {
          payload: {
            sourceB: {
              rootPath: string;
              repository: { requestedRef: string; resolvedCommit: string };
            };
          };
        };
        verdict: { winner: string };
      };
    };
    expect(envelope).toMatchObject({ schemaVersion: 1, type: "result", command: "compare" });
    const summary = envelope.data;
    expect(summary.verdict.winner).toBe("tie");
    expect(summary.report.payload.sourceB).toMatchObject({
      rootPath: "skills/remote",
      repository: { requestedRef: "main", resolvedCommit: commit },
    });
    expect(requested).toContainEqual(expect.stringContaining("/commits/main%2Fskills"));
    expect(requested).toContainEqual(expect.stringContaining(`?ref=${commit}`));
    expect(
      requested.every(
        (url) =>
          url.startsWith("https://api.github.com/") ||
          url.startsWith("https://raw.githubusercontent.com/"),
      ),
    ).toBe(true);
  });

  it("routes independent skill paths to both two-source commands", async () => {
    for (const operation of ["compare", "merge"] as const) {
      const cwd = mkdtempSync(join(tmpdir(), `skillbench-${operation}-source-paths-`));
      initializeProject(cwd);
      const calls: Array<{ input: string; skillPath?: string }> = [];
      const resolver: SkillSourceResolver = {
        capabilities: { provider: "fixture", locality: "remote" },
        supports: () => true,
        resolve: async (input: string, options: ResolveOptions = {}) => {
          calls.push({
            input,
            ...(options.skillPath === undefined ? {} : { skillPath: options.skillPath }),
          });
          const rootPath = options.skillPath ?? "missing";
          const files = [
            skillFile(`---\nname: ${rootPath.replaceAll("/", "-")}\ndescription: selected\n---\n`),
          ];
          return {
            snapshot: {
              id: crypto.randomUUID(),
              origin: { type: "github", originalInput: input },
              repository: {
                owner: "owner",
                name: input.endsWith("a") ? "repo-a" : "repo-b",
                requestedRef: "main",
                resolvedCommit: commit,
              },
              rootPath,
              files,
              fingerprint: fingerprintFiles(files),
              fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
              fetchedAt: new Date("2026-09-04T00:00:00.000Z").toISOString(),
            },
            skill: parseSkill(files),
          };
        },
      };
      const output: string[] = [];

      await createProgram({
        stdinIsTTY: false,
        stderrIsTTY: false,
        writeStdout: (value) => output.push(value),
        services: {
          cwd: () => cwd,
          createSourceService: (_config, logger) => new SkillSourceService([resolver], { logger }),
        },
      }).parseAsync([
        "node",
        "skillbench",
        operation,
        "https://github.com/owner/repo-a",
        "https://github.com/owner/repo-b",
        "--skill-path-a",
        "skills/a",
        "--skill-path-b",
        "skills/b",
        "--evals",
        resolve("tests/fixtures/evals/development"),
        "--repeat",
        "1",
        "--runner",
        "mock",
        "--no-input",
        "--json",
      ]);

      expect(calls, operation).toEqual([
        { input: "https://github.com/owner/repo-a", skillPath: "skills/a" },
        { input: "https://github.com/owner/repo-b", skillPath: "skills/b" },
      ]);
      expect(JSON.parse(output.join("")), operation).toMatchObject({
        schemaVersion: 1,
        type: "result",
        command: operation,
      });
    }
  });
});
