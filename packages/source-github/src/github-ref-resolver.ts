import { SkillbenchError } from "@skillbench/sdk/errors";

import type { GitHubTransport } from "./github-transport";
import type {
  GitHubSourceDescriptor,
  GitHubSourceLocation,
  ResolvedGitHubSource,
} from "./github-types";

type CommitResponse = { sha?: unknown };
type RepositoryResponse = { default_branch?: unknown };

export class GitHubRefResolver {
  constructor(private readonly transport: GitHubTransport) {}

  async resolveCommit(source: GitHubSourceDescriptor): Promise<string> {
    const url = this.transport.apiUrl(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(
        source.repository,
      )}/commits/${encodeURIComponent(source.requestedRef)}`,
    );
    const response = await this.transport.requestJson<CommitResponse>(url);
    if (typeof response.sha !== "string" || !/^[a-f0-9]{40}$/iu.test(response.sha)) {
      throw new SkillbenchError("GitHub returned a commit without a valid SHA", {
        code: "GITHUB_RESPONSE_INVALID",
      });
    }
    return response.sha.toLowerCase();
  }

  async resolveSource(source: GitHubSourceDescriptor): Promise<ResolvedGitHubSource> {
    if (source.defaultBranch === true) {
      const repositoryUrl = this.transport.apiUrl(
        `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}`,
      );
      const repository = await this.transport.requestJson<RepositoryResponse>(repositoryUrl);
      if (
        typeof repository.default_branch !== "string" ||
        repository.default_branch.trim() === ""
      ) {
        throw new SkillbenchError("GitHub returned a repository without a default branch", {
          code: "GITHUB_RESPONSE_INVALID",
        });
      }
      const resolvedSource = withLocation(source, {
        requestedRef: repository.default_branch,
        skillRoot: source.skillRoot,
        skillPath: source.skillPath,
        ...(source.discover === true ? { discover: true } : {}),
      });
      return { source: resolvedSource, resolvedCommit: await this.resolveCommit(resolvedSource) };
    }

    const candidates: GitHubSourceLocation[] = [
      {
        requestedRef: source.requestedRef,
        skillRoot: source.skillRoot,
        skillPath: source.skillPath,
        ...(source.discover === true ? { discover: true } : {}),
      },
      ...(source.alternatives ?? []),
    ].sort(
      (left, right) => right.requestedRef.split("/").length - left.requestedRef.split("/").length,
    );
    for (const candidate of candidates) {
      const resolvedSource = withLocation(source, candidate);
      try {
        return { source: resolvedSource, resolvedCommit: await this.resolveCommit(resolvedSource) };
      } catch (error) {
        if (!(error instanceof SkillbenchError) || error.code !== "GITHUB_NOT_FOUND") throw error;
      }
    }
    throw new SkillbenchError(
      `No GitHub ref from the URL could be resolved in ${source.owner}/${source.repository}`,
      { code: "GITHUB_REF_NOT_FOUND" },
    );
  }
}

function withLocation(
  source: GitHubSourceDescriptor,
  location: GitHubSourceLocation,
): GitHubSourceDescriptor {
  return {
    owner: source.owner,
    repository: source.repository,
    requestedRef: location.requestedRef,
    skillRoot: location.skillRoot,
    skillPath: location.skillPath,
    ...(location.discover === true ? { discover: true } : {}),
  };
}
