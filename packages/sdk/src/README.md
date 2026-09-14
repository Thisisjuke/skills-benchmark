# SDK source map

This directory contains provider-independent domain contracts and application services. Public
consumers import only the subpaths declared in the parent package's `exports`; filesystem paths
under `src/` are private.

## Domain and service ownership

| Area | Owns |
| --- | --- |
| `skills/`, `sources/`, `inspect.ts` | validated skill snapshots, fingerprints, source ports, local resolution, inspection |
| `runners/` | provider-neutral runner port, profiles, permissions, traces, workspaces |
| `assertions/`, `evaluator/` | assertion contracts, suite loading, attempts, aggregation, evaluation |
| `comparator/`, `judge/` | comparison scopes and scores, blind qualitative judgment |
| `merger/`, `holdout/` | merge planning/generation/tournaments and late holdout acceptance |
| `results/`, `reports/`, `bundles/` | versioned outcomes, rendering models, portable artifact schemas |
| `logging/`, `errors.ts` | redacted diagnostics and portable error codes |

The SDK depends only on the data-only invocation contract plus general-purpose runtime libraries.
It must not select Codex, Claude, GitHub, Promptfoo, a terminal framework, a Web framework, or a
database. External systems implement SDK ports in sibling adapter workspaces; the CLI is their
composition root.

Add behavior to its owning module and expose it through the narrowest public subpath. A serialized
schema change must update producers, consumers, compatibility handling, and tests together. See
the [package contract](../README.md) for extension rules and commands.
