# CLI application layer

This directory owns CLI use-case orchestration independently of terminal presentation. It turns
validated product inputs into source resolution, inspection, evaluation, comparison, merge,
diagnostic, history, and optional materialization operations.

## Dependency direction

```text
CLI presentation → application use cases → composition / SDK ports / product-owned adapters
```

Application modules may coordinate SDK services and CLI-owned composition, configuration,
history, bundles, and project layout. They return structured outcomes for renderers or machine
writers. They do not parse argv, prompt users, format terminal output, or write directly to
stdout/stderr, and they cannot import `src/cli/`, Commander, or `@clack/prompts`.

The `merge/` seam keeps planning, generation, tournament execution, and final materialization
explicit because holdout timing and artifact writes are security-sensitive. Source acquisition
is centralized in `source.ts`; effective configuration and preflight checks remain separate from
the operation that consumes them.

Extend this layer when a behavior must be shared by interactive and automated CLI paths. Accept
injected or already-composed dependencies where possible, keep outputs structured, and let the
presentation layer decide how to render them.

Run `vp -C packages/cli run check` from the repository root.
