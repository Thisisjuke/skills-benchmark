import type { ResolvedSkill, SkillFile } from "@skillbench/sdk/skills";

export type GitHubSourceDescriptor = {
  owner: string;
  repository: string;
  requestedRef: string;
  skillRoot: string;
  skillPath: string;
  discover?: boolean;
  defaultBranch?: boolean;
  alternatives?: GitHubSourceLocation[];
};

export type GitHubSourceLocation = Pick<
  GitHubSourceDescriptor,
  "requestedRef" | "skillRoot" | "skillPath" | "discover"
>;

export type ResolvedGitHubSource = {
  source: GitHubSourceDescriptor;
  resolvedCommit: string;
};

export type GitHubFilePolicy = {
  maxFileSizeBytes: number;
  maxSnapshotSizeBytes: number;
};

export interface GitHubGateway {
  resolveCommit(source: GitHubSourceDescriptor): Promise<string>;
  resolveSource?(source: GitHubSourceDescriptor): Promise<ResolvedGitHubSource>;
  discoverSkillPaths?(source: GitHubSourceDescriptor, resolvedCommit: string): Promise<string[]>;
  fetchSkillFiles(
    source: GitHubSourceDescriptor,
    resolvedCommit: string,
    policy: GitHubFilePolicy,
  ): Promise<SkillFile[]>;
}

export type GitHubSnapshotLookup = {
  owner: string;
  repository: string;
  skillRoot: string;
  requestedRef?: string;
  resolvedCommit?: string;
};

export interface GitHubSnapshotCache {
  findLatestGitHub(query: GitHubSnapshotLookup): ResolvedSkill | undefined;
  findGitHubByInput(originalInput: string): ResolvedSkill[];
}
