import {
  GitHubApiClient,
  GitHubSourceResolver,
  type GitHubSnapshotCache,
} from "@skillbench/source-github";
import type { Logger } from "@skillbench/sdk/logging";
import { LocalSourceResolver } from "@skillbench/sdk/sources/local";
import { SkillSourceService } from "@skillbench/sdk/sources";

import type { SkillbenchConfig } from "../config";

export function createSourceService(
  config: SkillbenchConfig,
  logger: Logger,
  environment: NodeJS.ProcessEnv = process.env,
  baseDirectory: string = process.cwd(),
): SkillSourceService {
  const noCache: GitHubSnapshotCache = {
    findLatestGitHub: () => undefined,
    findGitHubByInput: () => [],
  };
  const policy = {
    maxFileSizeBytes: config.sources.maxFileSizeBytes,
    maxSnapshotSizeBytes: config.sources.maxSnapshotSizeBytes,
  };
  const githubToken = environment.GITHUB_TOKEN ?? environment.GH_TOKEN;
  const github = new GitHubSourceResolver(
    new GitHubApiClient({
      timeoutMs: config.sources.timeoutMs,
      logger,
      ...(githubToken === undefined ? {} : { token: githubToken }),
    }),
    noCache,
    policy,
    false,
  );
  return new SkillSourceService([github, new LocalSourceResolver(policy, { baseDirectory })], {
    logger,
  });
}
