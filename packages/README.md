# Package map

`packages/` contains the public CLI product and the private modules it bundles. Package
boundaries follow ownership and dependency direction; they are not independent release units.
Only `@thisisjuke/skillbench` is published from this directory.

## Dependency graph

Internal edges below come from the workspace manifests. “Build” means code bundled into a public
artifact; “test” means a development-only contract dependency.

| Workspace | Kind | Direct internal dependencies | Direct dependents |
| --- | --- | --- | --- |
| [`invocation-contract`](invocation-contract/README.md) | private contract | none | SDK, CLI, runners, test contracts |
| [`sdk`](sdk/README.md) | private production module | invocation contract | CLI, adapters, runner kit, test contracts |
| [`runner-kit`](runner-kit/README.md) | private production module | SDK | Codex and Claude runners (build) |
| [`test-contracts`](test-contracts/README.md) | private test support | invocation contract, SDK | runners, GitHub source, Promptfoo assertions, CLI tests |
| [`runner-codex`](runner-codex/README.md) | private adapter | invocation contract, SDK, runner kit (build), test contracts (test) | CLI (build) |
| [`runner-claude`](runner-claude/README.md) | private adapter | invocation contract, SDK, runner kit (build), test contracts (test) | CLI (build) |
| [`source-github`](source-github/README.md) | private adapter | SDK, test contracts (test) | CLI (build) |
| [`assertions-promptfoo`](assertions-promptfoo/README.md) | private adapter | SDK, test contracts (test) | CLI (build) |
| [`cli`](cli/README.md) | public product | invocation contract, SDK, adapters; test contracts (test) | [Web application](../apps/web/README.md) |

The direction is contracts → portable services → adapters → CLI → Web. Dependencies point left
in that sequence; the Web application consumes only the CLI's published contract. The executable
guard in [`scripts/check-workspace-boundaries.mjs`](../scripts/check-workspace-boundaries.mjs)
rejects forbidden edges, undeclared cross-package source imports, and unsupported public subpaths.

## Choosing an owner

- Put provider-independent schemas and use cases in the SDK.
- Put cross-product command and wire schemas in `invocation-contract`.
- Put external provider behavior and dependencies in an adapter.
- Put process mechanics shared by at least two runners in `runner-kit`.
- Put reusable behavioral adapter checks in `test-contracts`.
- Put terminal parsing, presentation, and product composition in the CLI.

The four general-purpose private boundaries remain separate because each has a distinct
responsibility, multiple legitimate consumers, and an enforceable dependency direction. Do not
merge or rename one solely to reduce the workspace count.

Run a package command from the repository root with `vp -C packages/<name> run
<build|check|test|typecheck>`. Each package README documents its extension point and any opt-in
live checks.
