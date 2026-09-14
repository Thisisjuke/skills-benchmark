import { posix } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import { hashBytes, type SkillFile } from "@skillbench/sdk/skills";

import type { GitHubTransport } from "./github-transport";
import type { GitHubFilePolicy, GitHubSourceDescriptor } from "./github-types";

type ContentEntry = {
  type?: unknown;
  name?: unknown;
  path?: unknown;
  size?: unknown;
};

const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_DISCOVERY_ENTRIES = 10_000;
const IGNORED_DIRECTORIES = new Set([".git", ".skillbench", "node_modules"]);

export class GitHubTreeReader {
  constructor(private readonly transport: GitHubTransport) {}

  async discoverSkillPaths(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
  ): Promise<string[]> {
    assertCommit(resolvedCommit);
    const paths: string[] = [];
    const queue = [source.skillRoot];
    let discoveredEntries = 0;
    while (queue.length > 0) {
      const directory = queue.shift()!;
      const entries = await this.listDirectory(source, resolvedCommit, directory);
      discoveredEntries += entries.length;
      if (discoveredEntries > MAX_DISCOVERY_ENTRIES) {
        throw new SkillbenchError(
          `GitHub skill discovery exceeds ${MAX_DISCOVERY_ENTRIES} entries under ${source.skillRoot}`,
          { code: "GITHUB_DISCOVERY_TOO_LARGE" },
        );
      }
      for (const entry of entries) {
        assertWithinRoot(entry.path, source.skillRoot);
        if (entry.type === "dir") {
          if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(entry.path);
          continue;
        }
        assertSupportedEntry(entry);
        if (entry.type === "file" && entry.name === "SKILL.md") paths.push(entry.path);
      }
    }
    return paths.sort((left, right) => left.localeCompare(right, "en"));
  }

  async fetchSkillFiles(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
    policy: GitHubFilePolicy,
  ): Promise<SkillFile[]> {
    assertCommit(resolvedCommit);
    const files: SkillFile[] = [];
    let snapshotSize = 0;
    const queue = [source.skillRoot];

    while (queue.length > 0) {
      const directory = queue.shift()!;
      const entries = await this.listDirectory(source, resolvedCommit, directory);
      for (const entry of entries) {
        assertWithinRoot(entry.path, source.skillRoot);
        if (entry.type === "dir") {
          if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(entry.path);
          continue;
        }
        assertSupportedEntry(entry);
        if (entry.type !== "file") continue;
        if (entry.size > policy.maxFileSizeBytes) {
          throw new SkillbenchError(
            `GitHub skill file exceeds maxFileSizeBytes (${policy.maxFileSizeBytes}): ${entry.path}`,
            { code: "GITHUB_FILE_TOO_LARGE" },
          );
        }
        const content = await this.transport.requestBytes(
          this.transport.rawUrl(
            `/${encodeURIComponent(source.owner)}/${encodeURIComponent(
              source.repository,
            )}/${resolvedCommit}/${encodePath(entry.path)}`,
          ),
          false,
        );
        if (content.byteLength > policy.maxFileSizeBytes) {
          throw new SkillbenchError(
            `GitHub skill file exceeds maxFileSizeBytes (${policy.maxFileSizeBytes}): ${entry.path}`,
            { code: "GITHUB_FILE_TOO_LARGE" },
          );
        }
        snapshotSize += content.byteLength;
        if (snapshotSize > policy.maxSnapshotSizeBytes) {
          throw new SkillbenchError(
            `GitHub skill snapshot exceeds maxSnapshotSizeBytes (${policy.maxSnapshotSizeBytes})`,
            { code: "GITHUB_SNAPSHOT_TOO_LARGE" },
          );
        }
        const relativePath =
          source.skillRoot === "." ? entry.path : entry.path.slice(source.skillRoot.length + 1);
        files.push({
          relativePath,
          content,
          contentHash: hashBytes(content),
          sizeBytes: content.byteLength,
        });
      }
    }

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  }

  private async listDirectory(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
    directory: string,
  ): Promise<DirectoryEntry[]> {
    const suffix = directory === "." ? "" : `/${encodePath(directory)}`;
    const url = this.transport.apiUrl(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(
        source.repository,
      )}/contents${suffix}?ref=${encodeURIComponent(resolvedCommit)}`,
    );
    const entries = await this.transport.requestJson<unknown>(url);
    if (!Array.isArray(entries)) {
      throw new SkillbenchError(`GitHub skill root is not a directory: ${source.skillRoot}`, {
        code: "GITHUB_SKILL_ROOT_INVALID",
      });
    }
    if (entries.length >= MAX_DIRECTORY_ENTRIES) {
      throw new SkillbenchError(
        `GitHub directory has ${entries.length} entries and may exceed the Contents API limit: ${directory}`,
        { code: "GITHUB_DIRECTORY_TOO_LARGE" },
      );
    }
    return entries
      .map(parseContentEntry)
      .sort((left, right) => left.path.localeCompare(right.path, "en"));
  }
}

type DirectoryEntry = {
  type: string;
  name: string;
  path: string;
  size: number;
};

function parseContentEntry(input: unknown): DirectoryEntry {
  if (typeof input !== "object" || input === null) {
    throw new SkillbenchError("GitHub returned a malformed directory entry", {
      code: "GITHUB_RESPONSE_INVALID",
    });
  }
  const entry = input as ContentEntry;
  if (
    typeof entry.type !== "string" ||
    typeof entry.name !== "string" ||
    typeof entry.path !== "string" ||
    typeof entry.size !== "number" ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0
  ) {
    throw new SkillbenchError("GitHub returned a malformed directory entry", {
      code: "GITHUB_RESPONSE_INVALID",
    });
  }
  return { type: entry.type, name: entry.name, path: entry.path, size: entry.size };
}

function assertCommit(resolvedCommit: string): void {
  if (!/^[a-f0-9]{40}$/iu.test(resolvedCommit)) {
    throw new SkillbenchError(`Resolved GitHub commit is invalid: ${resolvedCommit}`, {
      code: "GITHUB_COMMIT_INVALID",
    });
  }
}

function assertWithinRoot(path: string, root: string): void {
  const normalized = posix.normalize(path);
  if (
    normalized !== path ||
    normalized.startsWith("../") ||
    (root !== "." && normalized !== root && !normalized.startsWith(`${root}/`))
  ) {
    throw new SkillbenchError(`GitHub returned a path outside the skill root: ${path}`, {
      code: "GITHUB_PATH_UNSAFE",
    });
  }
}

function assertSupportedEntry(entry: DirectoryEntry): void {
  if (entry.type !== "symlink" && entry.type !== "submodule") return;
  throw new SkillbenchError(`Unsupported GitHub entry type ${entry.type}: ${entry.path}`, {
    code: "GITHUB_ENTRY_UNSUPPORTED",
  });
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "." && segment !== "")
    .map(encodeURIComponent)
    .join("/");
}
