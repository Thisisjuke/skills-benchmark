import type { Logger } from "@skillbench/sdk/logging";
import type { SkillFile } from "@skillbench/sdk/skills";

import { GitHubRefResolver } from "./github-ref-resolver";
import { GitHubTransport, type FetchLike } from "./github-transport";
import { GitHubTreeReader } from "./github-tree-reader";
import type {
  GitHubFilePolicy,
  GitHubGateway,
  GitHubSourceDescriptor,
  ResolvedGitHubSource,
} from "./github-types";

export type { FetchLike } from "./github-transport";

export type GitHubApiClientOptions = {
  fetcher?: FetchLike;
  token?: string;
  timeoutMs?: number;
  apiBaseUrl?: string;
  rawBaseUrl?: string;
  logger?: Logger;
};

export class GitHubApiClient implements GitHubGateway {
  private readonly refs: GitHubRefResolver;
  private readonly tree: GitHubTreeReader;

  constructor(options: GitHubApiClientOptions = {}) {
    const transport = new GitHubTransport(options);
    this.refs = new GitHubRefResolver(transport);
    this.tree = new GitHubTreeReader(transport);
  }

  resolveCommit(source: GitHubSourceDescriptor): Promise<string> {
    return this.refs.resolveCommit(source);
  }

  resolveSource(source: GitHubSourceDescriptor): Promise<ResolvedGitHubSource> {
    return this.refs.resolveSource(source);
  }

  discoverSkillPaths(source: GitHubSourceDescriptor, resolvedCommit: string): Promise<string[]> {
    return this.tree.discoverSkillPaths(source, resolvedCommit);
  }

  fetchSkillFiles(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
    policy: GitHubFilePolicy,
  ): Promise<SkillFile[]> {
    return this.tree.fetchSkillFiles(source, resolvedCommit, policy);
  }
}
