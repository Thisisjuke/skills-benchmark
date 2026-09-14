# `@skillbench/source-github`

This package adapts GitHub to the SDK source port. It parses user input, resolves
branches or tags to a commit, discovers `SKILL.md` files, and downloads the complete
skill directory with explicit limits.

It persists nothing itself. The consumer may provide a `GitHubSnapshotCache`.

## Use inside the monorepo

This is a private development boundary bundled into the public products. Product users
access it through Skillbench and do not install this workspace separately.

## Workspace contract

- **Status:** private production adapter, bundled into the CLI.
- **Owns:** GitHub input parsing, immutable ref resolution, bounded tree download, and SDK snapshot
  adaptation.
- **Does not own:** generic source orchestration, local sources, CLI interaction, cache storage,
  or persistence.
- **Internal dependencies:** SDK; `test-contracts` for tests only.
- **Direct dependent:** CLI composition and packaging.
- **Extension point:** extend supported GitHub forms here or create a sibling package for another
  remote source provider.

```ts
import {
  GitHubApiClient,
  GitHubSourceResolver,
  parseGitHubSource,
} from "@skillbench/source-github";

const descriptor = parseGitHubSource(
  "https://github.com/owner/repository/tree/main/skills/example",
);

const client = new GitHubApiClient({ token: process.env.GITHUB_TOKEN });
const pinned = await client.resolveSource(descriptor);
```

To use the complete SDK resolver, construct `GitHubSourceResolver` with the client, a
cache that follows `GitHubSnapshotCache`, and a
`maxFileSizeBytes/maxSnapshotSizeBytes` policy, then register it in
`SkillSourceService`.

## Accepted inputs

- `owner/repository`;
- `github:owner/repository/path/to/skill@ref`;
- an HTTPS repository or `tree` directory URL;
- a `blob` or raw URL pointing to a `SKILL.md`.

Local paths shaped like `owner/repository` must be prefixed with `./` to remove the
ambiguity.

## Resolution and security

URLs with a path may contain a ref with `/`. The adapter tries possible splits from
the longest ref to the shortest, then uses only the resolved 40-character SHA for
discovery and downloads.

A directory is traversed with the Contents API. A single `SKILL.md` is selected
automatically; several candidates require `skillPath` or a `selectSkill` callback.
Symlinks, submodules, unsafe paths, oversized files, and potentially truncated
directories are rejected.

`GITHUB_TOKEN` or `GH_TOKEN` can raise API limits in the CLI. The token is sent only
to the configured API, never to `raw.githubusercontent.com`. Private repository
support is not promised as a complete contract.

## Structure

- `github-url-parser.ts` normalizes user input.
- `github-api-client.ts` is the public facade.
- `github-transport.ts` owns Octokit, timeouts, and HTTP translation.
- `github-ref-resolver.ts` resolves branches, tags, and ambiguous refs.
- `github-tree-reader.ts` discovers and downloads the bounded tree.
- `github-source.ts` turns this data into an SDK snapshot and applies the cache.

The last four modules are implementation details; consumers use the exports from
`src/index.ts`.

## Modify or create another source

Keep identity resolution separate from download: the snapshot must reference an
immutable version. Cover every new URL form with ambiguous refs, invalid paths, and an
injected transport, without network access in default tests.

For another provider:

1. create a sibling package instead of adding a branch to this package;
2. implement `SkillSourceResolver` and its `capabilities`;
3. validate limits, paths, links, and immutable identity in the adapter;
4. apply `verifySourceResolverContract`;
5. connect the resolver in the CLI composition;
6. add boundaries and cover it in the public product package smokes.

## Develop

```sh
vp -C packages/source-github run check
vp -C packages/source-github run test
vp -C packages/source-github run typecheck
vp -C packages/source-github run build
```

Real network access remains opt-in:

```sh
vp -C packages/cli run test:github-live
```
