# `@skillbench/runner-claude`

This adapter implements the SDK's `Runner` port using Claude Code's non-interactive
print mode. It owns Claude arguments, the model/effort profile, JSON result, and
provider-specific sandbox rules.

It contains no evaluation, comparison, or persistence logic.

This is a private development boundary bundled into the public products. Product users
install Skillbench once; they still need an installed and authenticated `claude`
executable for real Claude runs.

## Workspace contract

- **Status:** private production adapter, bundled into the CLI.
- **Owns:** Claude argv, execution profiles, sandbox translation, JSON parsing, and provider
  errors.
- **Does not own:** shared process plumbing, evaluation, comparison, terminal UX, or persistence.
- **Internal dependencies:** invocation contract and SDK; `runner-kit` is bundled at build time;
  `test-contracts` is test-only.
- **Direct dependent:** CLI composition and packaging.
- **Extension point:** update Claude protocol behavior here or add a sibling runner for another
  provider.

```ts
import {
  ClaudeRunner,
  createClaudeExecutionProfile,
} from "@skillbench/runner-claude";

const runner = new ClaudeRunner({ sandbox: "read-only" });
const profile = createClaudeExecutionProfile({
  runnerVersion: await runner.version(),
  model: "claude-sonnet-4-6",
  effort: "low",
});
```

`runner.run(input)` then accepts the SDK's public `RunInput`. The
[CLI](../cli/README.md) is the composition point used by Skillbench products.

## Adapter guarantees

- automatic sessions and memory disabled;
- restricted mode, non-interactive permission prompts, and implicit MCP servers rejected;
- user and project settings are ignored while the installed CLI authentication remains available;
- explicit model, effort, version, and permissions;
- read-only tools in `read-only` mode;
- Claude sandbox fails closed for `workspace-write`;
- environment passed through an allowlist;
- bounded timeout, cancellation, stdout, and stderr;
- result accepted only when it follows the expected JSON protocol;
- Claude details preserved in a versioned `RunnerTrace`.

The skill is materialized under `.claude/skills`. Write mode never silently falls back
to unsandboxed execution. Claude Code `>=2.1.259 <3.0.0` is required because this
adapter depends on the restricted and non-interactive permission controls introduced
in that CLI generation.

## Structure

- `src/claude-runner.ts` owns the process, tools, and JSON protocol.
- `src/execution-profile.ts` owns the Claude profile schema.
- `src/errors.ts` owns exported error codes.
- `@skillbench/runner-kit` provides only shared plumbing.

## Modify the adapter

Treat a Claude CLI change as a protocol change: update the argv, version validation,
parser, fake executable, and tests together. Verify `read-only` and
`workspace-write` behavior separately.

Costs, turns, and session identifiers remain trace details. Add them to the shared
result only after defining portable semantics for several runners.

## Create another runner from this model

1. create a workspace that depends on the SDK's public contracts;
2. define a strict profile and a `Runner` adapter without business logic;
3. use `runner-kit` for the process without sharing argv or parsers;
4. apply `verifyRunnerContract`;
5. register the runner once in the CLI;
6. verify the fake executable, then an explicitly opt-in real smoke test.

## Develop

```sh
vp -C packages/runner-claude run check
vp -C packages/runner-claude run test
vp -C packages/runner-claude run typecheck
vp -C packages/runner-claude run build
```

The live test requires an authenticated executable and may consume tokens:

```sh
vp -C packages/runner-claude run test:live
```
