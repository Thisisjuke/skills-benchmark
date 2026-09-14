import { posix } from "node:path";

import { SkillbenchError } from "@skillbench/sdk/errors";
import {
  FINGERPRINT_ALGORITHM,
  fingerprintFiles,
  parseSkill,
  type ResolvedSkill,
} from "@skillbench/sdk/skills";
import type {
  GitHubFilePolicy,
  GitHubGateway,
  GitHubSnapshotCache,
  GitHubSourceDescriptor,
} from "./github-types";
import { parseGitHubSource, supportsGitHubSource } from "./github-url-parser";

type ResolveOptions = {
  now?: Date;
  offline?: boolean;
  skillPath?: string;
  selectSkill?: (paths: readonly string[]) => Promise<string>;
};

export class GitHubSourceResolver {
  readonly capabilities = Object.freeze({ provider: "github", locality: "remote" } as const);

  constructor(
    private readonly gateway: GitHubGateway,
    private readonly cache: GitHubSnapshotCache,
    private readonly policy: GitHubFilePolicy,
    private readonly cacheEnabled = true,
  ) {}

  supports(input: string): boolean {
    return supportsGitHubSource(input);
  }

  async resolve(input: string, options: ResolveOptions = {}): Promise<ResolvedSkill> {
    const requested = parseGitHubSource(input);
    if (options.offline === true) return this.resolveOffline(input, requested, options);

    const pinned =
      this.gateway.resolveSource === undefined
        ? { source: requested, resolvedCommit: await this.gateway.resolveCommit(requested) }
        : await this.gateway.resolveSource(requested);
    const source = await this.selectSkillRoot(pinned.source, pinned.resolvedCommit, options);
    const exact = this.cacheEnabled
      ? this.cache.findLatestGitHub({
          owner: source.owner,
          repository: source.repository,
          skillRoot: source.skillRoot,
          resolvedCommit: pinned.resolvedCommit,
        })
      : undefined;
    if (exact !== undefined) return this.forInput(exact, source, input);

    const files = await this.gateway.fetchSkillFiles(source, pinned.resolvedCommit, this.policy);
    const skill = parseSkill(files);
    return {
      snapshot: {
        id: crypto.randomUUID(),
        origin: { type: "github", originalInput: input },
        repository: {
          owner: source.owner,
          name: source.repository,
          requestedRef: source.requestedRef,
          resolvedCommit: pinned.resolvedCommit,
        },
        rootPath: source.skillRoot,
        files,
        fingerprint: fingerprintFiles(files),
        fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
        fetchedAt: (options.now ?? new Date()).toISOString(),
      },
      skill,
    };
  }

  private async resolveOffline(
    input: string,
    source: GitHubSourceDescriptor,
    options: ResolveOptions,
  ): Promise<ResolvedSkill> {
    const cachedForInput = this.cache.findGitHubByInput(input);
    const chosen = await this.selectCached(cachedForInput, options);
    if (chosen !== undefined) return chosen;

    if (source.alternatives === undefined && source.defaultBranch !== true) {
      const cached = this.cache.findLatestGitHub({
        owner: source.owner,
        repository: source.repository,
        skillRoot: source.skillRoot,
        requestedRef: source.requestedRef,
      });
      if (cached !== undefined) return this.forInput(cached, source, input);
    }
    throw new SkillbenchError(
      `No cached GitHub snapshot is available offline for ${source.owner}/${source.repository}`,
      { code: "GITHUB_OFFLINE_CACHE_MISS" },
    );
  }

  private async selectCached(
    candidates: readonly ResolvedSkill[],
    options: ResolveOptions,
  ): Promise<ResolvedSkill | undefined> {
    if (candidates.length === 0) return undefined;
    if (options.skillPath !== undefined) {
      const requestedPath = normalizeSkillPath(options.skillPath);
      const selected = candidates.find(
        (candidate) => skillPath(candidate.snapshot.rootPath) === requestedPath,
      );
      if (selected === undefined) {
        throw new SkillbenchError(`No cached GitHub snapshot matches ${requestedPath}`, {
          code: "GITHUB_OFFLINE_CACHE_MISS",
        });
      }
      return selected;
    }
    if (candidates.length === 1) return candidates[0];
    const paths = candidates.map((candidate) => skillPath(candidate.snapshot.rootPath));
    const selected = await chooseSkillPath(paths, options);
    return candidates.find((candidate) => skillPath(candidate.snapshot.rootPath) === selected);
  }

