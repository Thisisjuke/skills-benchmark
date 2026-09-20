# `@skillbench/invocation-contract`

This private package is the data-only contract shared by the Skillbench CLI and Web
backend. It owns command identifiers, runner and effort identifiers, validated
automation requests, and the versioned JSON/JSONL wire envelopes.

It intentionally contains no process spawning, terminal rendering, filesystem access,
model execution, or persistence. The CLI owns command parsing and execution. The Web
backend owns request-to-argv mapping and subprocess lifecycle.

This is a private development boundary bundled into both public products. Product users
install the CLI or Web package; they never install this workspace independently.

## Workspace contract

- **Status:** private production contract, bundled through the CLI.
- **Owns:** cross-product command identifiers, automation requests, runner identifiers, and
  versioned JSON/JSONL envelopes.
- **Does not own:** orchestration, processes, terminal UX, HTTP, persistence, or domain services.
- **Internal dependencies:** none.
- **Direct dependents:** SDK, CLI, Codex, Claude, and OpenCode runners, and test contracts.
- **Extension point:** evolve a strict data schema and update every producer and consumer in the
  same change; version protocol-breaking changes.

## Extend the contract

Add a command or runner identifier here before implementing its consumers. Keep request
schemas strict and require an explicit runner profile for every automated model
operation. A protocol-breaking change requires a new protocol version and migration of
both products in the same change.

Do not duplicate the command or runner unions in either product. A consumer-specific
option stays with that consumer: interactive prompts and human output belong to the CLI,
while database identifiers and HTTP payload concerns belong to Web. This package may
depend on data validation, but never on Commander, React, Hono, Drizzle, a provider
adapter, or the SDK's business services.

## Develop

```sh
vp -C packages/invocation-contract run check
vp -C packages/invocation-contract run test
vp -C packages/invocation-contract run typecheck
vp -C packages/invocation-contract run build
```
