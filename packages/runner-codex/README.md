# `@skillbench/runner-codex`

This adapter implements the SDK's `Runner` port using the non-interactive mode of the
Codex CLI. It owns Codex arguments, the model/effort profile, JSONL parsing, and
provider-specific errors.

It contains no evaluation, comparison, or persistence logic.

This is a private development boundary bundled into the public products. Product users
install Skillbench once; they still need an installed and authenticated `codex`
executable for real Codex runs.

Skillbench provides no fallback to another runner.

## Workspace contract

- **Status:** private production adapter, bundled into the CLI.
- **Owns:** Codex argv, execution profiles, sandbox translation, JSONL parsing, and provider
  errors.
- **Does not own:** shared process plumbing, evaluation, comparison, terminal UX, or persistence.
- **Internal dependencies:** invocation contract and SDK; `runner-kit` is bundled at build time;
  `test-contracts` is test-only.
- **Direct dependent:** CLI composition and packaging.
- **Extension point:** update Codex protocol behavior here or add a sibling runner for another
  provider.

```ts
import {
  CodexRunner,
  createCodexExecutionProfile,
} from "@skillbench/runner-codex";

const runner = new CodexRunner({ sandbox: "read-only" });
const profile = createCodexExecutionProfile({
  runnerVersion: await runner.version(),
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
});
```

`runner.run(input)` then accepts the `RunInput` defined by
`@skillbench/sdk/runners`. In the final product, the [CLI](../cli/README.md) builds
this profile and the workspaces.

## Adapter guarantees

- ephemeral execution with personal configuration and rules ignored;
- explicit model, effort, version, and permissions;
- sandbox limited to `read-only` or `workspace-write`;
- environment passed through an allowlist;
- bounded timeout, cancellation, stdout, and stderr;
- success accepted only after a `turn.completed` event;
- artifacts calculated from the workspace difference;
- Codex details preserved in a versioned `RunnerTrace`.

The skill is materialized under `.agents/skills`. An incompatible Codex version or
protocol fails explicitly instead of producing an ambiguous result.

## Structure

- `src/codex-runner.ts` owns the process and JSONL protocol.
- `src/execution-profile.ts` owns the Codex profile schema.
- `src/errors.ts` owns exported error codes.
- `@skillbench/runner-kit` provides only shared process plumbing.

## Modify the adapter

When a Codex version changes, update the argv, version validation, event parser, fake
executable, and tests together. Do not loosen a protocol check merely to accept unknown
output: first capture a real example and add explicit validation.

New provider data stays in `RunnerTrace` until it becomes a proven shared contract for
several runners. Do not move Codex types into the SDK.

## Create another runner from this model

Reuse the package shape, not its assumptions:

1. implement `Runner` and a strict Zod profile in a new workspace;
2. build its argv and parse its protocol inside that adapter;
3. use `runner-kit` for the environment, limits, and cancellation;
4. run `verifyRunnerContract` from `test-contracts`;
5. add one definition to the CLI registry;
6. add the package to the boundary graph and public product package smokes.

## Develop

```sh
vp -C packages/runner-codex run check
vp -C packages/runner-codex run test
vp -C packages/runner-codex run typecheck
vp -C packages/runner-codex run build
```

Regular tests use a fake executable. The smoke test with a real authenticated Codex
installation is:

```sh
vp -C packages/cli run test:codex-live
```
