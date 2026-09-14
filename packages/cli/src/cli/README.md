# CLI presentation layer

This directory owns the terminal boundary of `@thisisjuke/skillbench`: Commander definitions,
interactive prompts, option normalization, standard streams, exit behavior, and human or machine
rendering.

## Flow and ownership

```text
argv / TTY
  → program and command handlers
  → application use cases
  → human renderer OR JSON/JSONL writer
```

- `commands/` declares product commands and translates parsed options into application inputs.
- `renderers/` formats human-readable results; it does not write directly to stdout or JSONL.
- `interactive.ts` obtains missing human choices; automation must remain complete with
  `--no-input`.
- `json-output.ts`, `jsonl-output.ts`, and `stdio.ts` own machine output and stream writes.
- `command-context.ts` and `options.ts` normalize CLI-only context before application execution.

This layer may depend on `src/application/`, public SDK contracts, and terminal libraries. The
application layer must never import this directory, Commander, or `@clack/prompts`. Command
handlers must not instantiate SDK services directly; composition and orchestration stay outside
the presentation handlers. These directions are enforced by the workspace boundary check.

Add a command by defining its cross-product identifier in `@skillbench/invocation-contract`,
adding or reusing an application use case, then wiring parsing and each required output mode here.
Cover interactive, non-interactive, error, cancellation, JSON, or JSONL behavior as applicable.

Run `vp -C packages/cli run check` from the repository root.
