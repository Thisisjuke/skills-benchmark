# `@skillbench/sdk`

The SDK contains Skillbench's portable domain contracts, Zod schemas, and use cases. It can
resolve a local skill, load a suite, run evaluations, compare results, prepare a merge,
isolate a holdout, and produce versioned reports.

It selects no provider, displays no terminal prompt, and owns no database.

## Workspace contract

- **Status:** private production core, bundled into the CLI and its adapters.
- **Owns:** provider-independent schemas, ports, services, results, reports, and portable bundles.
- **Does not own:** provider selection, remote-provider protocols, terminal UX, HTTP, or SQLite.
- **Internal dependency:** invocation contract.
- **Direct dependents:** CLI, all production adapters, runner kit, and test contracts.
- **Extension point:** extend the narrowest domain module and public subpath; implement external
  systems as sibling adapters. See the [`src/` map](src/README.md).

## Import inside the monorepo

This is a private development boundary bundled into the public products. Product users
install only the CLI or Web package; they do not install this workspace.

The root entry point is intentionally small:

```ts
import { inspectSkill, SkillbenchError } from "@skillbench/sdk";
import { LocalSourceResolver, SkillSourceService } from "@skillbench/sdk/sources";

const source = new SkillSourceService([
  new LocalSourceResolver(
    {
      maxFileSizeBytes: 2 * 1024 * 1024,
      maxSnapshotSizeBytes: 25 * 1024 * 1024,
    },
    { baseDirectory: process.cwd() },
  ),
]);

const result = await inspectSkill(source, "./skills/my-skill");
```

Import specialized features from a subpath declared in `package.json#exports`. Never
import `@skillbench/sdk/src/*`.

| Subpath | Responsibility |
| --- | --- |
| `/assertions` | native assertions, handler registry, and scoring dimensions |
| `/bundles` | portable bundle manifest and references |
| `/comparator` | comparison plan, scoring, and service |
| `/errors` | shared errors and codes |
| `/evaluator` | YAML suites, attempts, aggregation, and evaluation service |
| `/holdout` | gate, late handle, and acceptance verdict |
| `/inspect` | portable snapshot inspection |
| `/judge` | blind pairwise judging through the `Runner` port |
| `/logging` | silent or debug logger with redaction |
| `/merger` | plan, structured candidates, and development tournament |
| `/reports` | report models and rendering |
| `/results` | complete `eval`, `compare`, and `merge` results |
| `/runners` | `Runner` port, profiles, permissions, traces, and workspaces |
| `/skills` | parsing, snapshots, and fingerprints |
| `/sources` | ports, resolution service, and local source |

## Important boundaries

- Every object that crosses a process, file, or package boundary is validated by its
  public schema.
- A source produces a complete, fingerprinted snapshot; downstream use cases do not
  depend on its origin.
- A `Runner` always receives an explicit profile and permissions.
- Business modules accept injected stores. The SDK provides transient stores, never a
  SQLite implementation.
- The holdout is loaded only after finalists are selected and returns only aggregate
  metrics to earlier stages.
- Qualitative judging goes through `Runner`, anonymizes candidates, and evaluates both
  X/Y and Y/X orders.
- Merging generates a structured plan and validated candidates; it does not blindly
  concatenate the parents' Markdown.

## Modify the SDK

Add behavior to the module that owns its contract. A schema change must update the
parser, types, producers, consumers, and tests in the same change. If data is
serialized, keep an explicit version or plan its compatibility.

Add an export to the root barrel only when almost every consumer needs it. Specialized
APIs stay in their subpath. The private `@skillbench/invocation-contract` workspace
owns cross-product command names, automation requests, and JSON/JSONL envelopes.
After changing an SDK export, verify both public product builds because workspace links
can hide a missing bundled entry.

## Extend without changing the core

### New source

Implement `SkillSourceResolver`, advertise a provider identifier and locality in
`capabilities`, then register the resolver in `SkillSourceService`. Put any network
or provider dependency in a separate adapter package.

### New runner

Implement `Runner`, produce a strict JSON `ExecutionProfile`, validate `RunResult`,
and keep provider details in `RunnerTrace`. Use `@skillbench/runner-kit` in this
monorepo for process plumbing and `@skillbench/test-contracts` for the shared contract.

### New assertion

Add its document to the evaluation schema and provide an `AssertionHandler`.
Repetition orchestration and workspaces remain in the evaluator. A large third-party
library belongs in its own adapter.

## Should this package be duplicated?

Not for a new business module: evaluator, comparator, merger, holdout, and reports
evolve together around the same contracts. Extract a new package only when the feature
has an independent contract and at least two concrete reasons: its own dependency,
distinct runtime risk, optional consumption, or an independent release cycle.

## Develop

From the repository root:

```sh
vp -C packages/sdk run check
vp -C packages/sdk run test
vp -C packages/sdk run typecheck
vp -C packages/sdk run build
```

The public CLI and Web package smokes prove that required SDK exports are included in
their bundled artifacts.
