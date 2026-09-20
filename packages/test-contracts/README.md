# `@skillbench/test-contracts`

`test-contracts` provides reusable behavioral checks for Skillbench adapters. It is a
private development package; it must appear in neither public tarballs nor runtime
dependencies.

## Workspace contract

- **Status:** private test-only support package.
- **Owns:** reusable behavioral checks for SDK ports and shared valid automation fixtures.
- **Does not own:** provider-specific protocol rules, production behavior, live resources, or
  executables.
- **Internal dependencies:** invocation contract and SDK.
- **Direct dependents:** Codex, Claude, and OpenCode runners, GitHub source, Promptfoo assertions,
  and CLI tests.
- **Extension point:** add a contract only for behavior shared across implementations or
  consumers; keep provider details with their adapter.

## Available contracts

- `verifyRunnerContract` checks the profile, result serialization, relative artifacts,
  and rejection of an incompatible provider profile.
- `verifySourceResolverContract` checks `supports`, `capabilities`, origin,
  `SKILL.md`, fingerprint, and serialization.
- `verifyAssertionHandlerContract` checks a handler's status, score, duration, and
  serialization.
- `AUTOMATION_REQUEST_FIXTURES` supplies the same valid automation requests to CLI
  parsing and Web argv-generation tests so their command, runner, and effort enums
  cannot drift.

```ts
import { verifySourceResolverContract } from "@skillbench/test-contracts";

await verifySourceResolverContract({
  resolver,
  supportedInput: "provider:owner/skill",
  unsupportedInput: "./local-skill",
  expectedOrigin: "provider",
});
```

These helpers use `node:assert` and return a rejected promise when a contract is
violated. Adapter package tests call them with hermetic fakes.

## Modify or extend

A shared contract must test only a guarantee of the SDK port, not provider details.
Keep Codex version parsing, a GitHub rule, or the Promptfoo allowlist in the relevant
adapter test.

To add an adapter family:

1. stabilize its public SDK port first;
2. add a minimal helper that accepts the implementation and its fixtures;
3. run it against at least two implementations or justify its immediate future use;
4. keep real network resources and executables out of the default contract.

Do not duplicate this package in every adapter: import it as an exact `devDependency`.
If it becomes necessary at runtime, the code is probably no longer a test contract and
should change ownership.

## Develop

```sh
vp -C packages/test-contracts run check
vp -C packages/test-contracts run test
vp -C packages/test-contracts run typecheck
vp -C packages/test-contracts run build
```

After changing a contract, run the checks for the runners, sources, and assertion
engines that consume it.
