# `@thisisjuke/skillbench-web`

`@thisisjuke/skillbench-web` is Skillbench's persistent local application. Its `npx` command
starts a server on the loopback interface, opens the browser, and associates history,
sources, events, and bundles with the selected project.

## Supported AI

**Supported AI = Codex, Claude, and models available through OpenCode.** The built-in
`mock` runner is available for workflow checks without an AI or model charges. See
[AI prerequisites](#ai-prerequisites) before submitting a model-backed job.

## AI prerequisites

The Web product supports exactly the same runners as the CLI and requires Node.js
22.22.2 or newer. Provider executables and credentials must be visible to the process
that starts `skillbench-web`.

| Runner | What the Web process needs |
| --- | --- |
| `mock` | No external executable or account; results are not a meaningful quality ranking. |
| `codex` | An authenticated `codex` CLI on `PATH`, plus an explicit model and reasoning effort. No fixed CLI version range is currently enforced. |
| `claude` | An authenticated `claude` CLI on `PATH`, version `>=2.1.259 <3.0.0`, plus an explicit model and effort. |
| `opencode` | An `opencode` CLI on `PATH`, version `>=1.18.12 <2.0.0`, with at least one provider configured and authenticated. The form can pass an explicit `provider/model` or let OpenCode resolve it. |

Skillbench does not install or authenticate these CLIs. Initialize the project with the
CLI, run `skillbench doctor`, and see the CLI's [full runner
guide](../../packages/cli/README.md#choose-a-runner-and-control-cost) for provider-specific
security and reproducibility details.

This product is distinct from `@thisisjuke/skillbench`: it owns SQLite, but runs the exact CLI
version as a subprocess for every operation.

The distributable Web product depends on the CLI package through its regular `dependencies`.
The monorepo resolves `workspace:*` locally and substitutes the packed CLI tarball in its
external-consumer smoke test. The Web package must not copy CLI internals or convert them
into a source-level dependency.

See the [monorepo package map](../../packages/README.md) for the private bundled modules and their
dependency direction; those `@skillbench/*` workspaces are not separately published packages.

## Workspace contract

- **Status:** public npm product exposing the `skillbench-web` binary.
- **Owns:** loopback HTTP and browser UI, job lifecycle, SQLite persistence, Drizzle schema and
  migrations, and startup recovery.
- **Does not own:** Skillbench evaluation/comparison/merge logic, CLI parsing, provider adapters,
  or project initialization.
- **Internal dependency:** the public CLI package only, through its binary and exported contracts.
- **Direct dependents:** none inside the monorepo.
- **Extension point:** change the owning client, route, job, or storage layer described in the
  [`src/` map](src/README.md), preserving the subprocess boundary.

## Use the application

Initialize the selected project once with the CLI before submitting evaluation,
comparison, or merge jobs. The Web product intentionally does not own initialization:

```sh
cd ./my-project
npx @thisisjuke/skillbench init
npx @thisisjuke/skillbench-web --project .
```

The job form defaults to `.skillbench/evals/development/default.yaml`. It submits an explicit runner
profile and always gives the CLI a temporary output destination, so Web jobs do not
depend on interactive prompts or automatic CLI run paths.

After publication:

```sh
npx @thisisjuke/skillbench-web
npx @thisisjuke/skillbench-web --project ./my-project --port 4173 --no-open
```

From the monorepo root:

```sh
vp run build
vp run skillbench:web -- --project . --no-open
```

The server listens exclusively on `127.0.0.1`. Data is written to the selected
project:

```text
.skillbench/skillbench-web.sqlite
.skillbench/web/bundles/<job-id>/report.md
.skillbench/web/bundles/<job-id>/manifest.json
.skillbench/web/bundles/<job-id>/result.json
.skillbench/web/tmp/
```

Each completed job keeps the full portable bundle. Start with `report.md` for the
human-readable outcome; reports and merge artifacts referenced by the manifest are
available from the job detail. Jobs interrupted by shutdown are marked `interrupted`
on the next startup.

## Architecture

```text
src/client/       React application and TanStack Query cache
src/components/   local shadcn/ui components
src/app.ts        Hono routes, validation, and assets
src/jobs/         queue, CLI subprocess, JSONL, and bundles
src/storage/      connection, repositories, and Drizzle schema
drizzle/          embedded SQLite migrations
src/server.ts     skillbench-web command and lifecycle
```

`JobManager` accepts only validated `inspect`, `eval`, `compare`, or `merge`
requests. It builds the argv itself, adds `--no-input --no-history --jsonl --yes`,
requires a temporary bundle, validates its hashes, then moves it into durable storage.
The result, source files, reports, artifacts, and model-facing instructions must all
match their manifest references before the job is persisted. No arbitrary argv from
the browser is executed.

Command identifiers, automation requests, the JSONL protocol, and bundle schemas come
from the public `@thisisjuke/skillbench/contracts` entrypoints. The backend locates the
installed executable through `@thisisjuke/skillbench/cli-path`. The Web application has
no dependency on private workspace packages and must not import the CLI's internal
application layer or resolve its `dist` layout.

## Interface

The interface uses React, local shadcn/ui components based on Base UI, Tailwind CSS v4,
and TanStack Query. Compose an existing component under `src/components/ui` before
adding custom CSS.

From `apps/web`, add a component with the shadcn CLI installed in the workspace:

```sh
npx shadcn add <component>
```

Then verify its imports, theme variables in `src/client/globals.css`, keyboard states,
and responsive variants. [`components.json`](components.json) is the authority for the
shadcn configuration.

## Storage and migrations

The TypeScript schema is in `src/storage/schema.ts`. `WebDatabase` is the only
constructor of `better-sqlite3` and automatically applies embedded migrations.
Repositories use Drizzle; do not add direct application SQL to routes or components.

After a schema change:

```sh
vp -C apps/web run db:generate
vp -C apps/web run test
```

`drizzle/0000_skillbench-web-v1.sql` is the initial V1 migration. Once it has been
published or used with real data, do not rewrite it: generate the next migration.
Always verify that migrations are included in the tarball.

## Modify or duplicate

- A new user action must start from a validated `WebJobRequest` contract and be
  translated into explicit CLI flags.
- New persisted data belongs in the schema and repository, never in the CLI.
- A protocol evolution must first update the CLI's public contract, then this consumer
  in the same monorepo change.
- A new React panel must cover loading, empty, error, success, and cancellation states.

Duplicate the product for another local interface only when it has its own distribution
and persistence lifecycle. Preserve the JSONL process and bundle boundary with the CLI,
give it a distinct binary name, and add its workspace to the boundary graph.

## Develop

```sh
vp -C apps/web run dev
vp -C apps/web run check
vp -C apps/web run test
vp -C apps/web run typecheck
vp -C apps/web run build
```

## Package verification

Run `vp run smoke:release` from the repository root after packaging, CLI-contract, or
migration changes. It builds and packs both products once, validates their file allowlists,
installs them as external consumers, and exercises NPX resolution, server startup, migrations,
persistence, and restart. Versioning and publication are owned by the monorepo root; see
[distribution and releases](../../README.md#distribution-and-releases) and do not publish this
workspace independently.

The packaged smoke test verifies Node startup, the installed CLI call, persistence,
restart behavior, and result reading. `better-sqlite3` also requires representative
release validation on Linux, macOS, and Windows.