  private async selectSkillRoot(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
    options: ResolveOptions,
  ): Promise<GitHubSourceDescriptor> {
    if (source.discover !== true) return source;
    if (this.gateway.discoverSkillPaths === undefined) {
      throw new SkillbenchError("The configured GitHub gateway cannot discover SKILL.md files", {
        code: "GITHUB_DISCOVERY_UNAVAILABLE",
      });
    }
    const paths = await this.gateway.discoverSkillPaths(source, resolvedCommit);
    if (paths.length === 0) {
      throw new SkillbenchError(
        `No SKILL.md was found under ${source.owner}/${source.repository}/${source.skillRoot}`,
        { code: "GITHUB_SKILL_NOT_FOUND" },
      );
    }
    const selected = await chooseSkillPath(paths, options);
    if (!paths.includes(selected)) {
      throw new SkillbenchError(`Selected GitHub skill path is not available: ${selected}`, {
        code: "GITHUB_SKILL_PATH_INVALID",
      });
    }
    const root = posix.dirname(selected);
    return {
      owner: source.owner,
      repository: source.repository,
      requestedRef: source.requestedRef,
      skillRoot: root,
      skillPath: selected,
    };
  }

  private forInput(
    cached: ResolvedSkill,
    source: GitHubSourceDescriptor,
    originalInput: string,
  ): ResolvedSkill {
    if (
      cached.snapshot.origin.originalInput === originalInput &&
      cached.snapshot.repository?.requestedRef === source.requestedRef
    ) {
      return cached;
    }
    const repository = cached.snapshot.repository;
    if (repository === undefined) {
      throw new SkillbenchError("Cached GitHub snapshot has no repository metadata", {
        code: "SNAPSHOT_INCOMPLETE",
      });
    }
    return {
      snapshot: {
        ...cached.snapshot,
        id: crypto.randomUUID(),
        origin: { type: "github", originalInput },
        repository: {
          owner: source.owner,
          name: source.repository,
          requestedRef: source.requestedRef,
          resolvedCommit: repository.resolvedCommit,
        },
      },
      skill: cached.skill,
    };
  }
}

async function chooseSkillPath(paths: readonly string[], options: ResolveOptions): Promise<string> {
  if (options.skillPath !== undefined) {
    const requested = normalizeSkillPath(options.skillPath);
    if (!paths.includes(requested)) {
      throw new SkillbenchError(
        `GitHub skill path was not found: ${requested}. Available: ${paths.join(", ")}`,
        { code: "GITHUB_SKILL_PATH_INVALID" },
      );
    }
    return requested;
  }
  if (paths.length === 1) return paths[0]!;
  if (options.selectSkill !== undefined) return options.selectSkill(paths);
  throw new SkillbenchError(
    `Multiple SKILL.md files were found (${paths.join(", ")}); pass --skill-path <path>`,
    { code: "GITHUB_SKILL_SELECTION_REQUIRED" },
  );
}

function normalizeSkillPath(input: string): string {
  const trimmed = input.trim().replace(/^\.\//, "");
  if (trimmed === "" || trimmed.startsWith("/") || /[\\\0]/.test(trimmed)) {
    throw new SkillbenchError(`Invalid GitHub skill path: ${input}`, {
      code: "GITHUB_SKILL_PATH_INVALID",
    });
  }
  const normalized = posix.normalize(trimmed);
  if (normalized === ".." || normalized.startsWith("../") || normalized !== trimmed) {
    throw new SkillbenchError(`Invalid GitHub skill path: ${input}`, {
      code: "GITHUB_SKILL_PATH_INVALID",
    });
  }
  return normalized.endsWith("/SKILL.md") || normalized === "SKILL.md"
    ? normalized
    : `${normalized}/SKILL.md`;
}

function skillPath(root: string): string {
  return root === "." ? "SKILL.md" : `${root}/SKILL.md`;
}
